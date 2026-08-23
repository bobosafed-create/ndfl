import { randomInt, randomUUID } from "node:crypto";
import { getDatabasePool } from "../db/postgres.mjs";
import {
  consultationHash,
  consultantKeyMatches,
  decryptBinary,
  decryptMessage,
  encryptMessage,
  randomToken,
} from "../lib/security.mjs";
import {
  createYooKassaPayment,
  getYooKassaPayment,
} from "../lib/yookassa.mjs";
import {
  createConsultationDraft,
  aiConfigured,
} from "../lib/ai.mjs";
import { CONSULTATION_TARIFFS, resolveTariff } from "../lib/tariffs.mjs";

const rateLimits = new Map();
const ANSWER_NOTICE = "Пометка консультанта: Ответ составлен по предоставленным данным. Если у вас имеются дополнительные обезличенные сведения, способные повлиять на вывод, оформите новый вопрос в том же порядке, что и первоначальный.";
const MAX_ANSWER_LENGTH = 6000;

function withAnswerNotice(answer) {
  return answer.endsWith(ANSWER_NOTICE) ? answer : `${answer}\n\n${ANSWER_NOTICE}`;
}

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
  if (!text.trim()) return {};
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

async function publicPrice() {
  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);
  const result = await database.query(
    "SELECT consultation_price_kopecks FROM site_settings WHERE singleton = true",
  );
  return json({ amountKopecks: result.rows[0]?.consultation_price_kopecks ?? 10000 });
}

async function publicTariffs() {
  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);
  const result = await database.query(
    "SELECT consultation_price_kopecks FROM site_settings WHERE singleton = true",
  );
  return json({
    defaultAmountKopecks: result.rows[0]?.consultation_price_kopecks ?? 10000,
    tariffs: CONSULTATION_TARIFFS,
  });
}

