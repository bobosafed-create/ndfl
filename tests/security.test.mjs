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
  assert.match(payment, /amountKopecks \/ 100/);
  assert.match(payment, /toFixed\(2\)/);
  assert.match(payment, /tariff_code: tariff\.code/);
});

test("tariff choice is validated and bound to the server-side payment amount", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  const tariffs = await import("../lib/tariffs.mjs");
  assert.deepEqual(tariffs.CONSULTATION_TARIFFS.map((item) => item.amountKopecks), [20000, 40000, 75000, 99000]);
  assert.match(router, /invalid_tariff/);
  assert.match(router, /remoteAmountKopecks !== localPayment\.amount_kopecks/);
  assert.match(router, /metadata\?\.tariff_code !== localPayment\.tariff_code/);
  assert.match(router, /urgent_tariff_unavailable/);
  assert.match(router, /requestedTariffCode === "urgent"/);
});

test("urgent tariff availability is controlled only from the authenticated cabinet", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /consultantSettingsUpdate/);
  assert.match(router, /POST \/api\/consultant\/settings/);
  assert.match(router, /consultantAuthorized\(request\)/);
  assert.match(router, /typeof input\.urgentTariffAvailable !== "boolean"/);
});

test("consultant calculations require the consultant key", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /consultantCalculations/);
  assert.match(router, /consultantCalculationCreate/);
  assert.match(router, /consultantCalculationDelete/);
  assert.match(router, /consultantAuthorized\(request\)/);
});

test("new-question polling is authenticated and does not return question text", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /consultantPendingSummary/);
  assert.match(router, /GET \/api\/consultant\/pending-summary/);
  assert.match(router, /allowRequest\("consultant-alerts"/);
  assert.match(router, /SELECT id, created_at\s+FROM consultations\s+WHERE status = 'question_submitted'/);
  assert.match(router, /consultantAuthorized\(request\)/);
});

test("visitor feedback is encrypted, moderated and consultant operations are authenticated", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /encryptMessage\(id, "visitor_feedback", content\)/);
  assert.match(router, /decryptMessage\(row\.id, "visitor_feedback", row\)/);
  assert.match(router, /WHERE status = 'published'/);
  assert.match(router, /VALUES \(\$1, \$2, 'pending'/);
  assert.match(router, /consultantFeedbackUpdate/);
  assert.match(router, /consultantFeedbackDelete/);
  assert.match(router, /PATCH \/api\/consultant\/feedback/);
  assert.match(router, /consultantAuthorized\(request\)/);
});

test("visitor statistics expose only aggregate daily counts to the consultant", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /visitor_daily_counts/);
  assert.match(router, /sum\(visit_count\)/);
  assert.match(router, /consultantVisitorStats/);
  assert.match(router, /GET \/api\/consultant\/visitor-stats/);
  assert.match(router, /consultantAuthorized\(request\)/);
});

test("visitor attachment uploads are disabled while prior files remain consultant-only", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /attachmentsDisabled/);
  assert.match(router, /attachments_disabled/);
  assert.doesNotMatch(router, /async function uploadAttachment/);
  assert.match(router, /consultantAttachment/);
  assert.match(router, /consultantAuthorized\(request\)/);
});

test("AI drafts are server-side, authenticated and never sent directly to the visitor", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  const ai = await readFile(new URL("../lib/ai.mjs", import.meta.url), "utf8");
  const cabinet = await readFile(new URL("../app/consultant/page.tsx", import.meta.url), "utf8");
  assert.match(router, /consultantAiDraft/);
  assert.match(router, /author = 'ai_draft'/);
  assert.match(router, /cached: true/);
  assert.match(router, /consultantAuthorized\(request\)/);
  assert.match(ai, /process\.env\.TIMEWEB_AI_AGENT_API_KEY/);
  assert.match(ai, /process\.env\.TIMEWEB_AI_AGENT_BASE_URL/);
  assert.match(ai, /api\.timeweb\.ai\/v1/);
  assert.match(ai, /chat\/completions/);
  assert.match(ai, /dashscope\/qwen3\.5-plus/);
  assert.doesNotMatch(cabinet, /TIMEWEB_AI_API_KEY/);
  assert.match(cabinet, /Подготовить черновик с ИИ/);
  assert.match(cabinet, /AI-агент изучает официальные источники/);
  assert.match(cabinet, /Отправить в сейф/);
});

test("AI draft formatting removes Markdown stars before editing", async () => {
  const { cleanDraftFormatting } = await import("../lib/ai.mjs");
  assert.equal(
    cleanDraftFormatting("**Краткий вывод**\n* Первый шаг\n*важно*"),
    "Краткий вывод\n• Первый шаг\nважно",
  );
});

test("the research agent receives enough time and space for a detailed tax draft", async () => {
  const ai = await readFile(new URL("../lib/ai.mjs", import.meta.url), "utf8");
  assert.match(ai, /180_000/);
  assert.match(ai, /max_tokens: 6000/);
  assert.match(ai, /publication\.pravo\.gov\.ru/);
  assert.match(ai, /nalog\.gov\.ru/);
  assert.match(ai, /minfin\.gov\.ru/);
  assert.doesNotMatch(ai, /45_000/);
});

test("consultant archive and deletion remain authenticated server operations", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /consultantArchive/);
  assert.match(router, /consultantDelete/);
  assert.match(router, /DELETE FROM consultation_messages/);
  assert.match(router, /status = 'closed'/);
  assert.match(router, /consultantAuthorized\(request\)/);
});

test("every saved consultant answer receives the data-sufficiency notice", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  const cabinet = await readFile(new URL("../app/consultant/page.tsx", import.meta.url), "utf8");
  assert.match(router, /const ANSWER_NOTICE = "Пометка консультанта: Ответ составлен по предоставленным данным/);
  assert.match(router, /function withAnswerNotice\(answer\)/);
  assert.match(router, /withAnswerNotice\(decryptMessage/);
  assert.match(router, /encryptMessage\(input\.consultationId, "consultant", answerWithNotice\)/);
  assert.match(cabinet, /автоматически добавляется пометка/);
});
