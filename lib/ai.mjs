import { randomUUID } from "node:crypto";

const DEFAULT_MODEL = "GigaChat-2-Max";
const DEFAULT_API_BASE_URL = "https://api.giga.chat/v1";
const DEFAULT_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const ALLOWED_SCOPES = new Set(["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"]);

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;
let accessTokenRequest = null;

const commonInstructions = `Ты — помощник российского налогового консультанта по НДФЛ. Ты готовишь черновик для проверки специалистом, а не окончательный ответ посетителю.

У тебя нет гарантированного доступа к интернету и актуальным правовым базам. Не утверждай, что проверил официальный источник в реальном времени. Используй только нормы, в которых уверен, и явно помечай всё, что консультант должен перепроверить на дату ответа.

Приоритет источников для последующей проверки консультантом:
1. Налоговый кодекс РФ и иные нормативные акты на publication.pravo.gov.ru.
2. Официальные материалы ФНС России на nalog.gov.ru.
3. Официальные материалы Минфина России на minfin.gov.ru.

Не используй и не рекомендуй форумы, блоги, сайты юридических агрегаторов и неофициальные пересказы. Не придумывай статьи, пункты, письма, даты, суммы, сроки или ссылки. Если точные реквизиты официального источника неизвестны, прямо напиши об этом вместо вымышленной ссылки.

Пиши по-русски, понятным языком, обычным текстом без Markdown-звёздочек и решёток. Допустимы нумерованные разделы и маркеры «•». Не проси ФИО, телефон, e-mail, паспортные данные, ИНН, адрес, банковские реквизиты и другие персональные данные. Не утверждай, что черновик является окончательной консультацией.`;

const briefInstructions = `${commonInstructions}

Режим: краткая проверка ситуации для тарифа 390 рублей.
Не раздувай ответ и не пытайся охватить все возможные варианты. Сосредоточься на прямом вопросе посетителя.

Структура ответа:
1. Краткий вывод.
2. Что следует проверить и какие сведения нужны.
3. Общий порядок действий посетителя.
4. Нормы и сроки, которые консультанту необходимо перепроверить.

Целевой объём — 2 000–4 000 знаков. Если исходных данных недостаточно, перечисли уточняющие вопросы вместо предположений.`;

const detailedInstructions = `${commonInstructions}

Режим: детализированный разбор для тарифа 990 рублей. Работай как аналитический помощник ведущего специалиста по налогообложению физических лиц. Дай максимально полный, последовательно аргументированный проект консультации по фактам вопроса. Не ограничивайся общими фразами, но и не заполняй объём повторами. Каждый юридический вывод свяжи с фактом, условием или допущением. Номера статей, пунктов и реквизиты разъяснений указывай только при уверенности; всё сомнительное вынеси в перечень для проверки консультантом.

Обязательная структура:
1. Итоговый вывод в нескольких абзацах.
2. Установленные факты, недостающие сведения и принятые допущения.
3. Подробное правовое и налоговое обоснование по каждому вопросу посетителя.
4. Варианты решения и сравнение их последствий.
5. Расчёт налога или возврата: исходные данные, формула, промежуточные действия и результат. Если данных нет — точный шаблон расчёта.
6. Сроки, декларации, уведомления и возможные документы.
7. Пошаговый алгоритм действий посетителя.
8. Риски, исключения и обстоятельства, при которых вывод изменится.
9. Официальные источники для проверки консультантом: название, реквизиты и URL только тогда, когда они достоверно известны.
10. Контрольный список того, что консультант должен перепроверить перед отправкой.

Целевой объём — 8 000–14 000 знаков, если содержание вопроса позволяет. Не сокращай обоснование ради краткости. Если исходных данных недостаточно, всё равно подробно опиши применимые варианты и перечисли конкретные уточняющие вопросы, но не выдумывай факты.`;

const generationModes = {
  brief: { instructions: briefInstructions, maxTokens: 2200, temperature: 0.2, repetitionPenalty: 1 },
  detailed: { instructions: detailedInstructions, maxTokens: 6000, temperature: 0.3, repetitionPenalty: 1.05 },
};

export function cleanDraftFormatting(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\n)\s*\*\s+/g, "$1• ")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

function configuration() {
  const authorizationKey = process.env.GIGACHAT_AUTHORIZATION_KEY?.trim() || "";
  const scope = process.env.GIGACHAT_SCOPE?.trim() || "";
  return {
    authorizationKey,
    scope,
    model: process.env.GIGACHAT_MODEL?.trim() || DEFAULT_MODEL,
    apiBaseUrl: process.env.GIGACHAT_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL,
    oauthUrl: process.env.GIGACHAT_OAUTH_URL?.trim() || DEFAULT_OAUTH_URL,
  };
}

export function aiConfigured() {
  const { authorizationKey, scope } = configuration();
  return Boolean(authorizationKey && ALLOWED_SCOPES.has(scope));
}

function providerError(code, status, stage) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.stage = stage;
  return error;
}

function tokenExpiration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now() + 25 * 60_000;
  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
}

async function requestAccessToken(config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const authorization = /^Basic\s/i.test(config.authorizationKey)
      ? config.authorizationKey
      : `Basic ${config.authorizationKey}`;
    const response = await fetch(config.oauthUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization,
        "content-type": "application/x-www-form-urlencoded",
        rquid: randomUUID(),
      },
      body: new URLSearchParams({ scope: config.scope }),
      signal: controller.signal,
    });
    if (!response.ok) throw providerError("gigachat_auth_failed", response.status, "oauth");
    const result = await response.json();
    if (typeof result?.access_token !== "string" || !result.access_token) {
      throw providerError("gigachat_auth_empty", response.status, "oauth");
    }
    cachedAccessToken = result.access_token;
    cachedAccessTokenExpiresAt = tokenExpiration(result.expires_at);
    return cachedAccessToken;
  } finally {
    clearTimeout(timeout);
  }
}

async function getAccessToken(config) {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) return cachedAccessToken;
  if (!accessTokenRequest) {
    accessTokenRequest = requestAccessToken(config).finally(() => { accessTokenRequest = null; });
  }
  return accessTokenRequest;
}

export async function createConsultationDraft(question, mode = "brief") {
  const config = configuration();
  if (!config.authorizationKey || !ALLOWED_SCOPES.has(config.scope)) {
    throw providerError("ai_not_configured", 0, "configuration");
  }

  const generation = generationModes[mode] || generationModes.brief;
  const accessToken = await getAccessToken(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: generation.instructions },
          { role: "user", content: `Вопрос посетителя:\n\n${question}` },
        ],
        max_tokens: generation.maxTokens,
        temperature: generation.temperature,
        repetition_penalty: generation.repetitionPenalty,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401) {
        cachedAccessToken = "";
        cachedAccessTokenExpiresAt = 0;
      }
      throw providerError("gigachat_request_failed", response.status, "completion");
    }

    const result = await response.json();
    const draft = typeof result?.choices?.[0]?.message?.content === "string"
      ? cleanDraftFormatting(result.choices[0].message.content)
      : "";
    if (draft.length < 10) throw providerError("ai_empty_response", response.status, "completion");
    return draft.slice(0, mode === "detailed" ? 14_000 : 7_000);
  } finally {
    clearTimeout(timeout);
  }
}