async function createPayment(request) {
  if (!allowRequest("payment", request, 5, 10 * 60_000)) {
    return json({ error: "too_many_requests" }, 429);
  }

  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);
  const input = await body(request);

  const consultationId = randomUUID();
  const paymentId = randomUUID();
  const idempotencyKey = randomUUID();
  const browserToken = randomToken();
  const code = String(randomInt(1000, 10000));
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const priceResult = await database.query(
    "SELECT consultation_price_kopecks FROM site_settings WHERE singleton = true",
  );
  const defaultAmountKopecks = priceResult.rows[0]?.consultation_price_kopecks ?? 10000;
  const requestedTariffCode = typeof input.tariffCode === "string" ? input.tariffCode.trim() : "";
  if (requestedTariffCode && !CONSULTATION_TARIFFS.some((item) => item.code === requestedTariffCode)) {
    return json({ error: "invalid_tariff" }, 400);
  }
  const tariff = resolveTariff(requestedTariffCode, defaultAmountKopecks);
  const amountKopecks = tariff.amountKopecks;

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO consultations
        (id, code_hash, browser_token_hash, expires_at, tariff_code, tariff_name, tariff_amount_kopecks, tariff_deadline_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        consultationId,
        codeHash(consultationId, code),
        browserTokenHash(consultationId, browserToken),
        expiresAt,
        tariff.code,
        tariff.name,
        tariff.amountKopecks,
        tariff.deadlineMinutes,
      ],
    );
    await client.query(
      `INSERT INTO payments
        (id, consultation_id, idempotency_key, amount_kopecks)
       VALUES ($1, $2, $3, $4)`,
      [paymentId, consultationId, idempotencyKey, amountKopecks],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  try {
    const payment = await createYooKassaPayment({ consultationId, idempotencyKey, amountKopecks, tariff });
    const confirmationUrl = payment?.confirmation?.confirmation_url;
    if (!payment?.id || !confirmationUrl || !confirmationUrl.startsWith("https://")) {
      throw new Error("invalid_yookassa_response");
    }
    await database.query(
      `UPDATE payments SET provider_payment_id = $1, status = $2, updated_at = now()
       WHERE id = $3`,
      [payment.id, payment.status ?? "pending", paymentId],
    );
    return json({ consultationId, browserToken, code, confirmationUrl, amountKopecks, tariff }, 201);
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
    `SELECT p.provider_payment_id, p.status, p.amount_kopecks, c.tariff_code
     FROM payments p JOIN consultations c ON c.id = p.consultation_id
     WHERE p.consultation_id = $1 ORDER BY p.created_at DESC LIMIT 1`,
    [consultationId],
  );
  const localPayment = result.rows[0];
  if (!localPayment?.provider_payment_id) return null;
  if (localPayment.status === "succeeded") return localPayment;

  const remotePayment = await getYooKassaPayment(localPayment.provider_payment_id);
  if (remotePayment?.metadata?.consultation_id !== consultationId) return null;
  if (localPayment.tariff_code && remotePayment?.metadata?.tariff_code !== localPayment.tariff_code) return null;
  const remoteAmountKopecks = Math.round(Number(remotePayment?.amount?.value) * 100);
  if (!Number.isInteger(remoteAmountKopecks) || remoteAmountKopecks !== localPayment.amount_kopecks) return null;
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
    tariff: fresh.tariff_code ? {
      code: fresh.tariff_code,
      name: fresh.tariff_name,
      amountKopecks: fresh.tariff_amount_kopecks,
      deadlineMinutes: fresh.tariff_deadline_minutes,
    } : null,
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
    const deadlineResult = await client.query(
      `UPDATE consultations
       SET status = 'question_submitted',
           answer_due_at = COALESCE(answer_due_at, now() + (COALESCE(tariff_deadline_minutes, 240) * interval '1 minute')),
           updated_at = now()
       WHERE id = $1 RETURNING answer_due_at`,
      [consultation.id],
    );
    await client.query("COMMIT");
    return json({ saved: true, answerDueAt: deadlineResult.rows[0]?.answer_due_at ?? null });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function attachmentsDisabled() {
  return json({ error: "attachments_disabled" }, 410);
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
  const answer = withAnswerNotice(decryptMessage(consultation.id, "consultant", result.rows[0]));
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
  const view = new URL(request.url).searchParams.get("view") === "archive" ? "archive" : "active";
  const database = getDatabasePool();
  const result = await database.query(
    `SELECT c.id, c.status, c.answer_due_at, c.created_at, c.archived_at,
            c.tariff_code, c.tariff_name, c.tariff_amount_kopecks, c.tariff_deadline_minutes,
            visitor.ciphertext, visitor.encryption_iv, visitor.authentication_tag,
            answer.ciphertext AS answer_ciphertext,
            answer.encryption_iv AS answer_encryption_iv,
            answer.authentication_tag AS answer_authentication_tag,
            draft.ciphertext AS draft_ciphertext,
            draft.encryption_iv AS draft_encryption_iv,
            draft.authentication_tag AS draft_authentication_tag
     FROM consultations c
     JOIN LATERAL (
       SELECT ciphertext, encryption_iv, authentication_tag
       FROM consultation_messages
       WHERE consultation_id = c.id AND author = 'visitor'
       ORDER BY created_at ASC LIMIT 1
     ) visitor ON true
     LEFT JOIN LATERAL (
       SELECT ciphertext, encryption_iv, authentication_tag
       FROM consultation_messages
       WHERE consultation_id = c.id AND author = 'consultant'
       ORDER BY created_at DESC LIMIT 1
     ) answer ON true
     LEFT JOIN LATERAL (
       SELECT ciphertext, encryption_iv, authentication_tag
       FROM consultation_messages
       WHERE consultation_id = c.id AND author = 'ai_draft'
       ORDER BY created_at DESC LIMIT 1
     ) draft ON true
     WHERE ($1 = 'archive' AND c.status = 'archived')
        OR ($1 = 'active' AND c.status IN ('question_submitted', 'answered'))
     ORDER BY CASE WHEN c.status = 'question_submitted' THEN 0 ELSE 1 END,
              CASE WHEN $1 = 'active' THEN c.answer_due_at END ASC NULLS LAST,
              CASE WHEN $1 = 'archive' THEN c.archived_at END DESC NULLS LAST,
              c.created_at DESC
     LIMIT 100`,
    [view],
  );
  const countsResult = await database.query(
    `SELECT
       count(*) FILTER (WHERE status IN ('question_submitted', 'answered'))::integer AS active,
       count(*) FILTER (WHERE status = 'archived')::integer AS archive
     FROM consultations`,
  );
  const consultationIds = result.rows.map((row) => row.id);
  const attachmentsResult = consultationIds.length === 0 ? { rows: [] } : await database.query(
    `SELECT id, consultation_id, ordinal, extension, mime_type, size_bytes
     FROM consultation_attachments WHERE consultation_id = ANY($1::uuid[]) ORDER BY ordinal`,
    [consultationIds],
  );
  const attachmentsByConsultation = new Map();
  for (const item of attachmentsResult.rows) {
    const items = attachmentsByConsultation.get(item.consultation_id) ?? [];
    items.push({ id: item.id, name: `Документ ${item.ordinal}.${item.extension}`, mimeType: item.mime_type, size: item.size_bytes });
    attachmentsByConsultation.set(item.consultation_id, items);
  }
  return json({
    counts: countsResult.rows[0],
    consultations: result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      answerDueAt: row.answer_due_at,
      tariff: row.tariff_code ? {
        code: row.tariff_code,
        name: row.tariff_name,
        amountKopecks: row.tariff_amount_kopecks,
        deadlineMinutes: row.tariff_deadline_minutes,
      } : null,
      createdAt: row.created_at,
      archivedAt: row.archived_at,
      question: decryptMessage(row.id, "visitor", row),
      answer: row.answer_ciphertext ? decryptMessage(row.id, "consultant", {
        ciphertext: row.answer_ciphertext,
        encryption_iv: row.answer_encryption_iv,
        authentication_tag: row.answer_authentication_tag,
      }) : null,
      aiDraft: row.draft_ciphertext ? decryptMessage(row.id, "ai_draft", {
        ciphertext: row.draft_ciphertext,
        encryption_iv: row.draft_encryption_iv,
        authentication_tag: row.draft_authentication_tag,
      }) : null,
      attachments: attachmentsByConsultation.get(row.id) ?? [],
    })),
  });
}

