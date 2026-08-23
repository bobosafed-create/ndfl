"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Consultation = {
  id: string;
  status: "question_submitted" | "answered" | "archived";
  answerDueAt: string | null;
  createdAt: string;
  archivedAt: string | null;
  question: string;
  answer: string | null;
  aiDraft: string | null;
  tariff: { code: string; name: string; amountKopecks: number; deadlineMinutes: number } | null;
  attachments: { id: string; name: string; mimeType: string; size: number }[];
};

type CalculationEntry = { id: string; amountKopecks: number; note: string; createdAt: string };
type CabinetView = "active" | "archive";

export default function ConsultantCabinet() {
  const [accessKey, setAccessKey] = useState("");
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [counts, setCounts] = useState({ active: 0, archive: 0 });
  const [view, setView] = useState<CabinetView>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [calculationValue, setCalculationValue] = useState("100");
  const [calculationEntries, setCalculationEntries] = useState<CalculationEntry[]>([]);
  const [calculationTotal, setCalculationTotal] = useState(0);
  const [draftingId, setDraftingId] = useState<string | null>(null);

  async function load(key: string, targetView: CabinetView = view) {
    setLoading(true);
    setMessage("");
    try {
      const headers = { authorization: `Bearer ${key}` };
      const [consultationsResponse, calculationsResponse] = await Promise.all([
        fetch(`/api/consultant/consultations?view=${targetView}`, { headers }),
        fetch("/api/consultant/calculations", { headers }),
      ]);
      if (!consultationsResponse.ok || !calculationsResponse.ok) throw new Error("unauthorized");
      const [consultationsResult, calculationsResult] = await Promise.all([consultationsResponse.json(), calculationsResponse.json()]);
      const items: Consultation[] = consultationsResult.consultations;
      setConsultations(items);
      setCounts(consultationsResult.counts ?? { active: items.length, archive: 0 });
      setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? null);
      setAnswers((current) => {
        const next = { ...current };
        for (const item of items) if (next[item.id] === undefined && (item.answer || item.aiDraft)) next[item.id] = item.answer || item.aiDraft || "";
        return next;
      });
      setCalculationEntries(calculationsResult.entries);
      setCalculationTotal(calculationsResult.totalKopecks);
      setCalculationValue(String((calculationsResult.currentPriceKopecks ?? 10000) / 100));
      setAuthenticated(true);
      window.sessionStorage.setItem("ndfl-consultant-key", key);
      const withoutDraft = items.find((item) => item.status === "question_submitted" && !item.aiDraft);
      if (withoutDraft) {
        setMessage("Новый вопрос получен. Qwen готовит черновик ответа…");
        const draftResponse = await fetch("/api/consultant/ai-draft", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ consultationId: withoutDraft.id }),
        });
        const draftResult = await draftResponse.json();
        if (!draftResponse.ok || typeof draftResult.draft !== "string") throw new Error("ai_draft_failed");
        setAnswers((current) => ({ ...current, [withoutDraft.id]: draftResult.draft }));
        setConsultations((current) => current.map((item) => item.id === withoutDraft.id ? { ...item, aiDraft: draftResult.draft } : item));
        setSelectedId(withoutDraft.id);
        setMessage("Список обновлён. Qwen подготовил черновик нового ответа — проверьте его перед отправкой.");
      } else {
        setMessage(`Данные обновлены в ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. Новых вопросов без черновика нет.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "ai_draft_failed") {
        setAuthenticated(true);
        setMessage("Список вопросов обновлён, но Qwen не смог подготовить черновик. Нажмите «Подготовить черновик с ИИ» ещё раз или проверьте AI Gateway.");
        return;
      }
      setAuthenticated(false);
      setMessage("Ключ не подошёл или кабинет временно недоступен.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = window.sessionStorage.getItem("ndfl-consultant-key");
    if (saved) {
      const timer = window.setTimeout(() => { setAccessKey(saved); void load(saved, "active"); }, 0);
      return () => window.clearTimeout(timer);
    }
  // Восстановление выполняется один раз при открытии вкладки.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchView(targetView: CabinetView) {
    setView(targetView);
    setSelectedId(null);
    await load(accessKey, targetView);
  }

  async function saveAnswer(consultationId: string) {
    const answer = answers[consultationId]?.trim() ?? "";
    if (answer.length < 10 || loading) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/consultant/answer", {
        method: "POST",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ consultationId, answer }),
      });
      if (!response.ok) throw new Error("save_failed");
      const result = await response.json();
      setAnswers((current) => ({ ...current, [consultationId]: result.answer || answer }));
      await load(accessKey, view);
      setSelectedId(consultationId);
      setMessage("Ответ сохранён и уже доступен посетителю в сейфе.");
    } catch {
      setMessage("Не удалось сохранить ответ. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }

  async function setArchived(consultationId: string, archived: boolean) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/consultant/archive", {
        method: "POST",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ consultationId, archived }),
      });
      if (!response.ok) throw new Error("archive_failed");
      await load(accessKey, view);
      setMessage(archived ? "Выполненная консультация перенесена в архив." : "Консультация возвращена из архива.");
    } catch {
      setMessage("Не удалось изменить архив. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteConsultation(consultationId: string) {
    const confirmed = window.confirm("Навсегда удалить вопрос, ответ и приложенные документы? Платёжная запись останется без содержания консультации.");
    if (!confirmed) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/consultant/consultations", {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ consultationId }),
      });
      if (!response.ok) throw new Error("delete_failed");
      setAnswers((current) => { const next = { ...current }; delete next[consultationId]; return next; });
      await load(accessKey, view);
      setMessage("Вопрос, ответ и приложенные документы удалены без возможности восстановления.");
    } catch {
      setMessage("Не удалось удалить консультацию. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    window.sessionStorage.removeItem("ndfl-consultant-key");
    setAuthenticated(false); setAccessKey(""); setConsultations([]); setCalculationEntries([]); setCalculationTotal(0);
  }

  function pressCalculator(key: string) {
    if (key === "C") return setCalculationValue("0");
    if (key === "⌫") return setCalculationValue((current) => current.length > 1 ? current.slice(0, -1) : "0");
    setCalculationValue((current) => (current === "0" ? key : `${current}${key}`).slice(0, 7));
  }

  async function saveCalculation() {
    const amountRubles = Number(calculationValue);
    if (!Number.isInteger(amountRubles) || amountRubles < 1 || loading) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/consultant/calculations", {
        method: "POST",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ amountRubles }),
      });
      if (!response.ok) throw new Error("save_failed");
      await load(accessKey, view);
      setMessage(`Новая цена ${amountRubles.toLocaleString("ru-RU")} ₽ установлена. Она применяется только к новым платежам.`);
    } catch { setMessage("Не удалось сохранить сумму. Повторите попытку."); }
    finally { setLoading(false); }
  }

  async function deleteCalculation(id: string) {
    if (!window.confirm("Удалить эту старую тестовую сумму?")) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/consultant/calculations", {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("delete_failed");
      await load(accessKey, view); setMessage("Тестовая сумма удалена.");
    } catch { setMessage("Не удалось удалить тестовую сумму."); }
    finally { setLoading(false); }
  }

  async function downloadAttachment(attachment: Consultation["attachments"][number]) {
    try {
      const response = await fetch(`/api/consultant/attachments?id=${encodeURIComponent(attachment.id)}`, { headers: { authorization: `Bearer ${accessKey}` } });
      if (!response.ok) throw new Error("download_failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = attachment.name; link.click();
      URL.revokeObjectURL(url);
    } catch { setMessage("Не удалось скачать документ."); }
  }

  async function copyQuestion(question: string) {
    try { await navigator.clipboard.writeText(question); setMessage("Вопрос скопирован."); }
    catch { setMessage("Не удалось скопировать вопрос автоматически."); }
  }

  async function createAiDraft(consultationId: string) {
    if (draftingId) return;
    setDraftingId(consultationId); setMessage("");
    try {
      const response = await fetch("/api/consultant/ai-draft", {
        method: "POST",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ consultationId }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.draft !== "string") throw new Error("draft_failed");
      setAnswers((current) => ({ ...current, [consultationId]: result.draft }));
      setConsultations((current) => current.map((item) => item.id === consultationId ? { ...item, aiDraft: result.draft } : item));
      setMessage("Черновик подготовлен без Markdown-разметки. Проверьте факты перед отправкой.");
    } catch { setMessage("Не удалось подготовить черновик. Проверьте ключ AI Gateway, баланс Timeweb и повторите попытку."); }
    finally { setDraftingId(null); }
  }

  const selected = consultations.find((item) => item.id === selectedId) ?? null;
  const selectedAnswer = selected ? answers[selected.id] ?? selected.answer ?? "" : "";

  return (
    <main className="cabinet-page">
      <header className="cabinet-header">
        <button className="cabinet-back" type="button" onClick={() => window.location.assign("/#room")} aria-label="Вернуться на сайт"><span aria-hidden="true">←</span><b>На сайт</b></button>
        <Link className="brand cabinet-brand" href="/"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></Link>
        {authenticated && <button className="cabinet-logout" onClick={signOut}>Закрыть кабинет</button>}
      </header>

      {!authenticated ? (
        <section className="cabinet-login">
          <span className="mini-label">Закрытый раздел</span><h1>Кабинет консультанта</h1>
          <p>Введите персональный ключ. Он хранится только до закрытия вкладки.</p>
          <label htmlFor="consultant-key">Ключ доступа</label>
          <input id="consultant-key" type="password" autoComplete="current-password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} />
          <button className="action-button" disabled={!accessKey || loading} onClick={() => void load(accessKey, "active")}>{loading ? "Проверяем…" : "Войти"}</button>
          {message && <p className="cabinet-message" role="status">{message}</p>}
        </section>
      ) : (
        <section className="cabinet-workspace">
          <div className="cabinet-title"><div><span className="mini-label">Рабочее место</span><h1>{view === "archive" ? "Архив консультаций" : "Вопросы посетителей"}</h1></div><button className="cabinet-refresh" disabled={loading} onClick={() => void load(accessKey, view)}>{loading ? "Обновляем…" : "Обновить"}</button></div>
          {message && <p className="cabinet-message success" role="status">{message}</p>}

          <section className="consultation-calculator" aria-labelledby="calculator-title">
            <div className="calculator-machine">
              <div className="calculator-topline"><span>Цена на сайте</span><span>₽</span></div><h2 id="calculator-title">Стоимость консультации</h2>
              <output aria-live="polite">{Number(calculationValue || 0).toLocaleString("ru-RU")} ₽</output>
              <div className="calculator-keys">{["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "⌫"].map((key) => <button className={key === "C" ? "calculator-clear" : ""} key={key} type="button" onClick={() => pressCalculator(key)}>{key}</button>)}</div>
              <button className="calculator-save" type="button" disabled={Number(calculationValue) < 1 || loading} onClick={() => void saveCalculation()}>Установить цену на сайте</button>
              <p className="calculator-disclaimer">Это цена по умолчанию. Она применяется, если посетитель не выбрал тариф. Выбор тарифной карточки действует только для его консультации; уже созданные платежи не изменяются.</p>
            </div>

            <div className="calculation-ledger">
              <span className="mini-label">Старые тестовые записи</span><strong>{(calculationTotal / 100).toLocaleString("ru-RU")} ₽</strong><small>{calculationEntries.length} записей — они не являются платежами ЮKassa</small>
              <div className="calculation-list compact">{calculationEntries.length === 0 ? <p>Тестовых записей нет.</p> : calculationEntries.map((entry) => <div key={entry.id}><span>{entry.note || "Тестовая сумма"}<time>{new Date(entry.createdAt).toLocaleDateString("ru-RU")}</time></span><b>{(entry.amountKopecks / 100).toLocaleString("ru-RU")} ₽</b><button className="ledger-delete" type="button" disabled={loading} onClick={() => void deleteCalculation(entry.id)}>×</button></div>)}</div>
              <div className="consultation-index-heading"><span className="mini-label">Перечень консультаций</span><div className="archive-tabs"><button type="button" className={view === "active" ? "active" : ""} onClick={() => void switchView("active")}>В работе · {counts.active}</button><button type="button" className={view === "archive" ? "active" : ""} onClick={() => void switchView("archive")}>Архив · {counts.archive}</button></div></div>
              <div className="consultation-index">{consultations.length === 0 ? <p>{view === "archive" ? "Архив пока пуст." : "Новых вопросов пока нет."}</p> : consultations.map((item, index) => <button type="button" className={item.id === selectedId ? "selected" : ""} key={item.id} onClick={() => setSelectedId(item.id)}><span>№ {String(index + 1).padStart(2, "0")} · {item.status === "question_submitted" ? "ждёт ответа" : item.status === "archived" ? "в архиве" : "выполнено"}</span><small>{item.tariff ? `${item.tariff.name} · ${(item.tariff.amountKopecks / 100).toLocaleString("ru-RU")} ₽ · ` : ""}{new Date(item.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></button>)}</div>
              <p className="calculator-disclaimer">Архив открывается здесь же, без дополнительного пароля.</p>
            </div>
          </section>

          {!selected ? <div className="cabinet-empty">Выберите консультацию в перечне справа.</div> : (
            <article className={`consultation-editor ${selected.status}`} key={selected.id}>
              <header><div><span className="mini-label">Консультация</span><h2>{selected.status === "archived" ? "Архивная запись" : selected.status === "answered" ? "Выполненная консультация" : "Новый вопрос"}</h2>{selected.tariff && <p className="consultation-tariff">Тариф: <b>{selected.tariff.name}</b> · {(selected.tariff.amountKopecks / 100).toLocaleString("ru-RU")} ₽ · {selected.tariff.deadlineMinutes === 60 ? "1 час" : `${selected.tariff.deadlineMinutes / 60} ч`}</p>}</div><div className="consultation-status"><b>{selected.status === "question_submitted" ? "Ждёт ответа" : selected.status === "archived" ? "Архив" : "Ответ отправлен"}</b><time>{selected.answerDueAt ? `срок до ${new Date(selected.answerDueAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "без срока"}</time></div></header>
              <section className="consultation-document question-document"><h3>Вопрос посетителя</h3><p>{selected.question}</p></section>
              {selected.attachments.length > 0 && <section className="consultation-attachments no-print"><h3>Приложенные документы</h3>{selected.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => void downloadAttachment(attachment)}><span>📎 {attachment.name}</span><small>{(attachment.size / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} КБ · скачать</small></button>)}</section>}
              {selected.status === "archived" ? <section className="consultation-document answer-document"><h3>Ответ консультанта</h3><p>{selected.answer || "Ответ отсутствует."}</p></section> : <>
                <div className="ai-draft-actions no-print"><button className="ai-draft-button" type="button" disabled={Boolean(draftingId)} onClick={() => void createAiDraft(selected.id)}>{draftingId === selected.id ? "Готовим черновик…" : "Подготовить черновик с ИИ"}</button><button className="copy-question" type="button" onClick={() => void copyQuestion(selected.question)}>Скопировать вопрос</button></div>
                <p className="ai-review-note no-print">ИИ создаёт обычный текст без звёздочек. Черновик не отправляется автоматически: проверьте и отредактируйте его.</p>
                <label className="answer-label" htmlFor={`answer-${selected.id}`}>{selected.status === "answered" ? "Редактировать отправленный ответ" : "Ответ консультанта"}</label>
                <textarea id={`answer-${selected.id}`} maxLength={5750} rows={18} value={selectedAnswer} onChange={(event) => setAnswers((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder="Дайте понятный ответ и перечислите необходимые действия или документы." />
                <p className="answer-auto-note no-print">При отправке в конец ответа автоматически добавляется пометка о том, что вывод основан на предоставленных данных, а дополнительные сведения оформляются новым вопросом.</p>
                <section className="consultation-document answer-document print-only"><h3>Ответ консультанта</h3><p>{selectedAnswer}</p></section>
              </>}
              <footer className="consultation-editor-actions no-print"><button className="print-button" type="button" onClick={() => window.print()}>Печать</button>{selected.status === "archived" ? <button className="restore-button" type="button" disabled={loading} onClick={() => void setArchived(selected.id, false)}>Вернуть из архива</button> : selected.status === "answered" ? <button className="archive-button" type="button" disabled={loading} onClick={() => void setArchived(selected.id, true)}>В архив</button> : null}<button className="delete-button" type="button" disabled={loading} onClick={() => void deleteConsultation(selected.id)}>Удалить вопрос и ответ</button>{selected.status !== "archived" && <><span>{selectedAnswer.length} / 5750</span><button className="action-button" disabled={selectedAnswer.trim().length < 10 || loading} onClick={() => void saveAnswer(selected.id)}>Отправить в сейф</button></>}</footer>
            </article>
          )}
        </section>
      )}
    </main>
  );
}
