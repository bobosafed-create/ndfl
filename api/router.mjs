import { randomInt, randomUUID } from "node:crypto";
import { getDatabasePool } from "../db/postgres.mjs";
import {
  consultationHash,
  consultantKeyMatches,
  decryptMessage,
  encryptMessage,
  randomToken,
} from "../lib/security.mjs";
import {
  createYooKassaPayment,
  getYooKassaPayment,
} from "../lib/yookassa.mjs";

const rateLimits = new Map();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function requestIp(request) {
  return (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

function allowRequest(scope, request, limit = 12, windowMs = 60_000) {
  const key = `${scope}:${requestIp(request)}`;
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

async function body(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 16_384) throw new Error("body_too_large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 16_384) throw new Error("body_too_large");
  return JSON.parse(text);
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function browserTokenHash(consultationId, token) {
  return consultationHash(`${consultationId}:browser:${token}`);
}

function codeHash(consultationId, code) {
  return consultationHash(`${consultationId}:code:${code}`);
}

async function createPayment(request) {
  if (!allowRequest("payment", request, 5, 10 * 60_000)) {
    return json({ error: "too_many_requests" }, 429);
  }

  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);

  const consultationId = randomUUID();
  const paymentId = randomUUID();
  const idempotencyKey = randomUUID();
  const browserToken = randomToken();
  const code = String(randomInt(1000, 10000));
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO consultations
        (id, code_hash, browser_token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [
        consultationId,
        codeHash(consultationId, code),
        browserTokenHash(consultationId, browserToken),
        expiresAt,
      ],
    );
    await client.query(
      `INSERT INTO payments
        (id, consultation_id, idempotency_key, amount_kopecks)
       VALUES ($1, $2, $3, 10000)`,
      [paymentId, consultationId, idempotencyKey],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  try {
    const payment = await createYooKassaPayment({ consultationId, idempotencyKey });
    const confirmationUrl = payment?.confirmation?.confirmation_url;
    if (!payment?.id || !confirmationUrl || !confirmationUrl.startsWith("https://")) {
      throw new Error("invalid_yookassa_response");
    }
    await database.query(
      `UPDATE payments SET provider_payment_id = $1, status = $2, updated_at = now()
       WHERE id = $3`,
      [payment.id, payment.status ?? "pending", paymentId],
    );
    return json({ consultationId, browserToken, code, confirmationUrl }, 201);
  } catch (error) {
    await database.query(
      "UPDATE consultations SET status = 'cancelled', updated_at = now() WHERE id = $1",
      [consultationId],
    );
    const status = error?.status === 401 ? 503 : 502;
    return json({ error: "payment_provider_unavailable" }, status);
  }
}

async function authenticateConsultation(database, consultationId, browserToken) {
  if (!validUuid(consultationId) || typeof browserToken !== "string" || browserToken.length < 32) {
    return null;
  }
  const result = await database.query(
    `SELECT * FROM consultations
     WHERE id = $1 AND browser_token_hash = $2 AND expires_at > now()`,
    [consultationId, browserTokenHash(consultationId, browserToken)],
  );
  return result.rows[0] ?? null;
}

async function synchronizePayment(database, consultationId) {
  const result = await database.query(
    `SELECT provider_payment_id, status FROM payments
     WHERE consultation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [consultationId],
  );
  const localPayment = result.rows[0];
  if (!localPayment?.provider_payment_id) return null;
  if (localPayment.status === "succeeded") return localPayment;

  const remotePayment = await getYooKassaPayment(localPayment.provider_payment_id);
  if (remotePayment?.metadata?.consultation_id !== consultationId) return null;
  const remoteStatus = remotePayment.status;
  if (!["pending", "waiting_for_capture", "succeeded", "cancelled"].includes(remoteStatus)) {
    return null;
  }

  await database.query(
    "UPDATE payments SET status = $1, updated_at = now() WHERE provider_payment_id = $2",
    [remoteStatus, localPayment.provider_payment_id],
  );
  if (remoteStatus === "succeeded") {
    await database.query(
      `UPDATE consultations
       SET status = CASE WHEN status = 'awaiting_payment' THEN 'paid' ELSE status END,
           answer_due_at = COALESCE(answer_due_at, now() + interval '1 hour'),
           updated_at = now()
       WHERE id = $1`,
      [consultationId],
    );
  } else if (remoteStatus === "cancelled") {
    await database.query(
      "UPDATE consultations SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'awaiting_payment'",
      [consultationId],
    );
  }
  return { ...localPayment, status: remoteStatus };
}

async function consultationStatus(request) {
  if (!allowRequest("status", request, 30)) return json({ error: "too_many_requests" }, 429);
  const input = await body(request);
  const database = getDatabasePool();
  const consultation = await authenticateConsultation(
    database,
    input.consultationId,
    input.browserToken,
  );
  if (!consultation) return json({ error: "not_found" }, 404);

  if (consultation.status === "awaiting_payment") {
    await synchronizePayment(database, consultation.id).catch(() => null);
  }
  const fresh = await authenticateConsultation(database, input.consultationId, input.browserToken);
  return json({
    status: fresh.status,
    answerDueAt: fresh.answer_due_at,
    answerReady: fresh.status === "answered",
  });
}

async function saveQuestion(request) {
  if (!allowRequest("question", request, 8, 10 * 60_000)) return json({ error: "too_many_requests" }, 429);
  const input = await body(request);
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (question.length < 10 || question.length > 1200) return json({ error: "invalid_question" }, 400);
  const database = getDatabasePool();
  const consultation = await authenticateConsultation(database, input.consultationId, input.browserToken);
  if (!consultation) return json({ error: "not_found" }, 404);
  if (!['paid', 'question_submitted'].includes(consultation.status)) return json({ error: "payment_required" }, 402);

  const existing = await database.query(
    "SELECT 1 FROM consultation_messages WHERE consultation_id = $1 AND author = 'visitor' LIMIT 1",
    [consultation.id],
  );
  if (existing.rowCount > 0) return json({ error: "question_already_saved" }, 409);
  const encrypted = encryptMessage(consultation.id, "visitor", question);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO consultation_messages
        (id, consultation_id, author, ciphertext, encryption_iv, authentication_tag)
       VALUES ($1, $2, 'visitor', $3, $4, $5)`,
      [randomUUID(), consultation.id, encrypted.ciphertext, encrypted.iv, encrypted.authenticationTag],
    );
    await client.query(
      "UPDATE consultations SET status = 'question_submitted', updated_at = now() WHERE id = $1",
      [consultation.id],
    );
    await client.query("COMMIT");
    return json({ saved: true, answerDueAt: consultation.answer_due_at });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function openAnswer(request) {
  if (!allowRequest("safe", request, 10, 15 * 60_000)) return json({ error: "too_many_requests" }, 429);
  const input = await body(request);
  const code = typeof input.code === "string" ? input.code : "";
  const database = getDatabasePool();
  const consultation = await authenticateConsultation(database, input.consultationId, input.browserToken);
  if (!consultation) return json({ error: "not_found" }, 404);
  if (consultation.access_locked_until && new Date(consultation.access_locked_until) > new Date()) {
    return json({ error: "temporarily_locked" }, 429);
  }
  if (!/^\d{4}$/.test(code) || consultation.code_hash !== codeHash(consultation.id, code)) {
    await database.query(
      `UPDATE consultations SET
        failed_access_attempts = failed_access_attempts + 1,
        access_locked_until = CASE WHEN failed_access_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
        updated_at = now()
       WHERE id = $1`,
      [consultation.id],
    );
    return json({ error: "invalid_code" }, 403);
  }
  if (consultation.status !== "answered") return json({ error: "answer_not_ready" }, 409);
  const result = await database.query(
    `SELECT ciphertext, encryption_iv, authentication_tag
     FROM consultation_messages
     WHERE consultation_id = $1 AND author = 'consultant'
     ORDER BY created_at DESC LIMIT 1`,
    [consultation.id],
  );
  if (!result.rows[0]) return json({ error: "answer_not_ready" }, 409);
  const answer = decryptMessage(consultation.id, "consultant", result.rows[0]);
  await database.query(
    "UPDATE consultations SET failed_access_attempts = 0, access_locked_until = NULL, updated_at = now() WHERE id = $1",
    [consultation.id],
  );
  return json({ answer });
}

function consultantAuthorized(request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") && consultantKeyMatches(authorization.slice(7));
}

async function consultantList(request) {
  if (!allowRequest("consultant", request, 30) || !consultantAuthorized(request)) {
    return json({ error: "unauthorized" }, 401);
  }
  const database = getDatabasePool();
  const result = await database.query(
    `SELECT c.id, c.status, c.answer_due_at, c.created_at,
            m.ciphertext, m.encryption_iv, m.authentication_tag
     FROM consultations c
     JOIN consultation_messages m ON m.consultation_id = c.id AND m.author = 'visitor'
     WHERE c.status IN ('question_submitted', 'answered')
     ORDER BY CASE WHEN c.status = 'question_submitted' THEN 0 ELSE 1 END,
              c.answer_due_at ASC
     LIMIT 100`,
  );
  return json({
    consultations: result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      answerDueAt: row.answer_due_at,
      createdAt: row.created_at,
      question: decryptMessage(row.id, "visitor", row),
    })),
  });
}

async function consultantAnswer(request) {
  if (!allowRequest("consultant-write", request, 20) || !consultantAuthorized(request)) {
    return json({ error: "unauthorized" }, 401);
  }
  const input = await body(request);
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  if (!validUuid(input.consultationId) || answer.length < 10 || answer.length > 6000) {
    return json({ error: "invalid_answer" }, 400);
  }
  const database = getDatabasePool();
  const consultation = await database.query(
    "SELECT id FROM consultations WHERE id = $1 AND status IN ('question_submitted', 'answered')",
    [input.consultationId],
  );
  if (!consultation.rows[0]) return json({ error: "not_found" }, 404);
  const encrypted = encryptMessage(input.consultationId, "consultant", answer);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO consultation_messages
        (id, consultation_id, author, ciphertext, encryption_iv, authentication_tag)
       VALUES ($1, $2, 'consultant', $3, $4, $5)`,
      [randomUUID(), input.consultationId, encrypted.ciphertext, encrypted.iv, encrypted.authenticationTag],
    );
    await client.query(
      "UPDATE consultations SET status = 'answered', updated_at = now() WHERE id = $1",
      [input.consultationId],
    );
    await client.query("COMMIT");
    return json({ saved: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function webhook(request) {
  const input = await body(request);
  const paymentId = input?.object?.id;
  if (input?.event !== "payment.succeeded" || typeof paymentId !== "string") return json({ accepted: true });
  const database = getDatabasePool();
  const local = await database.query(
    "SELECT consultation_id FROM payments WHERE provider_payment_id = $1",
    [paymentId],
  );
  if (!local.rows[0]) return json({ accepted: true });
  await synchronizePayment(database, local.rows[0].consultation_id);
  return json({ accepted: true });
}

export async function routeApi(request) {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  try {
    if (route === "POST /api/payments/create") return createPayment(request);
    if (route === "POST /api/consultations/status") return consultationStatus(request);
    if (route === "POST /api/consultations/question") return saveQuestion(request);
    if (route === "POST /api/consultations/answer") return openAnswer(request);
    if (route === "GET /api/consultant/consultations") return consultantList(request);
    if (route === "POST /api/consultant/answer") return consultantAnswer(request);
    if (route === "POST /api/yookassa/webhook") return webhook(request);
    return null;
  } catch (error) {
    if (error?.message === "body_too_large") return json({ error: "body_too_large" }, 413);
    console.error(`API request failed: ${url.pathname}`);
    return json({ error: "internal_error" }, 500);
  }
}