async function consultantAttachment(request) {
  if (!allowRequest("consultant-attachment", request, 40) || !consultantAuthorized(request)) return json({ error: "unauthorized" }, 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!validUuid(id)) return json({ error: "invalid_attachment" }, 400);
  const database = getDatabasePool();
  const result = await database.query(
    `SELECT id, consultation_id, ordinal, extension, mime_type, ciphertext, encryption_iv, authentication_tag
     FROM consultation_attachments WHERE id = $1`, [id],
  );
  const item = result.rows[0];
  if (!item) return json({ error: "not_found" }, 404);
  const content = decryptBinary(item.consultation_id, item.id, item);
  return new Response(content, { headers: {
    "content-type": item.mime_type,
    "content-disposition": `attachment; filename="document-${item.ordinal}.${item.extension}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  }});
}

async function consultantArchive(request) {
  if (!allowRequest("consultant-archive", request, 30) || !consultantAuthorized(request)) {
    return json({ error: "unauthorized" }, 401);
  }
  const input = await body(request);
  if (!validUuid(input.consultationId) || typeof input.archived !== "boolean") {
    return json({ error: "invalid_consultation" }, 400);
  }
  const database = getDatabasePool();
  const result = input.archived
    ? await database.query(
      `UPDATE consultations SET status = 'archived', archived_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'answered' RETURNING id`,
      [input.consultationId],
    )
    : await database.query(
      `UPDATE consultations SET status = 'answered', archived_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'archived' RETURNING id`,
      [input.consultationId],
    );
  if (!result.rows[0]) return json({ error: "not_found" }, 404);
  return json({ saved: true });
}

async function consultantDelete(request) {
  if (!allowRequest("consultant-delete", request, 20) || !consultantAuthorized(request)) {
    return json({ error: "unauthorized" }, 401);
  }
  const input = await body(request);
  if (!validUuid(input.consultationId)) return json({ error: "invalid_consultation" }, 400);
  const database = getDatabasePool();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const consultation = await client.query(
      `SELECT id FROM consultations
       WHERE id = $1 AND status IN ('question_submitted', 'answered', 'archived')
       FOR UPDATE`,
      [input.consultationId],
    );
    if (!consultation.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "not_found" }, 404);
    }
    await client.query("DELETE FROM consultation_attachments WHERE consultation_id = $1", [input.consultationId]);
    await client.query("DELETE FROM consultation_messages WHERE consultation_id = $1", [input.consultationId]);
    await client.query(
      `UPDATE consultations
       SET status = 'closed', archived_at = NULL, updated_at = now()
       WHERE id = $1`,
      [input.consultationId],
    );
    await client.query("COMMIT");
    return json({ deleted: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function consultantAnswer(request) {
  if (!allowRequest("consultant-write", request, 20) || !consultantAuthorized(request)) {
    return json({ error: "unauthorized" }, 401);
  }
  const input = await body(request);
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  const answerWithNotice = withAnswerNotice(answer);
  if (!validUuid(input.consultationId) || answer.length < 10 || answerWithNotice.length > MAX_ANSWER_LENGTH) {
    return json({ error: "invalid_answer" }, 400);
  }
  const database = getDatabasePool();
  const consultation = await database.query(
    "SELECT id FROM consultations WHERE id = $1 AND status IN ('question_submitted', 'answered')",
    [input.consultationId],
  );
  if (!consultation.rows[0]) return json({ error: "not_found" }, 404);
  const encrypted = encryptMessage(input.consultationId, "consultant", answerWithNotice);
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
    return json({ saved: true, answer: answerWithNotice });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function consultantAiDraft(request) {
  if (!allowRequest("consultant-ai-draft", request, 10, 10 * 60_000) || !consultantAuthorized(request)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!aiConfigured()) return json({ error: "ai_not_configured" }, 503);

  const input = await body(request);
  if (!validUuid(input.consultationId)) return json({ error: "invalid_consultation" }, 400);
  const database = getDatabasePool();
  const result = await database.query(
    `SELECT c.id, m.ciphertext, m.encryption_iv, m.authentication_tag
     FROM consultations c
     JOIN consultation_messages m ON m.consultation_id = c.id AND m.author = 'visitor'
     WHERE c.id = $1 AND c.status IN ('question_submitted', 'answered')
     ORDER BY m.created_at ASC
     LIMIT 1`,
    [input.consultationId],
  );
  const consultation = result.rows[0];
  if (!consultation) return json({ error: "not_found" }, 404);

  const existingDraft = await database.query(
    `SELECT ciphertext, encryption_iv, authentication_tag
     FROM consultation_messages
     WHERE consultation_id = $1 AND author = 'ai_draft'
     ORDER BY created_at DESC LIMIT 1`,
    [consultation.id],
  );
  if (existingDraft.rows[0]) {
    return json({ draft: decryptMessage(consultation.id, "ai_draft", existingDraft.rows[0]), cached: true });
  }

  const question = decryptMessage(consultation.id, "visitor", consultation);
  try {
    const draft = await createConsultationDraft(question);
    const encrypted = encryptMessage(consultation.id, "ai_draft", draft);
    await database.query(
      `INSERT INTO consultation_messages
        (id, consultation_id, author, ciphertext, encryption_iv, authentication_tag)
       VALUES ($1, $2, 'ai_draft', $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), consultation.id, encrypted.ciphertext, encrypted.iv, encrypted.authenticationTag],
    );
    return json({ draft, cached: false });
  } catch (error) {
    console.error(`AI draft request failed: ${error?.code ?? "unknown_error"}; status=${error?.status ?? "none"}`);
    return json({ error: "ai_unavailable" }, 502);
  }
}

