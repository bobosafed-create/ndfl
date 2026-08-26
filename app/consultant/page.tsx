"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
type IncomingAlert = { id: string; count: number };
type FeedbackItem = { id: string; category: "review" | "suggestion"; status: "pending" | "published" | "hidden"; content: string; createdAt: string; updatedAt: string };
type ScheduleDay = { day: string; enabled: boolean; start: string; end: string };

const scheduleDayLabels: Record<string, string> = {
  monday: "Понедельник", tuesday: "Вторник", wednesday: "Среда", thursday: "Четверг",
  friday: "Пятница", saturday: "Суббота", sunday: "Воскресенье",
};
const defaultServiceSchedule: ScheduleDay[] = Object.keys(scheduleDayLabels).map((day, index) => ({ day, enabled: index < 5, start: "09:00", end: "13:00" }));

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
  const [urgentTariffAvailable, setUrgentTariffAvailable] = useState(true);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [incomingAlert, setIncomingAlert] = useState<IncomingAlert | null>(null);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [serviceSchedule, setServiceSchedule] = useState<ScheduleDay[]>(defaultServiceSchedule);
  const knownConsultationIds = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);

  const playAlertSound = useCallback(() => {
    try {
      const AudioContextClass = window.AudioContext;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.43);
    } catch {
      // Если браузер запрещает звук, визуальное напоминание всё равно останется.
    }
  }, []);

  async function load(key: string, targetView: CabinetView = view) {
    setLoading(true);
    setMessage("");
    try {
      const headers = { authorization: `Bearer ${key}` };
      const [consultationsResponse, calculationsResponse, feedbackResponse] = await Promise.all([
        fetch(`/api/consultant/consultations?view=${targetView}`, { headers }),
        fetch("/api/consultant/calculations", { headers }),
        fetch("/api/consultant/feedback", { headers }),
      ]);
      if (!consultationsResponse.ok || !calculationsResponse.ok || !feedbackResponse.ok) throw new Error("unauthorized");
      const [consultationsResult, calculationsResult, feedbackResult] = await Promise.all([consultationsResponse.json(), calculationsResponse.json(), feedbackResponse.json()]);
      const items: Consultation[] = consultationsResult.consultations;
      for (const item of items) knownConsultationIds.current.add(item.id);
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
      setUrgentTariffAvailable(calculationsResult.urgentTariffAvailable !== false);
      if (Array.isArray(calculationsResult.serviceSchedule) && calculationsResult.serviceSchedule.length === 7) setServiceSchedule(calculationsResult.serviceSchedule);
      setFeedbackItems(Array.isArray(feedbackResult.feedback) ? feedbackResult.feedback : []);
      setAuthenticated(true);
      window.sessionStorage.setItem("ndfl-consultant-key", key);
      const withoutDraft = items.find((item) => item.status === "question_submitted" && !item.aiDraft);
      if (withoutDraft) {
        setMessage("Новый вопрос получен. AI-агент изучает официальные источники и готовит черновик…");
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
        setMessage("Список обновлён. AI-агент подготовил подробный черновик со ссылками — проверьте его перед отправкой.");
      } else {
        setMessage(`Данные обновлены в ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. Новых вопросов без черновика нет.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "ai_draft_failed") {
        setAuthenticated(true);
        setMessage("Список вопросов обновлён, но AI-агент не смог подготовить черновик. Повторите попытку или проверьте настройки агента Timeweb.");
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

  useEffect(() => {
    if (!authenticated || !accessKey) return;
    let cancelled = false;
    async function checkForNewQuestions() {
      try {
        const response = await fetch("/api/consultant/pending-summary", {
          headers: { authorization: `Bearer ${accessKey}` },
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const result = await response.json();
        const pending: { id: string; createdAt: string }[] = Array.isArray(result.pending) ? result.pending : [];
        const fresh = pending.filter((item) => !knownConsultationIds.current.has(item.id));
        for (const item of pending) knownConsultationIds.current.add(item.id);
        if (fresh.length === 0 || cancelled) return;

        setIncomingAlert({ id: fresh[0].id, count: fresh.length });
        if (alertsEnabled) {
          playAlertSound();
          if ("Notification" in window && Notification.permission === "granted") {
            const notification = new Notification("Новый вопрос по НДФЛ", {
              body: fresh.length === 1 ? "В кабинете появился новый вопрос." : `Новых вопросов: ${fresh.length}.`,
              icon: "/favicon.svg",
              tag: "ndfl-new-question",
            });
            notification.onclick = () => { window.focus(); notification.close(); };
          }
        }
      } catch {
        // Кратковременная ошибка сети не мешает следующей проверке.
      }
    }
    const timer = window.setInterval(() => void checkForNewQuestions(), 20_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [accessKey, alertsEnabled, authenticated, playAlertSound]);

  async function toggleAlerts() {
    if (alertsEnabled) {
      setAlertsEnabled(false);
      setMessage("Звуковой сигнал выключен. Окно о новом вопросе останется включённым.");
      return;
    }
    playAlertSound();
    let permission: NotificationPermission | "unsupported" = "unsupported";
    if ("Notification" in window) {
      permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
    }
    setAlertsEnabled(true);
    if (permission === "granted") {
      const notification = new Notification("Оповещения по НДФЛ включены", {
        body: "Проверка успешна. Здесь появится напоминание о новом вопросе.",
        icon: "/favicon.svg",
        tag: "ndfl-notification-test",
      });
      notification.onclick = () => { window.focus(); notification.close(); };
    }
    setMessage(permission === "granted"
      ? "Оповещения включены. Сейчас должно появиться пробное системное уведомление Windows."
      : "Звуковой сигнал и окно в кабинете включены. Системные уведомления браузера не разрешены.");
  }

  async function openIncomingAlert() {
    const consultationId = incomingAlert?.id ?? null;
    setIncomingAlert(null);
    setView("active");
    await load(accessKey, "active");
    if (consultationId) setSelectedId(consultationId);
  }

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
    setAuthenticated(false); setAccessKey(""); setConsultations([]); setCalculationEntries([]); setCalculationTotal(0); setAlertsEnabled(false); setIncomingAlert(null); setFeedbackItems([]);
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

  async function toggleUrgentTariff() {
    if (loading) return;
    const nextValue = !urgentTariffAvailable;
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/consultant/settings", {
        method: "POST",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ urgentTariffAvailable: nextValue }),
      });
      if (!response.ok) throw new Error("save_failed");
      setUrgentTariffAvailable(nextValue);
      setMessage(nextValue ? "Срочный тариф снова доступен посетителям." : "Срочный тариф временно отключён.");
    } catch { setMessage("Не удалось изменить доступность срочного тарифа."); }
    finally { setLoading(false); }
  }

  function updateScheduleDay(day: string, changes: Partial<ScheduleDay>) {
    setServiceSchedule((current) => current.map((entry) => entry.day === day ? { ...entry, ...changes } : entry));
  }

  async function saveServiceSchedule() {
    const invalidDay = serviceSchedule.find((entry) => entry.enabled && entry.start >= entry.end);
    if (invalidDay) {
      setMessage(`Проверьте время: для дня «${scheduleDayLabels[invalidDay.day]}» окончание должно быть позже начала.`);
      return;
    }
    if (loading) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/consultant/settings", {
        method: "POST",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ serviceSchedule }),
      });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.serviceSchedule)) throw new Error("save_failed");
      setServiceSchedule(result.serviceSchedule);
      setMessage("Дни и часы приёма сохранены и уже показаны посетителям на главной странице.");
    } catch { setMessage("Не удалось сохранить расписание. Проверьте время и повторите попытку."); }
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
        body: JSON.stringify({ consultationId, regenerate: true }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.draft !== "string") throw new Error("draft_failed");
      setAnswers((current) => ({ ...current, [consultationId]: result.draft }));
      setConsultations((current) => current.map((item) => item.id === consultationId ? { ...item, aiDraft: result.draft } : item));
      setMessage("Подробный черновик со ссылками подготовлен. Проверьте источники и факты перед отправкой.");
    } catch { setMessage("Не удалось подготовить черновик. Проверьте ключ AI-агента, баланс Timeweb и повторите попытку."); }
    finally { setDraftingId(null); }
  }

  function editFeedback(id: string, changes: Partial<FeedbackItem>) {
    setFeedbackItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  async function saveFeedback(item: FeedbackItem, status: FeedbackItem["status"] = item.status) {
    if (item.content.trim().length < 10 || loading) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/consultant/feedback", {
        method: "PATCH",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, category: item.category, status, content: item.content.trim() }),
      });
      if (!response.ok) throw new Error("save_failed");
      editFeedback(item.id, { status, content: item.content.trim() });
      setMessage(status === "published" ? "Отзыв проверен и опубликован на сайте." : status === "hidden" ? "Сообщение скрыто с сайта." : "Изменения отзыва сохранены.");
    } catch { setMessage("Не удалось сохранить отзыв или предложение."); }
    finally { setLoading(false); }
  }

  async function deleteFeedback(id: string) {
    if (!window.confirm("Навсегда удалить этот отзыв или предложение?")) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/consultant/feedback", {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("delete_failed");
      setFeedbackItems((current) => current.filter((item) => item.id !== id));
      setMessage("Отзыв или предложение удалено.");
    } catch { setMessage("Не удалось удалить сообщение."); }
    finally { setLoading(false); }
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
          <div className="cabinet-title"><div><span className="mini-label">Рабочее место</span><h1>{view === "archive" ? "Архив консультаций" : "Вопросы посетителей"}</h1></div><div className="cabinet-title-actions"><button className={`cabinet-alert-toggle ${alertsEnabled ? "enabled" : ""}`} type="button" onClick={() => void toggleAlerts()}>{alertsEnabled ? "🔔 Оповещения включены" : "🔕 Включить звук"}</button><button className="cabinet-refresh" disabled={loading} onClick={() => void load(accessKey, view)}>{loading ? "Обновляем…" : "Обновить"}</button></div></div>
          {message && <p className="cabinet-message success" role="status">{message}</p>}

          <section className="consultation-calculator" aria-labelledby="calculator-title">
            <div className="calculator-machine">
              <div className="calculator-topline"><span>Цена на сайте</span><span>₽</span></div><h2 id="calculator-title">Стоимость консультации</h2>
              <output aria-live="polite">{Number(calculationValue || 0).toLocaleString("ru-RU")} ₽</output>
              <div className="calculator-keys">{["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "⌫"].map((key) => <button className={key === "C" ? "calculator-clear" : ""} key={key} type="button" onClick={() => pressCalculator(key)}>{key}</button>)}</div>
              <button className="calculator-save" type="button" disabled={Number(calculationValue) < 1 || loading} onClick={() => void saveCalculation()}>Установить цену на сайте</button>
              <p className="calculator-disclaimer">Это цена по умолчанию. Она применяется, если посетитель не выбрал тариф. Выбор тарифной карточки действует только для его консультации; уже созданные платежи не изменяются.</p>
              <div className={`urgent-control ${urgentTariffAvailable ? "available" : "unavailable"}`}><div><b>Срочный тариф</b><span>{urgentTariffAvailable ? "Доступен посетителям" : "Временно недоступен"}</span></div><button type="button" role="switch" aria-checked={urgentTariffAvailable} disabled={loading} onClick={() => void toggleUrgentTariff()}><i /></button></div>
            </div>

            <div className="calculation-ledger">
              <span className="mini-label">Старые тестовые записи</span><strong>{(calculationTotal / 100).toLocaleString("ru-RU")} ₽</strong><small>{calculationEntries.length} записей — они не являются платежами ЮKassa</small>
              <div className="calculation-list compact">{calculationEntries.length === 0 ? <p>Тестовых записей нет.</p> : calculationEntries.map((entry) => <div key={entry.id}><span>{entry.note || "Тестовая сумма"}<time>{new Date(entry.createdAt).toLocaleDateString("ru-RU")}</time></span><b>{(entry.amountKopecks / 100).toLocaleString("ru-RU")} ₽</b><button className="ledger-delete" type="button" disabled={loading} onClick={() => void deleteCalculation(entry.id)}>×</button></div>)}</div>
              <div className="consultation-index-heading"><span className="mini-label">Перечень консультаций</span><div className="archive-tabs"><button type="button" className={view === "active" ? "active" : ""} onClick={() => void switchView("active")}>В работе · {counts.active}</button><button type="button" className={view === "archive" ? "active" : ""} onClick={() => void switchView("archive")}>Архив · {counts.archive}</button></div></div>
              <div className="consultation-index">{consultations.length === 0 ? <p>{view === "archive" ? "Архив пока пуст." : "Новых вопросов пока нет."}</p> : consultations.map((item, index) => <button type="button" className={item.id === selectedId ? "selected" : ""} key={item.id} onClick={() => setSelectedId(item.id)}><span>№ {String(index + 1).padStart(2, "0")} · {item.status === "question_submitted" ? "ждёт ответа" : item.status === "archived" ? "в архиве" : "выполнено"}</span><small>{item.tariff ? `${item.tariff.name} · ${(item.tariff.amountKopecks / 100).toLocaleString("ru-RU")} ₽ · ` : ""}{new Date(item.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></button>)}</div>
              <p className="calculator-disclaimer">Архив открывается здесь же, без дополнительного пароля.</p>
            </div>

            <section className="service-schedule-editor" aria-labelledby="schedule-title">
              <div className="schedule-heading"><div><span className="mini-label">Расписание на сайте</span><h2 id="schedule-title">Дни и часы приёма вопросов</h2></div><p>Время московское. Выключенный день не показывается посетителям.</p></div>
              <div className="schedule-table" role="table" aria-label="Расписание приёма вопросов">
                <div className="schedule-row schedule-table-head" role="row"><span role="columnheader">День</span><span role="columnheader">Приём</span><span role="columnheader">С</span><span role="columnheader">До</span></div>
                {serviceSchedule.map((entry) => <div className={`schedule-row ${entry.enabled ? "enabled" : "disabled"}`} role="row" key={entry.day}>
                  <b role="cell">{scheduleDayLabels[entry.day]}</b>
                  <label role="cell" className="schedule-switch"><input type="checkbox" checked={entry.enabled} onChange={(event) => updateScheduleDay(entry.day, { enabled: event.target.checked })}/><span>{entry.enabled ? "Открыт" : "Выходной"}</span></label>
                  <label role="cell"><span className="visually-hidden">Начало приёма в {scheduleDayLabels[entry.day]}</span><input type="time" value={entry.start} disabled={!entry.enabled} onChange={(event) => updateScheduleDay(entry.day, { start: event.target.value })}/></label>
                  <label role="cell"><span className="visually-hidden">Окончание приёма в {scheduleDayLabels[entry.day]}</span><input type="time" value={entry.end} disabled={!entry.enabled} onChange={(event) => updateScheduleDay(entry.day, { end: event.target.value })}/></label>
                </div>)}
              </div>
              <button className="schedule-save" type="button" disabled={loading} onClick={() => void saveServiceSchedule()}>Сохранить расписание</button>
            </section>
          </section>

          <section className="feedback-admin" aria-labelledby="feedback-admin-title"><div className="feedback-admin-heading"><div><span className="mini-label">Модерация</span><h2 id="feedback-admin-title">Отзывы и предложения</h2></div><b>{feedbackItems.filter((item) => item.status === "pending").length} ожидают проверки</b></div>{feedbackItems.length === 0 ? <p className="feedback-admin-empty">Новых сообщений посетителей пока нет.</p> : <div className="feedback-admin-list">{feedbackItems.map((item) => <article key={item.id} className={item.status}><header><select aria-label="Тип сообщения" value={item.category} onChange={(event) => editFeedback(item.id, { category: event.target.value as FeedbackItem["category"] })}><option value="review">Отзыв</option><option value="suggestion">Предложение</option></select><span>{item.status === "published" ? "Опубликовано" : item.status === "hidden" ? "Скрыто" : "Ожидает проверки"}</span><time>{new Date(item.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></header><textarea maxLength={700} rows={5} value={item.content} onChange={(event) => editFeedback(item.id, { content: event.target.value })}/><footer><small>{item.content.length} / 700</small><button type="button" disabled={loading || item.content.trim().length < 10} onClick={() => void saveFeedback(item)}>Сохранить</button><button className="feedback-publish" type="button" disabled={loading || item.content.trim().length < 10} onClick={() => void saveFeedback(item, "published")}>Опубликовать</button><button className="feedback-hide" type="button" disabled={loading} onClick={() => void saveFeedback(item, "hidden")}>Скрыть</button><button className="feedback-delete" type="button" disabled={loading} onClick={() => void deleteFeedback(item.id)}>Удалить</button></footer></article>)}</div>}</section>

          {!selected ? <div className="cabinet-empty">Выберите консультацию в перечне справа.</div> : (
            <article className={`consultation-editor ${selected.status}`} key={selected.id}>
              <header><div><span className="mini-label">Консультация</span><h2>{selected.status === "archived" ? "Архивная запись" : selected.status === "answered" ? "Выполненная консультация" : "Новый вопрос"}</h2>{selected.tariff && <p className="consultation-tariff">Тариф: <b>{selected.tariff.name}</b> · {(selected.tariff.amountKopecks / 100).toLocaleString("ru-RU")} ₽ · {selected.tariff.deadlineMinutes === 60 ? "1 час" : `${selected.tariff.deadlineMinutes / 60} ч`}</p>}</div><div className="consultation-status"><b>{selected.status === "question_submitted" ? "Ждёт ответа" : selected.status === "archived" ? "Архив" : "Ответ отправлен"}</b><time>{selected.answerDueAt ? `срок до ${new Date(selected.answerDueAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "без срока"}</time></div></header>
              <section className="consultation-document question-document"><h3>Вопрос посетителя</h3><p>{selected.question}</p></section>
              {selected.attachments.length > 0 && <section className="consultation-attachments no-print"><h3>Приложенные документы</h3>{selected.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => void downloadAttachment(attachment)}><span>📎 {attachment.name}</span><small>{(attachment.size / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} КБ · скачать</small></button>)}</section>}
              {selected.status === "archived" ? <section className="consultation-document answer-document"><h3>Ответ консультанта</h3><p>{selected.answer || "Ответ отсутствует."}</p></section> : <>
                <div className="ai-draft-actions no-print"><button className="ai-draft-button" type="button" disabled={Boolean(draftingId)} onClick={() => void createAiDraft(selected.id)}>{draftingId === selected.id ? "Готовим черновик…" : "Подготовить черновик с ИИ"}</button><button className="copy-question" type="button" onClick={() => void copyQuestion(selected.question)}>Скопировать вопрос</button></div>
                <p className="ai-review-note no-print">AI-агент ищет обоснование в официальных источниках и создаёт обычный текст без звёздочек. Черновик не отправляется автоматически: проверьте ссылки, факты и отредактируйте ответ.</p>
                <label className="answer-label" htmlFor={`answer-${selected.id}`}>{selected.status === "answered" ? "Редактировать отправленный ответ" : "Ответ консультанта"}</label>
                <textarea id={`answer-${selected.id}`} maxLength={14000} rows={24} value={selectedAnswer} onChange={(event) => setAnswers((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder="Проверьте вывод, ссылки на официальные источники, расчёты и необходимые действия." />
                <p className="answer-auto-note no-print">При отправке в конец ответа автоматически добавляется пометка о том, что вывод основан на предоставленных данных, а дополнительные сведения оформляются новым вопросом.</p>
                <section className="consultation-document answer-document print-only"><h3>Ответ консультанта</h3><p>{selectedAnswer}</p></section>
              </>}
              <footer className="consultation-editor-actions no-print"><button className="print-button" type="button" onClick={() => window.print()}>Печать</button>{selected.status === "archived" ? <button className="restore-button" type="button" disabled={loading} onClick={() => void setArchived(selected.id, false)}>Вернуть из архива</button> : selected.status === "answered" ? <button className="archive-button" type="button" disabled={loading} onClick={() => void setArchived(selected.id, true)}>В архив</button> : null}<button className="delete-button" type="button" disabled={loading} onClick={() => void deleteConsultation(selected.id)}>Удалить вопрос и ответ</button>{selected.status !== "archived" && <><span>{selectedAnswer.length} / 14000</span><button className="action-button" disabled={selectedAnswer.trim().length < 10 || loading} onClick={() => void saveAnswer(selected.id)}>Отправить в сейф</button></>}</footer>
            </article>
          )}
          {incomingAlert && <aside className="incoming-alert" role="alertdialog" aria-live="assertive" aria-labelledby="incoming-alert-title"><button className="incoming-alert-close" type="button" aria-label="Закрыть напоминание" onClick={() => setIncomingAlert(null)}>×</button><span className="incoming-alert-icon" aria-hidden="true">!</span><small>Новое обращение</small><h2 id="incoming-alert-title">{incomingAlert.count === 1 ? "Поступил новый вопрос" : `Поступили новые вопросы: ${incomingAlert.count}`}</h2><p>Откройте обращение и проверьте подготовленный черновик ответа.</p><div><button className="action-button" type="button" onClick={() => void openIncomingAlert()}>Открыть вопрос</button><button className="incoming-alert-later" type="button" onClick={() => setIncomingAlert(null)}>Позже</button></div></aside>}
        </section>
      )}
    </main>
  );
}
