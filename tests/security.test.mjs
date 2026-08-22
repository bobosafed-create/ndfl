import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.CONSULTATION_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
process.env.CONSULTANT_ACCESS_KEY = "a-long-test-only-consultant-key";

const security = await import("../lib/security.mjs");

test("encrypts and authenticates consultation messages", () => {
  const encrypted = security.encryptMessage("4b593eac-8d19-4a28-9c44-8c58d151592c", "visitor", "Секретный налоговый вопрос");
  assert.notEqual(encrypted.ciphertext.toString("utf8"), "Секретный налоговый вопрос");
  assert.equal(
    security.decryptMessage("4b593eac-8d19-4a28-9c44-8c58d151592c", "visitor", {
      ciphertext: encrypted.ciphertext,
      encryption_iv: encrypted.iv,
      authentication_tag: encrypted.authenticationTag,
    }),
    "Секретный налоговый вопрос",
  );
});

test("binds ciphertext to its consultation and author", () => {
  const encrypted = security.encryptMessage("4b593eac-8d19-4a28-9c44-8c58d151592c", "visitor", "Вопрос");
  assert.throws(() => security.decryptMessage("4b593eac-8d19-4a28-9c44-8c58d151592c", "consultant", {
    ciphertext: encrypted.ciphertext,
    encryption_iv: encrypted.iv,
    authentication_tag: encrypted.authenticationTag,
  }));
});

test("consultant key comparison does not store the key in client source", async () => {
  assert.equal(security.consultantKeyMatches("a-long-test-only-consultant-key"), true);
  assert.equal(security.consultantKeyMatches("wrong"), false);
  const cabinet = await readFile(new URL("../app/consultant/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(cabinet, /CONSULTANT_ACCESS_KEY/);
});

test("API verifies YooKassa status server-side and limits code attempts", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /getYooKassaPayment/);
  assert.match(router, /failed_access_attempts \+ 1 >= 5/);
  assert.match(router, /interval '15 minutes'/);
  assert.match(router, /browser_token_hash/);
});

test("payment request does not collect or transmit visitor contacts", async () => {
  const payment = await readFile(new URL("../lib/yookassa.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(payment, /customer|receiptEmail|phone|vat_code/);
  assert.match(payment, /amount: \{ value: "100\.00", currency: "RUB" \}/);
});

test("consultant calculations require the consultant key", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /consultantCalculations/);
  assert.match(router, /consultantCalculationCreate/);
  assert.match(router, /consultantAuthorized\(request\)/);
});