async function consultantCalculations(request) {
  if (!allowRequest("consultant-calculations", request, 30) || !consultantAuthorized(request)) {
    return json({ error: "unauthorized" }, 401);
  }
  const database = getDatabasePool();
  const result = await database.query(
    `SELECT id, amount_kopecks, note, created_at
     FROM consultant_calculations
     ORDER BY created_at DESC
     LIMIT 100`,
  );
  const totalResult = await database.query(
    "SELECT COALESCE(SUM(amount_kopecks), 0)::bigint AS total_kopecks FROM consultant_calculations",
  );
  const priceResult = await database.query("SELECT consultation_price_kopecks FROM site_settings WHERE singleton = true");
  return json({
    currentPriceKopecks: priceResult.rows[0]?.consultation_price_kopecks ?? 10000,
    totalKopecks: Number(totalResult.rows[0].total_kopecks),
    entries: result.rows.map((row) => ({
      id: row.id,
      amountKopecks: row.amount_kopecks,
      note: row.note,
      createdAt: row.created_at,
    })),
  });
}

async function consultantCalculationCreate(request) {
  if (!allowRequest("consultant-calculations-write", request, 20) || !consultantAuthorized(request)) {
    return json({ error: "unauthorized" }, 401);
  }
  const input = await body(request);
  const amountRubles = Number(input.amountRubles);
  if (!Number.isInteger(amountRubles) || amountRubles < 1 || amountRubles > 1_000_000) {
    return json({ error: "invalid_calculation" }, 400);
  }
  const database = getDatabasePool();
  await database.query(
    `UPDATE site_settings SET consultation_price_kopecks = $1, updated_at = now() WHERE singleton = true`,
    [amountRubles * 100],
  );
  return json({ saved: true, currentPriceKopecks: amountRubles * 100 });
}

