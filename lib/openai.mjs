const DEFAULT_MODEL = "gpt-5.6-terra";
const RESPONSES_URL = "https://api.openai.com/v1/responses";

const instructions = `Ты готовишь только черновик ответа для российского налогового консультанта.
Ответь по-русски, ясно и доброжелательно. Сначала дай краткий вывод, затем перечисли действия и документы.
Не утверждай, что ответ является окончательной юридической или налоговой консультацией.
Не выдумывай нормы, номера статей, сроки, суммы, даты и реквизиты. Если для точного ответа нужны
актуальные нормы или дополнительные обстоятельства, явно перечисли, что консультанту нужно проверить.
Не проси ФИО, телефон, электронную почту, паспортные данные, ИНН или иные персональные данные.
В конце добавь раздел «Что проверить консультанту» с кратким списком фактов, требующих проверки.
Этот текст увидит консультант и сможет исправить его до отправки посетителю.`;

export function openAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function createConsultationDraft(question) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error("openai_not_configured");
    error.code = "openai_not_configured";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
        instructions,
        input: `Вопрос посетителя:\n\n${question}`,
        max_output_tokens: 2500,
        store: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error("openai_request_failed");
      error.code = "openai_request_failed";
      error.status = response.status;
      throw error;
    }

    const result = await response.json();
    const draft = typeof result.output_text === "string" ? result.output_text.trim() : "";
    if (draft.length < 10) {
      const error = new Error("openai_empty_response");
      error.code = "openai_empty_response";
      throw error;
    }
    return draft.slice(0, 6000);
  } finally {
    clearTimeout(timeout);
  }
}
