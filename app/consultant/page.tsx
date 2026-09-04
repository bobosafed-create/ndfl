"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Consultation = {
  id: string;
  status: "question_submitted" | "answered" | "received" | "archived";
  answerDueAt: string | null;
  createdAt: string;
  archivedAt: string | null;
  recoveryCode: string | null;
  answerOpenedAt: string | null;
  question: string;
  answer: string | null;
  aiDraft: string | null;
  tariff: { code: string; name: string; amountKopecks: number; deadlineMinutes: number } | null;
  tariffAssessment: string[];
  tariffAssessmentConfirmed: boolean;
  upgradeStatus: null | "requested" | "declined" | "awaiting_payment" | "completed";
  upgradeRequestedAt: string | null;
  upgradeCompletedAt: string | null;
  attachments: { id: string; name: string; mimeType: string; size: number }[];
};

type CabinetView = "active" | "archive";
type DraftMode = "brief" | "detailed";
type IncomingAlert = { id: string; count: number };
type FeedbackItem = { id: string; category: "review" | "suggestion"; status: "pending" | "published" | "hidden"; content: string; createdAt: string; updatedAt: string };
type ScheduleDay = { day: string; enabled: boolean; start: string; end: string };

const scheduleDayLabels: Record<string, string> = {
  monday: "Понедельник", tuesday: "Вторник", wednesday: "Среда", thursday: "Четверг",
  friday: "Пятница", saturday: "Суббота", sunday: "Воскресенье",
};
const defaultServiceSchedule: ScheduleDay[] = Object.keys(scheduleDayLabels).map((day, index) => ({ day, enabled: index < 5, start: "09:00", end: "13:00" }));
const tariffAssessmentLabels: Record<string, string> = {
  "exact-calculation": "точный расчёт налога или возврата",
  "multiple-items": "несколько сделок, объектов или налоговых периодов",
  "compare-options": "сравнение способов уменьшения налога",
  spouses: "распределение вычета между супругами",
  investments: "инвестиции, иностранные доходы или несколько брокеров",
  "loss-offset": "сальдирование убытков",
  "tax-notice": "анализ требования или уведомления ФНС",
  "legal-detail": "подробное нормативное обоснование",
  "multiple-questions": "несколько связанных вопросов",
};

function aiDraftErrorMessage(error: unknown) {
  if (error === "ai_payment_required") return "GigaChat отклонил запрос из-за тарифа или доступного остатка токенов. Проверьте условия проекта GigaChat API.";
  if (error === "ai_credentials_rejected") return "GigaChat не принял Authorization Key или выбранный GIGACHAT_SCOPE. Сверьте их с одним и тем же проектом API.";
  if (error === "ai_model_unavailable") return "Модель GigaChat-2-Max недоступна этому проекту либо запрос не прошёл проверку параметров.";
  if (error === "ai_limit_reached") return "GigaChat достиг установленной квоты или временного ограничения запросов. Повторите позже и проверьте статистику проекта.";
  return "GigaChat временно недоступен. Повторите попытку; если ошибка сохранится, проверьте журнал приложения Timeweb.";
}

function answerWasSent(status: Consultation["status"]) {
  return status === "answered" || status === "received";
}