async function consultantCalculationDelete(request) {
  if (!allowRequest("consultant-calculations-delete", request, 30) || !consultantAuthorized(request)) return json({ error: "unauthorized" }, 401);
  const input = await body(request);
  if (!validUuid(input.id)) return json({ error: "invalid_calculation" }, 400);
  const database = getDatabasePool();
  const result = await database.query("DELETE FROM consultant_calculations WHERE id = $1 RETURNING id", [input.id]);
  if (!result.rows[0]) return json({ error: "not_found" }, 404);
  return json({ deleted: true });
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
    if (route === "GET /api/consultation-price") return publicPrice();
    if (route === "GET /api/tariffs") return publicTariffs();
    if (route === "POST /api/payments/create") return createPayment(request);
    if (route === "POST /api/consultations/status") return consultationStatus(request);
    if (route === "POST /api/consultations/question") return saveQuestion(request);
    if (route === "POST /api/consultations/attachments") return attachmentsDisabled();
    if (route === "POST /api/consultations/answer") return openAnswer(request);
    if (route === "GET /api/consultant/consultations") return consultantList(request);
    if (route === "GET /api/consultant/attachments") return consultantAttachment(request);
    if (route === "POST /api/consultant/archive") return consultantArchive(request);
    if (route === "DELETE /api/consultant/consultations") return consultantDelete(request);
    if (route === "POST /api/consultant/ai-draft") return consultantAiDraft(request);
    if (route === "POST /api/consultant/answer") return consultantAnswer(request);
    if (route === "GET /api/consultant/calculations") return consultantCalculations(request);
    if (route === "POST /api/consultant/calculations") return consultantCalculationCreate(request);
    if (route === "DELETE /api/consultant/calculations") return consultantCalculationDelete(request);
    if (route === "POST /api/yookassa/webhook") return webhook(request);
    return null;
  } catch (error) {
    if (error?.message === "body_too_large") return json({ error: "body_too_large" }, 413);
    console.error(`API request failed: ${url.pathname}`);
    return json({ error: "internal_error" }, 500);
  }
}
