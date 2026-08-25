const DEFAULT_MODEL = "dashscope/qwen3.5-plus";
const DEFAULT_BASE_URL = "https://api.timeweb.ai/v1";

const instructions = `Ты — исследовательский помощник российского налогового консультанта по НДФЛ. Ты готовишь подробный черновик для проверки специалистом, а не окончательный ответ посетителю.

Перед ответом изучи актуальные на дату запроса официальные источники. Приоритет источников:
1. Налоговый кодекс РФ и иные нормативные акты на publication.pravo.gov.ru.
2. Официальные материалы ФНС России на nalog.gov.ru.
3. Официальные материалы Минфина России на minfin.gov.ru.

Не используй форумы, блоги, сайты юридических агрегаторов и неофициальные пересказы. Не придумывай статьи, пункты, письма, даты, суммы, сроки или ссылки. Если официальный источник не найден или норма неоднозначна, прямо напиши об этом и укажи, что именно должен проверить консультант.

Структура ответа:
1. Краткий вывод.
2. Факты и допущения, на которых основан вывод.
3. Подробное правовое и налоговое обоснование: статья, пункт, подпункт НК РФ или реквизиты официального разъяснения.
4. Расчёт и сроки, если применимо, с показом формулы и исходных данных.
5. Действия посетителя по порядку.
6. Необходимые обезличенные документы и сведения.
7. Риски и обстоятельства, при которых вывод изменится.
8. Источники: отдельный нумерованный список с названием документа, реквизитами и прямой URL-ссылкой на официальную страницу.
9. Что проверить консультанту перед отправкой.

Пиши по-русски, подробно, понятным языком, обычным текстом без Markdown-звёздочек и решёток. Допустимы нумерованные разделы и маркеры «•». Не проси ФИО, телефон, e-mail, паспортные данные, ИНН, адрес, банковские реквизиты и другие персональные данные. Не утверждай, что черновик является окончательной консультацией. Целевой объём — 6 000–12 000 знаков, если вопрос требует подробного анализа.`;

export function cleanDraftFormatting(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\n)\s*\*\s+/g, "$1• ")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

export function aiConfigured() {
  return Boolean((process.env.TIMEWEB_AI_AGENT_API_KEY || process.env.TIMEWEB_AI_API_KEY)?.trim());
}

export async function createConsultationDraft(question) {
  const agentBaseUrl = process.env.TIMEWEB_AI_AGENT_BASE_URL?.trim();
  const apiKey = (process.env.TIMEWEB_AI_AGENT_API_KEY || process.env.TIMEWEB_AI_API_KEY)?.trim();
  if (!apiKey) {
    const error = new Error("ai_not_configured");
    error.code = "ai_not_configured";
    throw error;
  }

  // The agent endpoint adds web search and source-aware instructions. The old
  // AI Gateway remains a temporary fallback until the new variables are saved.
  const baseUrl = agentBaseUrl || process.env.TIMEWEB_AI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const controller = new AbortController();
  // Qwen 3.5 Plus can spend noticeably longer on tax questions than a small chat model.
  // Keep the request bounded, but do not cancel a valid draft after only 45 seconds.
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.TIMEWEB_AI_MODEL?.trim() || DEFAULT_MODEL,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: `Вопрос посетителя:\n\n${question}` },
        ],
        max_tokens: 6000,
        temperature: 0.15,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error("ai_request_failed");
      error.code = "ai_request_failed";
      error.status = response.status;
      throw error;
    }

    const result = await response.json();
    const draft = typeof result?.choices?.[0]?.message?.content === "string"
      ? cleanDraftFormatting(result.choices[0].message.content)
      : "";
    if (draft.length < 10) {
      const error = new Error("ai_empty_response");
      error.code = "ai_empty_response";
      throw error;
    }
    return draft.slice(0, 14_000);
  } finally {
    clearTimeout(timeout);
  }
}