function consultationStatusLabel(status: Consultation["status"]) {
  if (status === "question_submitted") return "ЖДЁТ ОТВЕТА";
  if (status === "answered") return "ОТВЕТ ОТПРАВЛЕН В СЕЙФ";
  if (status === "received") return "ОТВЕТ ПОЛУЧЕН, КОНСУЛЬТАЦИЯ ЗАВЕРШЕНА";
  return "В АРХИВЕ";
}

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
  const [urgentTariffAvailable, setUrgentTariffAvailable] = useState(true);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draftingMode, setDraftingMode] = useState<DraftMode | null>(null);
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
      setUrgentTariffAvailable(calculationsResult.urgentTariffAvailable !== false);
      if (Array.isArray(calculationsResult.serviceSchedule) && calculationsResult.serviceSchedule.length === 7) setServiceSchedule(calculationsResult.serviceSchedule);
      setFeedbackItems(Array.isArray(feedbackResult.feedback) ? feedbackResult.feedback : []);
      setAuthenticated(true);
      window.sessionStorage.setItem("ndfl-consultant-key", key);
      const withoutDraft = items.find((item) => item.status === "question_submitted" && !item.aiDraft);
      if (withoutDraft) {
        const automaticDraftMode: DraftMode = withoutDraft.tariff?.amountKopecks === 99_000 ? "detailed" : "brief";
        setMessage(automaticDraftMode === "detailed"
          ? "Новый вопрос по подробному тарифу получен. GigaChat готовит детализированный черновик…"
          : "Новый вопрос получен. GigaChat готовит краткий черновик для проверки консультантом…");
        const draftResponse = await fetch("/api/consultant/ai-draft", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ consultationId: withoutDraft.id, mode: automaticDraftMode }),
        });
        const draftResult = await draftResponse.json();
        if (!draftResponse.ok || typeof draftResult.draft !== "string") throw new Error(draftResult.error || "ai_unavailable");
        setAnswers((current) => ({ ...current, [withoutDraft.id]: draftResult.draft }));
        setConsultations((current) => current.map((item) => item.id === withoutDraft.id ? { ...item, aiDraft: draftResult.draft } : item));
        setSelectedId(withoutDraft.id);
        setMessage("Список обновлён. GigaChat подготовил черновик — обязательно проверьте нормы, реквизиты источников и факты перед отправкой.");
      } else {
        setMessage(`Данные обновлены в ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. Новых вопросов без черновика нет.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("ai_")) {
        setAuthenticated(true);
        setMessage(`Список вопросов обновлён, но черновик не подготовлен. ${aiDraftErrorMessage(error.message)}`);
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
        const active: { id: string; status: Consultation["status"]; upgradeStatus?: Consultation["upgradeStatus"]; answerOpenedAt?: string | null }[] = Array.isArray(result.active) ? result.active : [];
        if (active.length > 0) {
          const statusById = new Map(active.map((item) => [item.id, item.status]));
          setConsultations((current) => current.map((item) => {
            const status = statusById.get(item.id);
            const remote = active.find((entry) => entry.id === item.id);
            return status ? { ...item, status, upgradeStatus: remote?.upgradeStatus ?? item.upgradeStatus, answerOpenedAt: remote?.answerOpenedAt ?? item.answerOpenedAt } : item;
          }));
        }
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
      setConsultations((current) => current.map((item) => item.id === consultationId ? { ...item, status: "archived", answer: result.answer || answer } : item));
      setView("archive");
      await load(accessKey, "archive");
      setSelectedId(consultationId);
      setMessage("ОТВЕТ ОТПРАВЛЕН В СЕЙФ. Вопрос и ответ автоматически перенесены в архив. Ответ доступен посетителю по персональному коду.");
    } catch {
      setMessage("Не удалось сохранить ответ. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }

  async function requestTariffUpgrade(consultationId: string) {
    if (loading) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/consultant/request-upgrade", {
        method: "POST",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ consultationId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "upgrade_failed");
      setConsultations((current) => current.map((item) => item.id === consultationId ? { ...item, upgradeStatus: "requested", upgradeRequestedAt: new Date().toISOString() } : item));
      setMessage("Посетителю предложено сохранить краткий тариф или доплатить 600 ₽ за подробный разбор.");
    } catch {
      setMessage("Не удалось отправить предложение о доплате. Обновите список и повторите попытку.");
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
    setAuthenticated(false); setAccessKey(""); setConsultations([]); setAlertsEnabled(false); setIncomingAlert(null); setFeedbackItems([]);
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
      setMessage(nextValue ? "Допопция «Срочно» снова доступна посетителям." : "Допопция «Срочно» временно отключена.");
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

  async function createAiDraft(consultationId: string, mode: DraftMode) {
    if (draftingId) return;
    setDraftingId(consultationId); setDraftingMode(mode); setMessage("");
    try {
      const response = await fetch("/api/consultant/ai-draft", {
        method: "POST",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: JSON.stringify({ consultationId, mode, regenerate: true }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.draft !== "string") throw new Error(result.error || "ai_unavailable");
      setAnswers((current) => ({ ...current, [consultationId]: result.draft }));
      setConsultations((current) => current.map((item) => item.id === consultationId ? { ...item, aiDraft: result.draft } : item));
      setMessage(`${mode === "detailed" ? "Детализированный" : "Краткий"} черновик GigaChat подготовлен. Проверьте нормы, реквизиты источников и факты перед отправкой.`);
    } catch (error) { setMessage(`Не удалось подготовить черновик. ${aiDraftErrorMessage(error instanceof Error ? error.message : "ai_unavailable")}`); }
    finally { setDraftingId(null); setDraftingMode(null); }
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
              <div className="calculator-topline"><span>Тарифы на сайте</span><span>₽</span></div><h2 id="calculator-title">Стоимость услуг</h2>
              <div className="cabinet-fixed-tariffs"><p><b>Проверка ситуации</b><strong>390 ₽</strong><small>до 4 часов</small></p><p><b>Расчёт и подробный разбор</b><strong>990 ₽</strong><small>до 8 часов</small></p></div>
              <p className="calculator-disclaimer">Тарифы фиксированы в коде сайта. Уже созданные платежи сохраняют цену и срок, действовавшие в момент оплаты.</p>
              <div className={`urgent-control ${urgentTariffAvailable ? "available" : "unavailable"}`}><div><b>Допопция «Срочно» · +300 ₽ · до 2 часов</b><span>{urgentTariffAvailable ? "Доступна посетителям" : "Временно недоступна"}</span></div><button type="button" role="switch" aria-checked={urgentTariffAvailable} disabled={loading} onClick={() => void toggleUrgentTariff()}><i /></button></div>
            </div>

            <div className="calculation-ledger">
              <div className="consultation-index-heading"><span className="mini-label">Перечень консультаций</span><div className="archive-tabs"><button type="button" className={view === "active" ? "active" : ""} onClick={() => void switchView("active")}>В работе · {counts.active}</button><button type="button" className={view === "archive" ? "active" : ""} onClick={() => void switchView("archive")}>Архив · {counts.archive}</button></div></div>
              <div className="consultation-index">{consultations.length === 0 ? <p>{view === "archive" ? "Архив пока пуст." : "Новых вопросов пока нет."}</p> : consultations.map((item, index) => <button type="button" className={`${item.id === selectedId ? "selected" : ""} ${answerWasSent(item.status) ? "answered" : ""} ${item.status === "received" ? "received" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}><span>№ {String(index + 1).padStart(2, "0")} · {consultationStatusLabel(item.status)}</span><small>{item.tariff ? `${item.tariff.name} · ${(item.tariff.amountKopecks / 100).toLocaleString("ru-RU")} ₽ · ` : ""}{new Date(item.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></button>)}</div>
              <p className="calculator-disclaimer">Архив открывается здесь же, без дополнительного пароля.</p>
            </div>

            <section className="service-schedule-editor" aria-labelledby="schedule-title">
              <div className="schedule-heading"><div><span className="mini-label">Расписание на сайте</span><h2 id="schedule-title">Дни и часы приёма вопросов</h2></div><p>Время московское. Выключенный день не показывается посетителям.</p></div>
              <div className="schedule-table" role="table" aria-label="Расписание приёма вопросов">
                <div className="schedule-row schedule-table-head" role="row"><span role="columnheader">День</span><span role="columnheader">Приём</span><span role="columnheader">С</span><span role="columnheader">До</span></div>
                {serviceSchedule.map((entry) => <div className={`schedule-row ${entry.enabled ? "enabled" : "disabled"}`} role="row" key={entry.day}>
                  <b role="cell">{scheduleDayLabels[entry.day]}</b>
                  <label role="cell" className="schedule-switch"><input type="checkbox" checked={entry.enabled} onChange={(event) => updateScheduleDay(entry.day, { enabled: event.target.checked })}/><span>{entry.enabled ? "Открыт" : "Выходной"}</span></label>
                  <label role="cell"><span className="schedule-mobile-time-label" aria-hidden="true">С</span><span className="visually-hidden">Начало приёма в {scheduleDayLabels[entry.day]}</span><input type="time" value={entry.start} disabled={!entry.enabled} onChange={(event) => updateScheduleDay(entry.day, { start: event.target.value })}/></label>
                  <label role="cell"><span className="schedule-mobile-time-label" aria-hidden="true">До</span><span className="visually-hidden">Окончание приёма в {scheduleDayLabels[entry.day]}</span><input type="time" value={entry.end} disabled={!entry.enabled} onChange={(event) => updateScheduleDay(entry.day, { end: event.target.value })}/></label>
                </div>)}
              </div>
              <button className="schedule-save" type="button" disabled={loading} onClick={() => void saveServiceSchedule()}>Сохранить расписание</button>
            </section>
          </section>

          <section className="feedback-admin" aria-labelledby="feedback-admin-title"><div className="feedback-admin-heading"><div><span className="mini-label">Модерация</span><h2 id="feedback-admin-title">Отзывы и предложения</h2></div><b>{feedbackItems.filter((item) => item.status === "pending").length} ожидают проверки</b></div>{feedbackItems.length === 0 ? <p className="feedback-admin-empty">Новых сообщений посетителей пока нет.</p> : <div className="feedback-admin-list">{feedbackItems.map((item) => <article key={item.id} className={item.status}><header><select aria-label="Тип сообщения" value={item.category} onChange={(event) => editFeedback(item.id, { category: event.target.value as FeedbackItem["category"] })}><option value="review">Отзыв</option><option value="suggestion">Предложение</option></select><span>{item.status === "published" ? "Опубликовано" : item.status === "hidden" ? "Скрыто" : "Ожидает проверки"}</span><time>{new Date(item.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></header><textarea maxLength={700} rows={5} value={item.content} onChange={(event) => editFeedback(item.id, { content: event.target.value })}/><footer><small>{item.content.length} / 700</small><button type="button" disabled={loading || item.content.trim().length < 10} onClick={() => void saveFeedback(item)}>Сохранить</button><button className="feedback-publish" type="button" disabled={loading || item.content.trim().length < 10} onClick={() => void saveFeedback(item, "published")}>Опубликовать</button><button className="feedback-hide" type="button" disabled={loading} onClick={() => void saveFeedback(item, "hidden")}>Скрыть</button><button className="feedback-delete" type="button" disabled={loading} onClick={() => void deleteFeedback(item.id)}>Удалить</button></footer></article>)}</div>}</section>

          {!selected ? <div className="cabinet-empty">Выберите консультацию в перечне выше.</div> : (
            <article className={`consultation-editor ${selected.status}`} key={selected.id}>
              <header><div><span className="mini-label">Консультация</span><h2>{selected.status === "archived" ? "Архивная запись" : answerWasSent(selected.status) ? "Выполненная консультация" : "Новый вопрос"}</h2>{selected.tariff && <p className="consultation-tariff">Тариф: <b>{selected.tariff.name}</b> · {(selected.tariff.amountKopecks / 100).toLocaleString("ru-RU")} ₽ · {selected.tariff.deadlineMinutes === 60 ? "1 час" : `${selected.tariff.deadlineMinutes / 60} ч`}</p>}</div><div className={`consultation-status ${answerWasSent(selected.status) ? "answered" : ""} ${selected.status === "received" ? "received" : ""}`}><b>{selected.status === "archived" ? "АРХИВ" : consultationStatusLabel(selected.status)}</b><time>{selected.status === "received" ? "посетитель успешно открыл сейф" : selected.answerDueAt ? `срок до ${new Date(selected.answerDueAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "без срока"}</time></div></header>
              <section className="consultation-document question-document"><div className="question-document-heading"><h3>Вопрос посетителя</h3><aside className="consultant-recovery-code no-print"><small>Код от сейфа</small><strong>{selected.recoveryCode ?? "Не сохранён"}</strong></aside></div><p>{selected.question}</p><small className="recovery-code-warning no-print">Сообщайте код только после проверки принадлежности обращения, например по идентификатору платежа. Для открытия ответа нужен исходный браузер. Для старых записей зашифрованная копия кода может отсутствовать.</small></section>
              {selected.status === "archived" && <p className="archive-delivery-status" role="status">{selected.answerOpenedAt ? "ОТВЕТ ПОЛУЧЕН, КОНСУЛЬТАЦИЯ ЗАВЕРШЕНА" : "ОТВЕТ ОТПРАВЛЕН В СЕЙФ — ожидает открытия посетителем"}</p>}
              {selected.tariffAssessmentConfirmed && <section className="consultation-tariff-assessment no-print"><h3>Основание выбора тарифа</h3>{selected.tariffAssessment.length > 0 ? <ul>{selected.tariffAssessment.map((item) => <li key={item}>{tariffAssessmentLabels[item] ?? item}</li>)}</ul> : <p>Посетитель подтвердил: один объект или одна операция, без сложного расчёта и сравнения вариантов.</p>}</section>}
              {selected.status === "question_submitted" && (selected.tariff?.code.startsWith("situation-check") || selected.upgradeStatus !== null) && <section className={`consultation-upgrade-status ${selected.upgradeStatus ?? "available"} no-print`}><h3>Соответствие тарифа вопросу</h3>{selected.upgradeStatus === null && <><p>Если вопрос выходит за рамки краткой проверки, предложите посетителю выбор: оставить исходный объём либо доплатить 600 ₽.</p><button type="button" disabled={loading} onClick={() => void requestTariffUpgrade(selected.id)}>Требуется подробный разбор</button></>}{selected.upgradeStatus === "requested" && <p><b>Ожидается выбор посетителя.</b> Ответ пока не отправляйте.</p>}{selected.upgradeStatus === "awaiting_payment" && <p><b>Посетитель выбрал доплату 600 ₽.</b> Ожидается подтверждение платежа.</p>}{selected.upgradeStatus === "declined" && <p><b>Посетитель оставил тариф 390 ₽.</b> Подготовьте краткий ответ в первоначальном объёме.</p>}{selected.upgradeStatus === "completed" && <p><b>Доплата получена.</b> Подготовьте подробный разбор; срок рассчитан заново от момента оплаты.</p>}</section>}
              {selected.attachments.length > 0 && <section className="consultation-attachments no-print"><h3>Приложенные документы</h3>{selected.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => void downloadAttachment(attachment)}><span>📎 {attachment.name}</span><small>{(attachment.size / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} КБ · скачать</small></button>)}</section>}
              {selected.status === "archived" ? <section className="consultation-document answer-document"><h3>Ответ консультанта</h3><p>{selected.answer || "Ответ отсутствует."}</p></section> : <>
                <div className="ai-draft-actions no-print">
                  <button className="ai-draft-button" type="button" disabled={Boolean(draftingId)} onClick={() => void createAiDraft(selected.id, "brief")}>{draftingId === selected.id && draftingMode === "brief" ? "Готовим краткий черновик…" : "Подготовить черновик в GigaChat"}</button>
                  <button className="ai-draft-button ai-draft-button-detailed" type="button" disabled={Boolean(draftingId)} onClick={() => void createAiDraft(selected.id, "detailed")}>{draftingId === selected.id && draftingMode === "detailed" ? "Готовим детализированный черновик…" : "Подготовить детализированный черновик в GigaChat"}</button>
                  <button className="copy-question" type="button" onClick={() => void copyQuestion(selected.question)}>Скопировать вопрос</button>
                </div>
                <p className="ai-review-note no-print">GigaChat создаёт вспомогательный черновик без гарантированного доступа к актуальным правовым базам. Он не отправляется автоматически: консультант обязан проверить нормы, реквизиты источников, расчёты и факты.</p>
                <label className="answer-label" htmlFor={`answer-${selected.id}`}>{answerWasSent(selected.status) ? "Редактировать отправленный ответ" : "Ответ консультанта"}</label>
                <textarea id={`answer-${selected.id}`} maxLength={14000} rows={24} value={selectedAnswer} onChange={(event) => setAnswers((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder="Проверьте вывод, ссылки на официальные источники, расчёты и необходимые действия." />
                <p className="answer-auto-note no-print">При отправке в конец ответа автоматически добавляется пометка о том, что вывод основан на предоставленных данных, а дополнительные сведения оформляются новым вопросом.</p>
                <section className="consultation-document answer-document print-only"><h3>Ответ консультанта</h3><p>{selectedAnswer}</p></section>
              </>}
              <footer className="consultation-editor-actions no-print"><button className="print-button" type="button" onClick={() => window.print()}>Печать</button>{selected.status === "archived" ? <button className="restore-button" type="button" disabled={loading} onClick={() => void setArchived(selected.id, false)}>Вернуть из архива</button> : answerWasSent(selected.status) ? <button className="archive-button" type="button" disabled={loading} onClick={() => void setArchived(selected.id, true)}>В архив</button> : null}<button className="delete-button" type="button" disabled={loading} onClick={() => void deleteConsultation(selected.id)}>Удалить вопрос и ответ</button>{selected.status !== "archived" && <><span>{selectedAnswer.length} / 14000</span><button className="action-button" disabled={selectedAnswer.trim().length < 10 || loading || selected.upgradeStatus === "requested" || selected.upgradeStatus === "awaiting_payment"} onClick={() => void saveAnswer(selected.id)}>{selected.upgradeStatus === "requested" || selected.upgradeStatus === "awaiting_payment" ? "Ожидается решение посетителя" : answerWasSent(selected.status) ? "Обновить ответ в сейфе" : "Отправить в сейф"}</button></>}</footer>
            </article>
          )}
          {incomingAlert && <aside className="incoming-alert" role="alertdialog" aria-live="assertive" aria-labelledby="incoming-alert-title"><button className="incoming-alert-close" type="button" aria-label="Закрыть напоминание" onClick={() => setIncomingAlert(null)}>×</button><span className="incoming-alert-icon" aria-hidden="true">!</span><small>Новое обращение</small><h2 id="incoming-alert-title">{incomingAlert.count === 1 ? "Поступил новый вопрос" : `Поступили новые вопросы: ${incomingAlert.count}`}</h2><p>Откройте обращение и проверьте подготовленный черновик ответа.</p><div><button className="action-button" type="button" onClick={() => void openIncomingAlert()}>Открыть вопрос</button><button className="incoming-alert-later" type="button" onClick={() => setIncomingAlert(null)}>Позже</button></div></aside>}
        </section>
      )}
    </main>
  );
}
