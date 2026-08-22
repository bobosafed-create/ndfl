"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Consultation = {
  id: string;
  status: "question_submitted" | "answered";
  answerDueAt: string | null;
  createdAt: string;
  question: string;
};

type CalculationEntry = {
  id: string;
  amountKopecks: number;
  note: string;
  createdAt: string;
};

export default function ConsultantCabinet() {
  const [accessKey, setAccessKey] = useState("");
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [calculationValue, setCalculationValue] = useState("100");
  const [calculationNote, setCalculationNote] = useState("");
  const [calculationEntries, setCalculationEntries] = useState<CalculationEntry[]>([]);
  const [calculationTotal, setCalculationTotal] = useState(0);
  const [draftingId, setDraftingId] = useState<string | null>(null);

  async function load(key: string) {
    setLoading(true);
    setMessage("");
    try {
      const headers = { authorization: `Bearer ${key}` };
      const [consultationsResponse, calculationsResponse] = await Promise.all([
        fetch("/api/consultant/consultations", { headers }),
        fetch("/api/consultant/calculations", { headers }),
      ]);
      if (!consultationsResponse.ok || !calculationsResponse.ok) throw new Error("unauthorized");
      const [consultationsResult, calculationsResult] = await Promise.all([
        consultationsResponse.json(),
        calculationsResponse.json(),
      ]);
      setConsultations(consultationsResult.consultations);
      setCalculationEntries(calculationsResult.entries);
      setCalculationTotal(calculationsResult.totalKopecks);
      setAuthenticated(true);
      window.sessionStorage.setItem("ndfl-consultant-key", key);
    } catch {
      setAuthenticated(false);
      setMessage("Ключ не подошёл или кабинет временно недоступен.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = window.sessionStorage.getItem("ndfl-consultant-key");
    if (saved) {
      const timer = window.setTimeout(() => {
        setAccessKey(saved);
        void load(saved);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  async function saveAnswer(consultationId: string) {
    const answer = answers[consultationId]?.trim() ?? "";
    if (answer.length < 10 || loading) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/consultant/answer", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ consultationId, answer }),
      });
      if (!response.ok) throw new Error("save_failed");
      setAnswers((current) => ({ ...current, [consultationId]: "" }));
      await load(accessKey);
      setMessage("Ответ сохранён и уже доступен посетителю в сейфе.");
    } catch {
      setMessage("Не удалось сохранить ответ. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    window.sessionStorage.removeItem("ndfl-consultant-key");
    setAuthenticated(false);
    setAccessKey("");
    setConsultations([]);
    setCalculationEntries([]);
    setCalculationTotal(0);
  }

  function pressCalculator(key: string) {
    if (key === "C") {
      setCalculationValue("0");
      return;
    }
    if (key === "⌫") {
      setCalculationValue((current) => current.length > 1 ? current.slice(0, -1) : "0");
      return;
    }
    setCalculationValue((current) => {
      const next = current === "0" ? key : `${current}${key}`;
      return next.slice(0, 7);
    });
  }

  async function saveCalculation() {
    const amountRubles = Number(calculationValue);
    if (!Number.isInteger(amountRubles) || amountRubles < 1 || loading) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/consultant/calculations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ amountRubles, note: calculationNote }),
      });
      if (!response.ok) throw new Error("save_failed");
      setCalculationValue("100");
      setCalculationNote("");
      await load(accessKey);
      setMessage("Сумма добавлена во внутренний расчёт.");
    } catch {
      setMessage("Не удалось сохранить сумму. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }

  async function copyQuestion(question: string) {
    try {
      await navigator.clipboard.writeText(question);
      setMessage("Вопрос скопирован. Его можно вставить в ChatGPT для подготовки черновика.");
    } catch {
      setMessage("Не удалось скопировать вопрос автоматически.");
    }
  }

  async function createAiDraft(consultationId: string) {
    if (draftingId) return;
    setDraftingId(consultationId);
    setMessage("");
    try {
      const response = await fetch("/api/consultant/ai-draft", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ consultationId }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.draft !== "string") throw new Error(result.error ?? "draft_failed");
      setAnswers((current) => ({ ...current, [consultationId]: result.draft }));
      setMessage("Черновик подготовлен. Проверьте факты и при необходимости исправьте текст перед отправкой.");
    } catch {
      setMessage("Не удалось подготовить черновик. Проверьте ключ AI Gateway, баланс Timeweb и повторите попытку.");
    } finally {
      setDraftingId(null);
    }
  }

  return (
    <main className="cabinet-page">
      <header className="cabinet-header">
        <Link className="cabinet-back" href="/" aria-label="Вернуться на сайт"><span aria-hidden="true">←</span><b>На сайт</b></Link>
        <Link className="brand cabinet-brand" href="/"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></Link>
        {authenticated && <button className="cabinet-logout" onClick={signOut}>Закрыть кабинет</button>}
      </header>

      {!authenticated ? (
        <section className="cabinet-login">
          <span className="mini-label">Закрытый раздел</span>
          <h1>Кабинет консультанта</h1>
          <p>Введите персональный ключ. Он хранится только до закрытия вкладки.</p>
          <label htmlFor="consultant-key">Ключ доступа</label>
          <input id="consultant-key" type="password" autoComplete="current-password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} />
          <button className="action-button" disabled={!accessKey || loading} onClick={() => void load(accessKey)}>{loading ? "Проверяем…" : "Войти"}</button>
          {message && <p className="cabinet-message" role="status">{message}</p>}
        </section>
      ) : (
        <section className="cabinet-workspace">
          <div className="cabinet-title"><div><span className="mini-label">Очередь обращений</span><h1>Вопросы посетителей</h1></div><button className="cabinet-refresh" disabled={loading} onClick={() => void load(accessKey)}>Обновить</button></div>
          {message && <p className="cabinet-message success" role="status">{message}</p>}
          <section className="consultation-calculator" aria-labelledby="calculator-title">
            <div className="calculator-machine">
              <div className="calculator-topline"><span>Внутренний расчёт</span><span>₽</span></div>
              <h2 id="calculator-title">Калькулятор консультаций</h2>
              <output aria-live="polite">{Number(calculationValue || 0).toLocaleString("ru-RU")} ₽</output>
              <div className="calculator-keys">
                {["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "⌫"].map((key) => (
                  <button className={key === "C" ? "calculator-clear" : ""} key={key} type="button" onClick={() => pressCalculator(key)}>{key}</button>
                ))}
              </div>
              <label htmlFor="calculation-note">Пометка</label>
              <input id="calculation-note" maxLength={120} value={calculationNote} onChange={(event) => setCalculationNote(event.target.value)} placeholder="Например: консультация № 14" />
              <button className="calculator-save" type="button" disabled={Number(calculationValue) < 1 || loading} onClick={() => void saveCalculation()}>+ Записать сумму</button>
            </div>
            <div className="calculation-ledger">
              <span className="mini-label">Сохранённые суммы</span>
              <strong>{(calculationTotal / 100).toLocaleString("ru-RU")} ₽</strong>
              <small>{calculationEntries.length} последних записей</small>
              <div className="calculation-list">
                {calculationEntries.length === 0 ? <p>Записей пока нет.</p> : calculationEntries.slice(0, 8).map((entry) => (
                  <div key={entry.id}><span>{entry.note || "Консультация"}<time>{new Date(entry.createdAt).toLocaleDateString("ru-RU")}</time></span><b>{(entry.amountKopecks / 100).toLocaleString("ru-RU")} ₽</b></div>
                ))}
              </div>
              <p className="calculator-disclaimer">Это внутренний расчёт, а не бухгалтерский или кассовый регистр.</p>
            </div>
          </section>
          {consultations.length === 0 ? <div className="cabinet-empty">Новых вопросов пока нет.</div> : consultations.map((item) => (
            <article className={`consultation-card ${item.status}`} key={item.id}>
              <header><span>{item.status === "answered" ? "Ответ отправлен" : "Ждёт ответа"}</span><time>{item.answerDueAt ? `до ${new Date(item.answerDueAt).toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"})}` : "срок уточняется"}</time></header>
              <h2>Вопрос посетителя</h2>
              <p>{item.question}</p>
              <div className="ai-draft-actions">
                <button className="ai-draft-button" type="button" disabled={Boolean(draftingId)} onClick={() => void createAiDraft(item.id)}>{draftingId === item.id ? "Готовим черновик…" : "Подготовить черновик с ИИ"}</button>
                <button className="copy-question" type="button" onClick={() => void copyQuestion(item.question)}>Скопировать вручную</button>
              </div>
              <p className="ai-review-note">Черновик не отправляется посетителю автоматически. Консультант проверяет факты, редактирует текст и сам нажимает «Отправить в сейф».</p>
              <label htmlFor={`answer-${item.id}`}>{item.status === "answered" ? "Дополнить ответ" : "Ответ консультанта"}</label>
              <textarea id={`answer-${item.id}`} maxLength={6000} value={answers[item.id] ?? ""} onChange={(event) => setAnswers((current) => ({...current, [item.id]: event.target.value}))} placeholder="Дайте понятный ответ и перечислите необходимые действия или документы." />
              <footer><span>{(answers[item.id] ?? "").length} / 6000</span><button className="action-button" disabled={(answers[item.id]?.trim().length ?? 0) < 10 || loading} onClick={() => void saveAnswer(item.id)}>Отправить в сейф</button></footer>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
