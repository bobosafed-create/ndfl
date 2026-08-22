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

export default function ConsultantCabinet() {
  const [accessKey, setAccessKey] = useState("");
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  async function load(key: string) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/consultant/consultations", {
        headers: { authorization: `Bearer ${key}` },
      });
      if (!response.ok) throw new Error("unauthorized");
      const result = await response.json();
      setConsultations(result.consultations);
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
      setMessage("Ответ сохранён и уже доступен посетителю в сейфе.");
      setAnswers((current) => ({ ...current, [consultationId]: "" }));
      await load(accessKey);
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
  }

  return (
    <main className="cabinet-page">
      <header className="cabinet-header">
        <Link className="brand" href="/"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></Link>
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
          {consultations.length === 0 ? <div className="cabinet-empty">Новых вопросов пока нет.</div> : consultations.map((item) => (
            <article className={`consultation-card ${item.status}`} key={item.id}>
              <header><span>{item.status === "answered" ? "Ответ отправлен" : "Ждёт ответа"}</span><time>{item.answerDueAt ? `до ${new Date(item.answerDueAt).toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"})}` : "срок уточняется"}</time></header>
              <h2>Вопрос посетителя</h2>
              <p>{item.question}</p>
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
