import { randomUUID } from "node:crypto";

const DEFAULT_MODEL = "GigaChat-2-Max";
const DEFAULT_API_BASE_URL = "https://api.giga.chat/v1";
const DEFAULT_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const ALLOWED_SCOPES = new Set(["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"]);

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;
let accessTokenRequest = null;

const instructions = `Ты — исследовательский помощник российского налогового консультанта по НДФЛ. Ты готовишь подробный черновик для проверки специалистом, а не окончательный ответ посетителю.

У тебя нет гарантированного доступа к интернету и актуальным правовым базам. Не утверждай, что проверил официальный источник в реальном времени. Используй только нормы, в которых уверен, и явно помечай всё, что консультант должен перепроверить на дату ответа.

Приоритет источников для последующей проверки консультантом:
1. Налоговый кодекс РФ и иные нормативные акты на publication.pravo.gov.ru.
2. Официальные материалы ФНС России на nalog.gov.ru.
3. Официальные материалы Минфина России на minfin.gov.ru.

Не используй и не рекомендуй форумы, блоги, сайты юридических агрегаторов и неофициальные пересказы. Не придумывай статьи, пункты, письма, даты, суммы, сроки или ссылки. Если точные реквизиты официального источника неизвестны, прямо напиши об этом вместо вымышленной ссылки.

Структура ответа:
1. Краткий вывод.
2. Факты и допущения, на которых основан вывод.
3. Подробное правовое и налоговое обоснование: статья, пункт, подпункт НК РФ или реквизиты официального разъяснения — только если уверен в них.
4. Расчёт и сроки, если применимо, с показом формулы и исходных данных.
5. Действия посетителя по порядку.
6. Необходимые обезличенные документы и сведения.
7. Риски и обстоятельства, при которых вывод изменится.
8. Источники для проверки: отдельный нумерованный список. Не выдумывай URL.
9. Что проверить консультанту перед отправкой.

Пиши по-русски, подробно, понятным языком, обычным текстом без Markdown-звёздочек и решёток. Допустимы нумерованные разделы и маркеры «•». Не проси ФИО, телефон, e-mail, паспортные данные, ИНН, адрес, банковские реквизиты и другие персональные данные. Не утверждай, что черновик является окончательной консультацией. Целевой объём — 8 000–12 000 знаков. Не превышай 13 000 знаков: избегай повторов, но обязательно закончи все девять разделов.`;

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

export async function createConsultationDraft(question) {
  const config = configuration();
  if (!config.authorizationKey || !ALLOWED_SCOPES.has(config.scope)) {
    throw providerError("ai_not_configured", 0, "configuration");
  }

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
          { role: "system", content: instructions },
          { role: "user", content: `Вопрос посетителя:\n\n${question}` },
        ],
        max_tokens: 4500,
        temperature: 0.15,
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
    return draft.slice(0, 14_000);
  } finally {
    clearTimeout(timeout);
  }
}
