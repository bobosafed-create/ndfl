import { randomUUID } from "node:crypto";

const apiBase = "https://api.yookassa.ru/v3";

function credentials() {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) throw new Error("yookassa_not_configured");
  return Buffer.from(`${shopId}:${secretKey}`).toString("base64");
}

function paymentReturnUrl(consultationId) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) throw new Error("site_url_not_configured");

  const returnUrl = new URL(siteUrl);
  if (returnUrl.protocol !== "https:") throw new Error("site_url_must_use_https");

  returnUrl.searchParams.set("payment", "return");
  returnUrl.searchParams.set("consultation", consultationId);
  returnUrl.hash = "consultation-room";
  return returnUrl;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      authorization: `Basic ${credentials()}`,
      "content-type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(10000),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error("yookassa_request_failed");
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function createYooKassaPayment({ consultationId, idempotencyKey, amountKopecks, tariff }) {
  const returnUrl = paymentReturnUrl(consultationId);

  const payload = {
    amount: { value: (amountKopecks / 100).toFixed(2), currency: "RUB" },
    capture: true,
    confirmation: { type: "redirect", return_url: returnUrl.toString() },
    description: `${tariff.name}: консультация по НДФЛ ${consultationId.slice(0, 8)}`.slice(0, 128),
    metadata: { consultation_id: consultationId, tariff_code: tariff.code },
  };

  return request("/payments", {
    method: "POST",
    headers: { "idempotence-key": idempotencyKey ?? randomUUID() },
    body: JSON.stringify(payload),
  });
}

export function getYooKassaPayment(paymentId) {
  return request(`/payments/${encodeURIComponent(paymentId)}`);
}
