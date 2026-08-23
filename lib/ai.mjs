const DEFAULT_MODEL = "dashscope/qwen3.5-plus";
const DEFAULT_BASE_URL = "https://api.timeweb.ai/v1";

const instructions = `Ты готовишь только черновик ответа для российского налогового консультанта.
Ответь по-русски, ясно и доброжелательно. Сначала дай краткий вывод, затем перечисли действия и документы.
Не утверждай, что ответ является окончательной юридической или налоговой консультацией.
Не выдумывай нормы, номера статей, сроки, суммы, даты и реквизиты. Если для точного ответа нужны
актуальные нормы или дополнительные обстоятельства, явно перечисли, что консультанту нужно проверить.
Не проси ФИО, телефон, электронную почту, паспортные данные, ИНН или иные персональные данные.
В конце добавь раздел «Что проверить консультанту» с кратким списком фактов, требующих проверки.
Пиши обычным текстом без Markdown: не используй звёздочки, решётки и другие знаки разметки.
Этот текст увидит консультант и сможет исправить его до отправки посетителю.`;

export function cleanDraftFormatting(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\n)\s*\*\s+/g, "$1• ")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

export function aiConfigured() {
  return Boolean(process.env.TIMEWEB_AI_API_KEY?.trim());
}

export async function createConsultationDraft(question) {
  const apiKey = process.env.TIMEWEB_AI_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error("ai_not_configured");
    error.code = "ai_not_configured";
    throw error;
  }

  const baseUrl = process.env.TIMEWEB_AI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const controller = new AbortController();
  // Qwen 3.5 Plus can spend noticeably longer on tax questions than a small chat model.
  // Keep the request bounded, but do not cancel a valid draft after only 45 seconds.
  const timeout = setTimeout(() => controller.abort(), 120_000);
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
        max_tokens: 2500,
        temperature: 0.2,
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
    return draft.slice(0, 6000);
  } finally {
    clearTimeout(timeout);
  }
}
