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
  assert.match(payment, /site_url_not_configured/);
  assert.match(payment, /site_url_must_use_https/);
  assert.match(payment, /returnUrl\.hash = "consultation-room"/);
  assert.doesNotMatch(payment, /ndfl\.styleglobe\.ru/);
});

test("tariff choice is validated and bound to the server-side payment amount", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  const tariffs = await import("../lib/tariffs.mjs");
  assert.deepEqual(tariffs.CONSULTATION_TARIFFS.map((item) => item.amountKopecks), [39000, 99000]);
  assert.equal(tariffs.URGENT_ADDON.amountKopecks, 30000);
  assert.equal(tariffs.URGENT_ADDON.deadlineMinutes, 120);
  assert.deepEqual(tariffs.resolveTariff("situation-check", 0, true), {
    ...tariffs.CONSULTATION_TARIFFS[0],
    code: "situation-check-urgent",
    name: "Проверка ситуации · Срочно",
    description: `${tariffs.CONSULTATION_TARIFFS[0].description}. ${tariffs.URGENT_ADDON.description}.`,
    amountKopecks: 69000,
    deadlineMinutes: 120,
  });
  assert.match(router, /invalid_tariff/);
  assert.match(router, /remoteAmountKopecks !== localPayment\.amount_kopecks/);
  assert.match(router, /metadata\?\.tariff_code !== localPayment\.tariff_code/);
  assert.match(router, /urgent_tariff_unavailable/);
  assert.match(router, /requestedUrgent/);
  assert.match(router, /resolveTariff\(requestedTariffCode, defaultAmountKopecks, requestedUrgent\)/);
});

test("urgent tariff availability is controlled only from the authenticated cabinet", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /consultantSettingsUpdate/);
  assert.match(router, /POST \/api\/consultant\/settings/);
  assert.match(router, /consultantAuthorized\(request\)/);
  assert.match(router, /hasUrgentSetting/);
});

test("payment creation is stopped server-side outside the Moscow service schedule", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /SELECT consultation_price_kopecks, urgent_tariff_available, consultation_schedule FROM site_settings/);
  assert.match(router, /if \(!isServiceOpen\(serviceSchedule\)\)/);
  assert.match(router, /questions_unavailable/);
  assert.ok(router.indexOf('error: "questions_unavailable"') < router.indexOf("const consultationId = randomUUID()"));
  assert.match(router, /questions_unavailable[\s\S]+createYooKassaPayment\(\{/);
});

test("consultant calculations require the consultant key", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /consultantCalculations/);
  assert.match(router, /consultantCalculationCreate/);
  assert.match(router, /consultantCalculationDelete/);
  assert.match(router, /consultantAuthorized\(request\)/);
});

test("consultant schedule updates are authenticated and validated", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /consultantSettingsUpdate/);
  assert.match(router, /validServiceSchedule/);
  assert.match(router, /consultation_schedule = \$2::jsonb/);
  assert.match(router, /consultantAuthorized\(request\)/);
});

test("new-question polling is authenticated and does not return question text", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /consultantPendingSummary/);
  assert.match(router, /GET \/api\/consultant\/pending-summary/);
  assert.match(router, /allowRequest\("consultant-alerts"/);
  assert.match(router, /SELECT id, status, answer_opened_at, created_at\s+FROM consultations\s+WHERE status IN \('question_submitted', 'answered'\)/);
  assert.doesNotMatch(router, /pending: result\.rows\.map\(\(row\) => \(\{[\s\S]*question:/);
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

test("GigaChat drafts are server-side, authenticated and never sent directly to the visitor", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  const ai = await readFile(new URL("../lib/ai.mjs", import.meta.url), "utf8");
  const cabinet = await readFile(new URL("../app/consultant/page.tsx", import.meta.url), "utf8");
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(router, /consultantAiDraft/);
  assert.match(router, /author = 'ai_draft'/);
  assert.match(router, /cached: true/);
  assert.match(router, /consultantAuthorized\(request\)/);
  assert.match(ai, /process\.env\.GIGACHAT_AUTHORIZATION_KEY/);
  assert.match(ai, /process\.env\.GIGACHAT_SCOPE/);
  assert.match(ai, /ngw\.devices\.sberbank\.ru:9443\/api\/v2\/oauth/);
  assert.match(ai, /api\.giga\.chat\/v1/);
  assert.match(ai, /chat\/completions/);
  assert.match(ai, /GigaChat-2-Max/);
  assert.match(ai, /rquid: randomUUID\(\)/);
  assert.match(ai, /cachedAccessTokenExpiresAt/);
  assert.doesNotMatch(ai, /TIMEWEB_AI/);
  assert.doesNotMatch(ai, /qwen/i);
  assert.doesNotMatch(cabinet, /GIGACHAT_AUTHORIZATION_KEY/);
  assert.match(cabinet, /Подготовить черновик в GigaChat/);
  assert.match(cabinet, /Подготовить детализированный черновик в GigaChat/);
  assert.match(cabinet, /amountKopecks === 99_000 \? "detailed" : "brief"/);
  assert.match(cabinet, /GigaChat готовит (?:краткий|детализированный) черновик/);
  assert.match(cabinet, /Отправить в сейф/);
  assert.match(router, /ai_payment_required/);
  assert.match(router, /error\?\.status === 402/);
  assert.match(cabinet, /GigaChat отклонил запрос/);
  assert.match(dockerfile, /NODE_EXTRA_CA_CERTS=\/app\/certs\/russian-trusted-root-ca\.crt/);
});

test("AI draft formatting removes Markdown stars before editing", async () => {
  const { cleanDraftFormatting } = await import("../lib/ai.mjs");
  assert.equal(
    cleanDraftFormatting("**Краткий вывод**\n* Первый шаг\n*важно*"),
    "Краткий вывод\n• Первый шаг\nважно",
  );
});

test("GigaChat exchanges the authorization key for a cached OAuth token", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GIGACHAT_AUTHORIZATION_KEY;
  const originalScope = process.env.GIGACHAT_SCOPE;
  const calls = [];
  process.env.GIGACHAT_AUTHORIZATION_KEY = "test-authorization-key";
  process.env.GIGACHAT_SCOPE = "GIGACHAT_API_PERS";
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/api/v2/oauth")) {
      return new Response(JSON.stringify({ access_token: "temporary-access-token", expires_at: Date.now() + 30 * 60_000 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Проверяемый черновик ответа консультанта" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const { createConsultationDraft } = await import(`../lib/ai.mjs?oauth-test=${Date.now()}`);
    await createConsultationDraft("Первый обезличенный вопрос", "brief");
    await createConsultationDraft("Второй обезличенный вопрос", "detailed");
    assert.equal(calls.filter((call) => call.url.includes("/api/v2/oauth")).length, 1);
    assert.equal(calls.filter((call) => call.url.includes("/chat/completions")).length, 2);
    assert.equal(calls[0].options.headers.authorization, "Basic test-authorization-key");
    assert.match(String(calls[0].options.body), /scope=GIGACHAT_API_PERS/);
    assert.equal(calls[1].options.headers.authorization, "Bearer temporary-access-token");
    assert.deepEqual(
      calls.slice(1).map((call) => {
        const request = JSON.parse(String(call.options.body));
        return [request.max_tokens, request.temperature, request.repetition_penalty];
      }),
      [[2200, 0.2, 1], [6000, 0.3, 1.05]],
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GIGACHAT_AUTHORIZATION_KEY;
    else process.env.GIGACHAT_AUTHORIZATION_KEY = originalKey;
    if (originalScope === undefined) delete process.env.GIGACHAT_SCOPE;
    else process.env.GIGACHAT_SCOPE = originalScope;
  }
});

test("the research agent receives enough time and space for a detailed tax draft", async () => {
  const ai = await readFile(new URL("../lib/ai.mjs", import.meta.url), "utf8");
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(ai, /180_000/);
  assert.match(ai, /maxTokens: 2200/);
  assert.match(ai, /maxTokens: 6000/);
  assert.match(ai, /repetition_penalty: generation\.repetitionPenalty/);
  assert.match(ai, /Целевой объём — 8 000–14 000 знаков/);
  assert.match(router, /input\.mode === "detailed" \? "detailed" : "brief"/);
  assert.match(router, /createConsultationDraft\(question, draftMode\)/);
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

test("long consultant answers receive a route-specific UTF-8 body allowance", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /const DEFAULT_BODY_LIMIT_BYTES = 16_384/);
  assert.match(router, /const ANSWER_BODY_LIMIT_BYTES = 65_536/);
  assert.match(router, /async function body\(request, maxBytes = DEFAULT_BODY_LIMIT_BYTES\)/);
  assert.match(router, /async function consultantAnswer[\s\S]+?body\(request, ANSWER_BODY_LIMIT_BYTES\)/);
});

test("opening the safe records visitor receipt without losing the answer lifecycle", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  const postgres = await readFile(new URL("../db/postgres.mjs", import.meta.url), "utf8");
  const cabinet = await readFile(new URL("../app/consultant/page.tsx", import.meta.url), "utf8");
  assert.match(postgres, /version: 10[\s\S]+answer_opened_at timestamptz/);
  assert.match(router, /answer_opened_at = COALESCE\(answer_opened_at, now\(\)\)/);
  assert.match(router, /row\.status === "answered" && row\.answer_opened_at \? "received"/);
  assert.match(router, /SET status = 'answered', answer_opened_at = NULL/);
  assert.match(cabinet, /ОТВЕТ ПОЛУЧЕН, КОНСУЛЬТАЦИЯ ЗАВЕРШЕНА/);
  assert.match(cabinet, /посетитель успешно открыл сейф/);
  assert.match(cabinet, /status === "received"/);
});
