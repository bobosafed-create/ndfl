"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { reachMetrikaGoal } from "../lib/metrika";
import { isServiceOpen } from "../lib/service-schedule.mjs";

type Stage = "room" | "payment" | "question" | "waiting" | "answer";
type Tariff = { code: string; name: string; description: string; amountKopecks: number; deadlineMinutes: number; recommended?: boolean; available?: boolean };
type UrgentAddon = { code: string; name: string; description: string; amountKopecks: number; deadlineMinutes: number; available?: boolean };
type ScheduleDay = { day: string; enabled: boolean; start: string; end: string };

const scheduleDayLabels: Record<string, string> = {
  monday: "Понедельник", tuesday: "Вторник", wednesday: "Среда", thursday: "Четверг",
  friday: "Пятница", saturday: "Суббота", sunday: "Воскресенье",
};

const fallbackServiceSchedule: ScheduleDay[] = Object.keys(scheduleDayLabels).map((day, index) => ({ day, enabled: index < 5, start: "09:00", end: "13:00" }));

const fallbackTariffs: Tariff[] = [
  { code: "situation-check", name: "Проверка ситуации", description: "Персональная проверка НДФЛ, обязанности подать 3-НДФЛ и возможных способов уменьшить налог или получить возврат", amountKopecks: 39000, deadlineMinutes: 240, recommended: true },
  { code: "detailed-review", name: "Расчёт и подробный разбор", description: "Расчёт налога или возврата, нормативные основания и подробные рекомендации по следующим действиям", amountKopecks: 99000, deadlineMinutes: 480 },
];

const fallbackUrgentAddon: UrgentAddon = { code: "urgent", name: "Срочно", description: "Письменный результат в течение 2 часов", amountKopecks: 30000, deadlineMinutes: 120, available: true };

const situations = [
  { slug: "prodazha-kvartiry", title: "Продал квартиру", text: "Срок владения, расходы, вычет и обязанность подать 3-НДФЛ.", path: "/prodazha-kvartiry/", published: false },
  { slug: "prodazha-avtomobilya", title: "Продал автомобиль", text: "Нужно ли декларировать доход и можно ли учесть стоимость покупки.", path: "/prodazha-avtomobilya/", published: false },
  { slug: "pokupka-kvartiry", title: "Купил квартиру", text: "Имущественный вычет и возврат НДФЛ, включая ипотечные проценты.", path: "/vychet-pokupka-kvartiry/", published: false },
  { slug: "lechenie", title: "Оплачивал лечение", text: "Социальный вычет за лечение, лекарства и медицинские услуги.", path: "/vychet-lechenie/", published: false },
  { slug: "obuchenie", title: "Оплачивал обучение", text: "Возврат НДФЛ за своё обучение или обучение близких.", path: "/vychet-obuchenie/", published: false },
  { slug: "vklady", title: "Получил проценты по вкладам", text: "Проверка необлагаемой суммы и налога по сведениям банков.", path: "/nalog-vklady/", published: false },
  { slug: "arenda", title: "Сдавал имущество", text: "НДФЛ с аренды, декларация и подходящий порядок уплаты.", path: "/arenda/", published: false },
  { slug: "investitsii", title: "Акции, дивиденды, инвестиции", text: "Доходы у брокера, дивиденды, убытки и инвестиционные вычеты.", path: "/investitsii/", published: false },
  { slug: "drugaya-situatsiya", title: "Другая ситуация", text: "Разберём нестандартный доход, вычет или уведомление налоговой.", path: "/drugaya-situatsiya/", published: false },
] as const;

function tariffDeadline(minutes: number) {
  if (minutes === 60) return "Ответ в течение 1 часа";
  if (minutes === 240) return "Ответ в течение 4 часов";
  if (minutes === 480) return "Ответ в течение 8 часов";
  return `Ответ в течение ${minutes} минут`;
}

function formatServiceSchedule(schedule: ScheduleDay[]) {
  const groups: { first: ScheduleDay; last: ScheduleDay }[] = [];
  for (const day of schedule) {
    if (!day.enabled) continue;
    const previous = groups.at(-1);
    const previousIndex = previous ? schedule.findIndex((item) => item.day === previous.last.day) : -2;
    const currentIndex = schedule.findIndex((item) => item.day === day.day);
    if (previous && previous.last.start === day.start && previous.last.end === day.end && currentIndex === previousIndex + 1) previous.last = day;
    else groups.push({ first: day, last: day });
  }
  if (groups.length === 0) return "Приём вопросов временно приостановлен";
  return groups.map(({ first, last }) => {
    const days = first.day === last.day ? scheduleDayLabels[first.day] : `${scheduleDayLabels[first.day]}–${scheduleDayLabels[last.day].toLowerCase()}`;
    return `${days}: ${first.start}–${first.end}`;
  }).join(" · ");
}

function paginateAnswer(text: string, pageSize = 1050) {
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= pageSize) { pieces.push(paragraph); continue; }
    const sentences = paragraph.match(/[^.!?\n]+[.!?]+|[^.!?\n]+$/g) ?? [paragraph];
    let piece = "";
    for (const sentence of sentences) {
      const clean = sentence.trim();
      if (`${piece} ${clean}`.trim().length <= pageSize) { piece = `${piece} ${clean}`.trim(); continue; }
      if (piece) pieces.push(piece);
      if (clean.length <= pageSize) { piece = clean; continue; }
      const words = clean.split(/\s+/);
      piece = "";
      for (const word of words) {
        if (`${piece} ${word}`.trim().length > pageSize && piece) { pieces.push(piece); piece = word; }
        else piece = `${piece} ${word}`.trim();
      }
    }
    if (piece) pieces.push(piece);
  }
  const pages: string[] = [];
  for (const piece of pieces) {
    const candidate = pages.length ? `${pages.at(-1)}\n\n${piece}` : piece;
    if (pages.length && candidate.length <= pageSize) pages[pages.length - 1] = candidate;
    else pages.push(piece);
  }
  return pages.length ? pages : [text];
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("room");
  const [question, setQuestion] = useState("");
  const [tipVisible, setTipVisible] = useState(true);
  const [consultationCode, setConsultationCode] = useState("");
  const [safeCode, setSafeCode] = useState("");
  const [safeMessage, setSafeMessage] = useState("");
  const [answerReady, setAnswerReady] = useState(false);
  const [codeNoticeVisible, setCodeNoticeVisible] = useState(false);
  const [codeNoticeSeconds, setCodeNoticeSeconds] = useState(10);
  const [consultationId, setConsultationId] = useState("");
  const [browserToken, setBrowserToken] = useState("");
  const [answerDueAt, setAnswerDueAt] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [answerPage, setAnswerPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [tariffs, setTariffs] = useState<Tariff[]>(fallbackTariffs);
  const [selectedTariffCode, setSelectedTariffCode] = useState("situation-check");
  const [urgentAddon, setUrgentAddon] = useState<UrgentAddon>(fallbackUrgentAddon);
  const [urgentSelected, setUrgentSelected] = useState(false);
  const [diagnosticSituation, setDiagnosticSituation] = useState("");
  const [diagnosticComplete, setDiagnosticComplete] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [vpnNoticeVisible, setVpnNoticeVisible] = useState(false);
  const [visitorStats, setVisitorStats] = useState<{ total: number; today: number } | null>(null);
  const [serviceSchedule, setServiceSchedule] = useState<ScheduleDay[]>(fallbackServiceSchedule);
  const [scheduleNoticeVisible, setScheduleNoticeVisible] = useState(false);

  const selectedTariff = useMemo(() => tariffs.find((tariff) => tariff.code === selectedTariffCode) ?? null, [selectedTariffCode, tariffs]);
  const priceKopecks = (selectedTariff?.amountKopecks ?? fallbackTariffs[0].amountKopecks) + (urgentSelected ? urgentAddon.amountKopecks : 0);
  const priceLabel = useMemo(() => `${(priceKopecks / 100).toLocaleString("ru-RU")} ₽`, [priceKopecks]);
  const selectedDeadline = urgentSelected ? tariffDeadline(urgentAddon.deadlineMinutes) : selectedTariff ? tariffDeadline(selectedTariff.deadlineMinutes) : tariffDeadline(fallbackTariffs[0].deadlineMinutes);
  const answerPages = useMemo(() => paginateAnswer(answer), [answer]);
  const serviceScheduleText = useMemo(() => formatServiceSchedule(serviceSchedule), [serviceSchedule]);

  const deadline = useMemo(() => {
    if (!answerDueAt) return "в срок выбранного тарифа";
    return new Date(answerDueAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }, [answerDueAt]);

  const refreshStatus = useCallback(async (id: string, token: string) => {
    const response = await fetch("/api/consultations/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consultationId: id, browserToken: token }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    setAnswerDueAt(result.answerDueAt ?? null);
    if (result.status === "paid") {
      const purchaseGoalKey = `ndfl-metrika-purchase-${id}`;
      if (!window.localStorage.getItem(purchaseGoalKey)) {
        reachMetrikaGoal("purchase", {
          order_price: Number(result.tariff?.amountKopecks ?? 0) / 100,
          currency: "RUB",
          tariff: result.tariff?.code ?? "consultation-default",
        });
        window.localStorage.setItem(purchaseGoalKey, "1");
      }
      setPaymentMessage("");
      setSelectedTariffCode("situation-check");
      setUrgentSelected(false);
      setStage("question");
    } else if (result.status === "question_submitted" || result.status === "answered") {
      setAnswerReady(result.status === "answered");
      setCodeNoticeVisible(false);
      setStage("waiting");
    } else if (result.status === "cancelled") {
      window.localStorage.removeItem("ndfl-active-consultation");
      setConsultationId("");
      setBrowserToken("");
      setConsultationCode("");
      setPaymentMessage("Платёж не был завершён. При необходимости начните оплату заново.");
      setStage("payment");
    }
    return result;
  }, []);

  useEffect(() => {
    fetch("/api/tariffs").then((response) => response.ok ? response.json() : null).then((result) => {
      if (Array.isArray(result?.serviceSchedule) && result.serviceSchedule.length === 7) setServiceSchedule(result.serviceSchedule);
      if (result?.urgentAddon && Number.isInteger(result.urgentAddon.amountKopecks)) setUrgentAddon(result.urgentAddon);
      if (Array.isArray(result?.tariffs) && result.tariffs.length > 0) {
        setTariffs(result.tariffs);
        const calculatorTariff = window.sessionStorage.getItem("ndfl-calculator-tariff");
        if (calculatorTariff === "urgent") {
          setSelectedTariffCode("detailed-review");
          setUrgentSelected(true);
          window.sessionStorage.removeItem("ndfl-calculator-tariff");
        } else if (calculatorTariff && result.tariffs.some((tariff: Tariff) => tariff.code === calculatorTariff && tariff.available !== false)) {
          setSelectedTariffCode(calculatorTariff);
          window.sessionStorage.removeItem("ndfl-calculator-tariff");
        }
        if (result.tariffs.some((tariff: Tariff) => tariff.code === selectedTariffCode && tariff.available === false)) setSelectedTariffCode("situation-check");
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const moscowDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const visitKey = `ndfl-visit-${moscowDay}`;
    let visitRegistration: Promise<unknown> = Promise.resolve();
    if (!window.localStorage.getItem(visitKey)) {
      visitRegistration = fetch("/api/visits", { method: "POST" }).then((response) => {
        if (response.ok) window.localStorage.setItem(visitKey, "1");
      }).catch(() => {});
    }

    const consultantKey = window.sessionStorage.getItem("ndfl-consultant-key");
    if (consultantKey) {
      visitRegistration.then(() => fetch("/api/consultant/visitor-stats", { headers: { authorization: `Bearer ${consultantKey}` } }))
        .then((response) => response.ok ? response.json() : null)
        .then((result) => { if (Number.isFinite(result?.total) && Number.isFinite(result?.today)) setVisitorStats({ total: result.total, today: result.today }); })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const calculatorSummary = window.sessionStorage.getItem("ndfl-calculator-summary");
    if (calculatorSummary) setQuestion((current) => current || calculatorSummary.slice(0, 1200));
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("ndfl-active-consultation");
    if (!saved) return;
    try {
      const access = JSON.parse(saved);
      if (!access.id || !access.token || !/^\d{4}$/.test(access.code)) return;
      const timer = window.setTimeout(() => {
        setConsultationId(access.id);
        setBrowserToken(access.token);
        setConsultationCode(access.code);
        const returnedFromPayment = new URLSearchParams(window.location.search).get("payment") === "return";
        if (returnedFromPayment) {
          setStage("payment");
          setPaymentMessage("Проверяем результат оплаты…");
          window.history.replaceState({}, "", `${window.location.pathname}#room`);
        }
        void refreshStatus(access.id, access.token);
      }, 0);
      return () => window.clearTimeout(timer);
    } catch {
      window.localStorage.removeItem("ndfl-active-consultation");
    }
  }, [refreshStatus]);

  useEffect(() => {
    if (stage !== "question") return;
    const timer = window.setTimeout(() => setTipVisible(false), 10000);
    return () => window.clearTimeout(timer);
  }, [stage]);

  async function startPayment() {
    if (busy) return;
    if (!isServiceOpen(serviceSchedule)) {
      setVpnNoticeVisible(false);
      setStage("room");
      setScheduleNoticeVisible(true);
      return;
    }
    setBusy(true);
    setVpnNoticeVisible(false);
    setPaymentMessage("");
    try {
      const response = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tariffCode: selectedTariffCode, urgent: urgentSelected }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "payment_failed");
      reachMetrikaGoal("payment_started", {
        order_price: Number(result.amountKopecks ?? 0) / 100,
        currency: "RUB",
        tariff: (result.tariff?.code ?? selectedTariffCode) || "consultation-default",
      });
      window.localStorage.setItem("ndfl-active-consultation", JSON.stringify({
        id: result.consultationId,
        token: result.browserToken,
        code: result.code,
      }));
      window.location.assign(result.confirmationUrl);
    } catch (error) {
      if (error instanceof Error && error.message === "questions_unavailable") {
        setStage("room");
        setScheduleNoticeVisible(true);
      } else {
        setPaymentMessage(error instanceof Error && error.message === "urgent_tariff_unavailable"
          ? "Допопция «Срочно» сейчас временно недоступна. Оформите обычный срок или повторите позже."
          : "Не удалось открыть защищённую страницу оплаты. Попробуйте ещё раз немного позже.");
      }
      setBusy(false);
    }
  }

  async function beginPayment() {
    if (busy) return;
    setBusy(true);
    let latestSchedule: ScheduleDay[] | null = null;
    try {
      const response = await fetch("/api/tariffs", { cache: "no-store" });
      const result = response.ok ? await response.json() : null;
      if (Array.isArray(result?.serviceSchedule) && result.serviceSchedule.length === 7) {
        latestSchedule = result.serviceSchedule;
        setServiceSchedule(result.serviceSchedule);
      }
    } catch {
      latestSchedule = null;
    }
    setBusy(false);
    if (!latestSchedule || !isServiceOpen(latestSchedule)) {
      setScheduleNoticeVisible(true);
      return;
    }
    setPaymentMessage("");
    setStage("payment");
  }

  function showSchedule() {
    setScheduleNoticeVisible(false);
    document.getElementById("pricing-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function downloadAnswer() {
    const documentText = `Ответ консультанта по НДФЛ\r\nКонсультация № ${displayCode(consultationCode)}\r\n\r\n${answer}`;
    const url = URL.createObjectURL(new Blob([documentText], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Ответ-НДФЛ-${displayCode(consultationCode)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function displayCode(value: string) {
    return value;
  }

  useEffect(() => {
    if (!consultationId || !browserToken || (stage !== "waiting" && stage !== "payment")) return;
    const timer = window.setInterval(() => {
      void refreshStatus(consultationId, browserToken);
    }, stage === "payment" ? 4000 : 30000);
    return () => window.clearInterval(timer);
  }, [browserToken, consultationId, refreshStatus, stage]);

  useEffect(() => {
    if (stage !== "waiting" || !codeNoticeVisible) return;
    const timer = window.setInterval(() => {
      setCodeNoticeSeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer);
          setCodeNoticeVisible(false);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, codeNoticeVisible]);

  async function saveQuestion() {
    if (question.trim().length < 10 || busy || !privacyAccepted) return;
    setBusy(true);
    try {
      const response = await fetch("/api/consultations/question", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consultationId, browserToken, question: question.trim() }),
      });
      if (!response.ok) throw new Error("save_failed");
      const result = await response.json();
      setAnswerDueAt(result.answerDueAt ?? null);
      setCodeNoticeSeconds(10);
      setCodeNoticeVisible(true);
      setAnswerReady(false);
      setStage("waiting");
      setSafeMessage("");
      window.sessionStorage.removeItem("ndfl-calculator-summary");
    } catch {
      setSafeMessage("Не удалось сохранить вопрос. Проверьте соединение и повторите попытку.");
    } finally {
      setBusy(false);
    }
  }

  async function openSafe() {
    if (!/^\d{4}$/.test(safeCode) || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/consultations/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consultationId, browserToken, code: safeCode }),
      });
      const result = await response.json();
      if (!response.ok) {
        const messages: Record<string, string> = {
          invalid_code: "Код не подошёл. Проверьте четыре цифры.",
          temporarily_locked: "Слишком много попыток. Повторите через 15 минут.",
          answer_not_ready: `Ответ будет здесь не позднее ${deadline}.`,
        };
        setSafeMessage(messages[result.error] ?? "Не удалось открыть сейф.");
        return;
      }
      setAnswer(result.answer);
      setAnswerPage(0);
      setSafeMessage("");
      setStage("answer");
    } finally {
      setBusy(false);
    }
  }

  function resetConsultation() {
    window.localStorage.removeItem("ndfl-active-consultation");
    setStage("room");
    setQuestion("");
    setConsultationCode("");
    setSafeCode("");
    setAnswerReady(false);
    setCodeNoticeVisible(false);
    setCodeNoticeSeconds(10);
    setSafeMessage("");
    setConsultationId("");
    setBrowserToken("");
    setAnswer("");
    setAnswerPage(0);
    setAnswerDueAt(null);
    setSelectedTariffCode("situation-check");
    setUrgentSelected(false);
    setVpnNoticeVisible(false);
  }

  return (
    <main>
      <header className="hero">
        <nav className="nav">
          <a className="brand" href="#top" aria-label="НДФЛ.просто — наверх"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span><small>Расчёт · Проверка · Налоговые вычеты · Консультация</small></span></a>
          <a className="nav-link" href="#diagnostic">Бесплатная проверка <span>↓</span></a>
          {visitorStats && <aside className="consultant-visitor-counter" aria-label="Счётчик посещений, доступный консультанту"><small>Посетители</small><b>Всего: {visitorStats.total.toLocaleString("ru-RU")}</b><span>Сегодня: {visitorStats.today.toLocaleString("ru-RU")}</span></aside>}
        </nav>
        <section id="top" className="hero-grid ndfl-hero-grid">
          <div className="hero-copy ndfl-hero-copy">
            <span className="eyebrow">Персональная проверка вашей ситуации</span>
            <h1>Проверьте свой <em>НДФЛ</em></h1>
            <p>Узнайте, правильно ли рассчитан налог, нужно ли подавать 3-НДФЛ, можно ли законно заплатить меньше или вернуть часть уплаченного НДФЛ.</p>
            <div className="hero-actions"><a className="primary-link" href="#diagnostic">Проверить мою ситуацию <span>→</span></a><a className="secondary-link" href="#pricing-heading">Задать вопрос специалисту</a></div>
            <div className="trust-row"><span>✓ Без регистрации</span><span>✓ Без паспорта и ИНН</span><span>✓ Письменный результат</span></div>
          </div>
          <div className="hero-check-card" aria-label="Что проверит специалист">
            <span>В персональном разборе</span>
            <h2>Не только сумма налога</h2>
            <ul><li>обязанность подать 3-НДФЛ;</li><li>право на вычеты и возврат;</li><li>законные способы уменьшить налог;</li><li>важные сроки и следующие действия.</li></ul>
            <strong>Расчёт · объяснение · рекомендации</strong>
          </div>
        </section>
      </header>

      <section className="situations-section" aria-labelledby="situations-heading">
        <div className="content-heading"><span>Что у вас произошло?</span><h2 id="situations-heading">Выберите свою ситуацию</h2><p>Не нужно заранее разбираться в Налоговом кодексе. Выберите тему — сейчас карточка откроет бесплатную первичную диагностику, а позже сможет вести на отдельную тематическую страницу.</p></div>
        <div className="situations-grid">
          {situations.map((item, index) => <a key={item.slug} href={item.published ? item.path : "#diagnostic"} data-future-path={item.path} onClick={() => { setDiagnosticSituation(item.slug); setDiagnosticComplete(false); }}><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3><p>{item.text}</p><b>Проверить ситуацию →</b></a>)}
        </div>
      </section>

      <section id="diagnostic" className="diagnostic-section" aria-labelledby="diagnostic-heading">
        <div><span className="mini-label">Бесплатная первичная диагностика</span><h2 id="diagnostic-heading">Не уверены, что вам вообще нужна консультация?</h2><p>Укажите тип ситуации. Мы бесплатно подскажем, что в ней обычно требуется проверить. Это предварительная ориентация, а не индивидуальная налоговая консультация.</p></div>
        <div className="diagnostic-card">
          <label htmlFor="diagnostic-situation">Что произошло?</label>
          <select id="diagnostic-situation" value={diagnosticSituation} onChange={(event) => { setDiagnosticSituation(event.target.value); setDiagnosticComplete(false); }}><option value="">Выберите ситуацию</option>{situations.map((item) => <option value={item.slug} key={item.slug}>{item.title}</option>)}</select>
          <button className="action-button" type="button" disabled={!diagnosticSituation} onClick={() => setDiagnosticComplete(true)}>Начать бесплатную проверку</button>
          {diagnosticComplete && <div className="diagnostic-result" role="status"><b>Что стоит проверить</b><p>Для ситуации «{situations.find((item) => item.slug === diagnosticSituation)?.title}» важны даты, суммы, документы и обстоятельства получения дохода или права на вычет. Если вывод влияет на платёж или возврат, выберите персональную проверку ниже.</p><a href="#pricing-heading">Выбрать формат разбора →</a></div>}
        </div>
      </section>

      <section className="circumstances-section" aria-labelledby="circumstances-heading">
        <div className="content-heading"><span>Налог зависит от деталей</span><h2 id="circumstances-heading">На НДФЛ влияют обстоятельства, о которых легко не знать</h2><p>Дата и способ приобретения имущества, подтверждённые расходы, семейный статус, перенос убытков, уже использованные вычеты и другие детали могут изменить результат.</p></div>
        <div className="circumstances-accent">Задача сервиса — не просто посчитать налог, а проверить, не переплачиваете ли вы и не упускаете ли право на возврат.</div>
      </section>

      <section className="deliverables-section" aria-labelledby="deliverables-heading">
        <div className="content-heading"><span>Результат консультации</span><h2 id="deliverables-heading">Что вы получите</h2></div>
        <div className="deliverables-grid">{[
          ["Персональный анализ", "Проверка именно ваших обстоятельств, а не общий ответ из справочника."],
          ["Расчёт", "Сумма налога или возможного возврата, когда исходных данных достаточно."],
          ["Простое объяснение", "Понятный вывод без перегруженной налоговой терминологии."],
          ["Нормативные основания", "Ссылки на применимые нормы и официальные разъяснения."],
          ["Рекомендации", "Что сделать дальше и какие документы проверить или подготовить."],
          ["Письменный результат", "Ответ останется в защищённом сейфе и доступен по вашему коду."],
        ].map(([title, text]) => <article key={title}><i>✓</i><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>

      <section className="guide">
        <div className="consultant-portrait">
          <div className="portrait-sun" aria-hidden="true">✦</div>
          <div className="portrait-frame">
            <img src="/specialist-photo.jpg" alt="Налоговый консультант Александр Владимирович" />
          </div>
          <div className="consultant-label"><span>Налоговый консультант</span><strong>Александр Владимирович</strong><small><i /> Самозанятый</small></div>
        </div>
        <div className="guide-copy consultant-profile"><span className="mini-label">Ответ проверяет специалист</span><h2>Александр<br/><span>Владимирович</span></h2><p className="profile-lead">Финансовый и налоговый аналитик, аудитор. Более 20 лет профессионального опыта. Высшее экономическое образование.</p><blockquote>Пользователь может оставаться анонимным. Консультант — нет.</blockquote><dl className="consultant-facts"><div><dt>Статус</dt><dd>Самозанятый · ИНН 231500470459</dd></div><div><dt>Профессиональный опыт</dt><dd>Аудитор, финансовый аналитик, налоговый аналитик</dd></div><div><dt>Специализация</dt><dd>Финансовый анализ, внутренний и внешний аудит, налоговое планирование, управленческий учёт, финансовое консультирование</dd></div><div><dt>Профессиональное членство</dt><dd>СРО аудиторов ААС</dd></div></dl><p className="consultant-sectors"><b>Отраслевой опыт:</b> цементная отрасль, портовые структуры, агентирование и перевалка грузов, железная дорога, оптовая торговля, гостиничный и строительный бизнес.</p></div>
      </section>

      <section className="qa-section" aria-labelledby="qa-heading">
        <div className="qa-heading"><span>Короткие примеры</span><h2 id="qa-heading">Как обстоятельства меняют результат</h2><p>Учебные примеры типичных ситуаций. Они не являются отзывами или персональной консультацией.</p></div>
        <div className="qa-list">
          <details>
            <summary><span>01</span>Квартиру подарил дальний родственник. Когда возникает налог и как уменьшить его при продаже?</summary>
            <div className="qa-answer"><p>При дарении недвижимости от дяди НДФЛ, как правило, возникает: дядя не относится к близким родственникам, освобождённым от налога. При продаже раньше минимального срока владения доход можно уменьшить либо на имущественный вычет 1 млн ₽, либо на подтверждённые расходы — выбор зависит от документов и обстоятельств.</p><p>В отдельных случаях учитываются расходы дарителя на покупку квартиры либо стоимость, с которой был уплачен НДФЛ при дарении. Точный расчёт требует проверки дат, кадастровой стоимости и документов дарителя.</p><a href="https://www.nalog.gov.ru/rn24/taxation/taxes/dec/10573723/" target="_blank" rel="noreferrer">Проверить правило на сайте ФНС России →</a></div>
          </details>
          <details>
            <summary><span>02</span>Можно ли получить имущественный вычет при покупке квартиры у бывшего супруга после развода?</summary>
            <div className="qa-answer"><p>Сам по себе статус бывшего супруга не означает автоматический отказ: бывшие супруги прямо не названы в перечне взаимозависимых лиц. Но сделка должна быть реальной, оплаченной и зарегистрированной, а у покупателя должно сохраняться право на вычет.</p><p>Налоговая вправе оценивать фактическую взаимозависимость и обстоятельства сделки. Поэтому важны договор, выписка ЕГРН, подтверждение банковской оплаты и документ о расторжении брака.</p><a href="https://www.consultant.ru/document/cons_doc_LAW_404023/2fbf67169cd47e49fdfbe74fd52ebb6cf47336c3/" target="_blank" rel="noreferrer">Перечень взаимозависимых лиц — статья 105.1 НК РФ →</a></div>
          </details>
          <details>
            <summary><span>03</span>Как рассчитывается налог на проценты по банковским вкладам в 2026 году?</summary>
            <div className="qa-answer"><p>В 2026 году уплачивается налог с процентов, полученных в 2025 году. Необлагаемый минимум за 2025 год равен 210 000 ₽: 1 млн ₽ умножается на максимальную ключевую ставку 21% на первое число месяца в том году.</p><p>Для процентов, полученных уже в 2026 году, необлагаемый минимум станет окончательно известен после завершения года; налог по ним уплачивается в 2027 году. ФНС рассчитывает сумму сама по сведениям банков.</p><a href="https://www.nalog.gov.ru/rn62/news/activities_fts/16639281/" target="_blank" rel="noreferrer">Разъяснение ФНС России →</a></div>
          </details>
        </div>
        <div className="qa-note">Примеры носят информационный характер. Персональный ответ учитывает обстоятельства, которые вы укажете в вопросе.</div>
        <div className="dotted-arrow">↓</div>
      </section>

      <section className="steps-section" aria-labelledby="steps-heading">
        <div className="content-heading"><span>Пять понятных шагов</span><h2 id="steps-heading">Как это работает</h2></div>
        <ol className="steps-grid"><li><b>01</b><h3>Опишите ситуацию</h3><p>Без ФИО, телефона, паспорта и ИНН.</p></li><li><b>02</b><h3>Выберите формат</h3><p>Проверка ситуации или подробный расчёт.</p></li><li><b>03</b><h3>Оплатите через ЮKassa</h3><p>Данные банковской карты не попадают на сайт.</p></li><li><b>04</b><h3>Получите код</h3><p>Четыре цифры откроют ваш защищённый сейф.</p></li><li><b>05</b><h3>Получите письменный ответ</h3><p>Анализ, расчёт и рекомендации в выбранный срок.</p></li></ol>
      </section>

      <section className="pricing-section" aria-labelledby="pricing-heading">
        <div className="pricing-heading"><span>Два формата работы</span><h2 id="pricing-heading">Выберите глубину разбора</h2><p>Оба тарифа включают персональный письменный результат. Стоимость фиксируется до перехода на страницу ЮKassa.</p><div className="service-hours"><b>Приём вопросов</b><strong>{serviceScheduleText}</strong><em>Время московское</em><span>Допопция «Срочно» в отдельные часы может быть недоступна.</span></div></div>
        <div className="tariff-grid" role="radiogroup" aria-label="Тариф консультации">
          {tariffs.map((tariff) => <label className={`tariff-card ${selectedTariffCode === tariff.code ? "selected" : ""} ${tariff.available === false ? "unavailable" : ""}`} key={tariff.code}>
            <input type="radio" name="consultation-tariff" value={tariff.code} checked={selectedTariffCode === tariff.code} disabled={tariff.available === false} onChange={() => setSelectedTariffCode(tariff.code)} />
            <span className="tariff-radio" aria-hidden="true" />
            {tariff.available === false ? <b className="tariff-badge unavailable-badge">Временно недоступен</b> : tariff.recommended && <b className="tariff-badge">Рекомендуем</b>}
            <strong>{tariff.name}</strong><em>{(tariff.amountKopecks / 100).toLocaleString("ru-RU")} ₽</em><small>{tariffDeadline(tariff.deadlineMinutes)}</small><p>{tariff.description}</p>
          </label>)}
        </div>
        <label className={`urgent-option ${urgentSelected ? "selected" : ""} ${urgentAddon.available === false ? "unavailable" : ""}`}><input type="checkbox" checked={urgentSelected} disabled={urgentAddon.available === false} onChange={(event) => setUrgentSelected(event.target.checked)} /><span><b>Срочно +{(urgentAddon.amountKopecks / 100).toLocaleString("ru-RU")} ₽</b><small>Письменный результат в течение 2 часов. Это допопция к выбранному тарифу.</small></span>{urgentAddon.available === false && <em>Сейчас недоступно</em>}</label>
        <div className="tariff-summary" aria-live="polite"><div><span>Выбран тариф «{selectedTariff?.name ?? fallbackTariffs[0].name}»{urgentSelected ? " с допопцией «Срочно»" : ""}</span><strong>К оплате: {priceLabel}</strong><small>{selectedDeadline}</small></div><div><a href="#room">Перейти к консультации →</a></div></div>
      </section>

      <section className="trust-section" aria-labelledby="trust-heading"><div className="content-heading"><span>Почему сервису можно доверять</span><h2 id="trust-heading">Проверяемый специалист и прозрачный процесс</h2></div><div className="trust-grid"><article><h3>Оплата через ЮKassa</h3><p>Платёж проходит на защищённой странице платёжного сервиса.</p></article><article><h3>Письменный результат</h3><p>Вы получаете вывод, расчёт и рекомендации, к которым можно вернуться.</p></article><article><h3>Известен исполнитель</h3><p>На странице указаны имя, статус, ИНН и профессиональный опыт консультанта.</p></article><article><h3>Понятная стоимость</h3><p>Два тарифа и одна допопция без скрытой платы за «вход».</p></article></div></section>

      <section className="privacy-section" aria-labelledby="privacy-heading"><div><span className="mini-label">Конфиденциальность</span><h2 id="privacy-heading">Можно обойтись без регистрации и персональных данных</h2><p>Не указывайте ФИО, телефон, e-mail, паспорт, ИНН, адрес и номера документов. После оплаты сервис выдаёт персональный четырёхзначный код. Для открытия ответа нужны этот браузер и код.</p><a href="/legal#privacy">Подробнее об условиях конфиденциальности →</a></div><div className="privacy-code" aria-hidden="true"><span>Ваш код</span><strong>••••</strong><small>Храните его у себя</small></div></section>

      <section id="room" className="room-section">
        <div className="section-heading"><span>Защищённая консультация</span><h2>Персональный разбор, расчёт и рекомендации</h2></div>
        <div className={`room stage-${stage}`}>
          <div className="window"><span/><span/><span/><span/></div><div className="plant"><i/><b>✦</b></div>
          <div className="door-wrap">
            <div className={`door ${stage !== "room" && stage !== "payment" ? "door-active" : ""}`}><div className="door-sign">КОНСУЛЬТАНТ<small>на связи</small></div><div className="door-knob" /></div>
            {stage === "room" && <><button className="pay-button" onClick={beginPayment}><span>НАЧАТЬ</span><strong>{priceLabel}</strong></button><p>Опишите одну налоговую ситуацию без регистрации</p></>}
          </div>
          <div className={`safe ${answerReady ? "safe-ready" : ""}`} aria-label="Защищённый сейф с ответом"><span className="safe-label">{answerReady ? "ОТВЕТ ГОТОВ" : "Проверенный налоговым специалистом письменный ответ в срок выбранного тарифа"}</span><div className={`safe-door ${stage === "answer" ? "safe-open" : ""}`}><i className="safe-wheel" aria-hidden="true"><span /></i><b>ПЕРСОНАЛЬНЫЙ КОД</b></div><div className="safe-legs"><i/><i/></div></div><div className="rug" />

          {stage === "payment" && <div className="modal-backdrop">{vpnNoticeVisible ? <section className="payment-card vpn-notice-card" role="alertdialog" aria-modal="true" aria-labelledby="vpn-title"><button className="close" onClick={() => setVpnNoticeVisible(false)} aria-label="Вернуться">×</button><span className="vpn-icon" aria-hidden="true">!</span><small>Перед переходом к оплате</small><h3 id="vpn-title">Выключите VPN, если он включён</h3><p className="vpn-warning">Иначе защищённая страница оплаты может не открыться или платёж может быть отклонён.</p><button className="action-button" disabled={busy} onClick={startPayment}>{busy ? "Открываем оплату…" : "VPN выключен — перейти к оплате"}</button><button className="vpn-back" type="button" onClick={() => setVpnNoticeVisible(false)}>Вернуться назад</button></section> : <section className="payment-card" role="dialog" aria-modal="true" aria-labelledby="payment-title"><button className="close" onClick={() => setStage("room")} aria-label="Закрыть">×</button><span className="payment-icon">₽</span><small>Защищённая оплата через ЮKassa</small><h3 id="payment-title">Тариф «{selectedTariff?.name ?? fallbackTariffs[0].name}»{urgentSelected ? " · Срочно" : ""}</h3><p className="payment-deadline">{selectedDeadline}</p><div className="price-row"><span>К оплате</span><strong>{priceLabel}</strong></div><button className="action-button" disabled={busy || Boolean(paymentMessage && consultationId)} onClick={() => setVpnNoticeVisible(true)}>{busy ? "Открываем оплату…" : consultationId ? "Проверяем платёж…" : `Оплатить ${priceLabel}`}</button>{paymentMessage && <p className="payment-error" role="status">{paymentMessage}</p>}<p>Оплата проходит на странице ЮKassa. Сайт не получает и не хранит данные банковской карты.</p></section>}</div>}

          {stage === "question" && <div className="desk-layer"><article className="question-paper"><header><span>Описание ситуации</span><strong>Номер консультации (код) — <b>{displayCode(consultationCode)}</b></strong></header>{tipVisible && <div className="timed-tip"><b>Подсказка</b> Опишите существенные даты, суммы и обстоятельства одной налоговой ситуации. Ответ появится в сейфе не позднее срока выбранного тарифа. Не указывайте ФИО, адрес, телефон, e-mail, номера документов и другие персональные данные.</div>}<label htmlFor="question">Ваша ситуация для персонального разбора</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1200} placeholder="Например: в 2025 году я продал квартиру. Укажите даты приобретения и продажи, суммы и способ приобретения — без персональных данных."/><label className="privacy-check"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span>Я ознакомился(ась) с <a href="/legal#privacy" target="_blank">условиями конфиденциальности</a> и подтверждаю, что не указываю в вопросе персональные данные свои или третьих лиц.</span></label><div className="paper-footer"><span>{question.length} / 1200</span><button className="action-button" disabled={question.trim().length < 10 || busy || !privacyAccepted} onClick={saveQuestion}>{busy ? "Сохраняем…" : "Передать на разбор"} <b>✓</b></button></div>{safeMessage && <p className="form-message" role="status">{safeMessage}</p>}</article></div>}

          {stage === "waiting" && codeNoticeVisible && <div className="waiting-panel code-notice-panel"><span className="seal">✓</span><h3>Вопрос сохранён</h3><p>Ответ будет подготовлен не позднее <strong>{deadline}</strong>.</p><div className="code-reminder"><span>Ваш персональный код</span><strong>{displayCode(consultationCode)}</strong></div><div className="privacy-countdown"><b>Запомните код!</b><span>Для конфиденциальности окошко закроется через <strong>{codeNoticeSeconds}</strong> сек.</span></div></div>}

          {stage === "waiting" && !codeNoticeVisible && !answerReady && <div className="pending-toast" role="status"><i />Вопрос принят и зашифрован. Ожидаем ответ консультанта.</div>}

          {stage === "waiting" && !codeNoticeVisible && answerReady && <div className="safe-entry-panel"><span className="safe-entry-kicker">Ответ готов</span><h3>Откройте сейф</h3><p>Введите сохранённый персональный код консультации.</p><label htmlFor="safe-code">Код от сейфа</label><div className="code-entry"><input id="safe-code" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={safeCode} onChange={(event) => setSafeCode(event.target.value.replace(/\D/g, ""))} placeholder="••••" aria-label="Четырёхзначный код консультации"/><button onClick={openSafe}>Открыть</button></div>{safeMessage && <p className="safe-message" role="status">{safeMessage}</p>}</div>}

          {stage === "answer" && <div className="answer-layer"><div className="answer-document-actions"><button type="button" onClick={downloadAnswer}>Скачать ответ</button><button type="button" onClick={() => window.print()}>Печать / PDF</button></div><section className="answer-carousel" aria-label={`Ответ консультанта, страница ${answerPage + 1} из ${answerPages.length}`}><div className="answer-track" style={{ transform: `translateX(-${answerPage * 100}%)` }}>{answerPages.map((page, index) => <article className="answer-paper" key={index} aria-hidden={index !== answerPage}><header><span>Ответ консультанта</span><strong>Консультация № {displayCode(consultationCode)}</strong></header><div className="consultant-stamp">КОНСУЛЬТАНТ<br/><b>ОТВЕТИЛ</b></div><h3>{index === 0 ? "Ответ готов" : "Продолжение ответа"}</h3><p className="consultation-answer">{page}</p>{index === answerPages.length - 1 && <div className="answer-note"><b>Важно:</b> ответ относится к описанной ситуации. Если существенные обстоятельства не были указаны, вывод может измениться.</div>}</article>)}</div><div className="answer-pagination"><button type="button" disabled={answerPage === 0} onClick={() => setAnswerPage((page) => Math.max(0, page - 1))}>← Назад</button><span>Страница <b>{answerPage + 1}</b> из {answerPages.length}</span>{answerPage < answerPages.length - 1 ? <button type="button" onClick={() => setAnswerPage((page) => Math.min(answerPages.length - 1, page + 1))}>Далее →</button> : <button className="finish-answer" type="button" onClick={resetConsultation}>Завершить</button>}</div><div className="answer-dots" aria-hidden="true">{answerPages.map((_, index) => <i className={index === answerPage ? "active" : ""} key={index} />)}</div></section></div>}
        </div>
        <p className="demo-note">Вопрос и ответ хранятся в зашифрованном виде. Для открытия сейфа нужны этот браузер и ваш четырёхзначный код.</p>
      </section>

      <section className="faq-section" aria-labelledby="faq-heading"><div className="content-heading"><span>Частые вопросы</span><h2 id="faq-heading">FAQ</h2></div><div className="faq-list"><details><summary>Это полноценная декларация 3-НДФЛ?</summary><p>Нет. Сервис проверяет ситуацию, делает расчёт в пределах выбранного тарифа и даёт рекомендации. Подготовка и подача декларации не входят в указанную стоимость.</p></details><details><summary>Какие данные нужно сообщить?</summary><p>Только обстоятельства, даты и суммы, необходимые для анализа. Не передавайте ФИО, адрес, телефон, e-mail, паспорт, ИНН и номера документов.</p></details><details><summary>Чем отличаются тарифы?</summary><p>«Проверка ситуации» помогает определить обязанность, право на вычет и основные действия. «Расчёт и подробный разбор» включает более детальный расчёт, нормативные основания и развёрнутые рекомендации.</p></details><details><summary>Что означает «Срочно»?</summary><p>Это допопция стоимостью 300 ₽: письменный результат готовится в течение 2 часов. Если приём срочных обращений временно закрыт, выбрать её нельзя.</p></details><details><summary>Как получить ответ?</summary><p>После оплаты вы получите персональный код. Ответ откроется в защищённом сейфе в этом браузере после ввода кода.</p></details><details><summary>Можно ли вернуть оплату?</summary><p>Условия возврата и порядок обращения опубликованы в разделе правовой информации.</p></details></div></section>

      <section className="final-cta"><span>Проверьте до оплаты налога</span><h2>Не уверены в расчёте НДФЛ? Проверьте до того, как платить</h2><p>Получите персональный анализ, расчёт и рекомендации в письменном виде.</p><a className="primary-link" href="#diagnostic">Проверить мою ситуацию →</a></section>

      {stage === "answer" && <article className="visitor-answer-print"><h1>Ответ консультанта по НДФЛ</h1><p className="visitor-answer-number">Консультация № {displayCode(consultationCode)}</p><div>{answer}</div><p className="visitor-answer-date">Сформировано: {new Date().toLocaleDateString("ru-RU")}</p></article>}

      {scheduleNoticeVisible && <div className="schedule-closed-backdrop"><section className="payment-card schedule-closed-card" role="alertdialog" aria-modal="true" aria-labelledby="schedule-closed-title"><button className="close" type="button" onClick={() => setScheduleNoticeVisible(false)} aria-label="Закрыть">×</button><span className="schedule-closed-icon" aria-hidden="true">◷</span><small>Приём вопросов закрыт</small><h3 id="schedule-closed-title">В настоящее время вопросы недоступны</h3><p>Посмотрите расписание на сайте. Приносим извинения за неудобства.</p><button className="action-button" type="button" onClick={showSchedule}>Посмотреть расписание</button></section></div>}

      <footer><div className="brand"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></div><nav aria-label="Правовая информация"><a href="/legal#offer">Оферта</a><a href="/legal#privacy">Конфиденциальность</a><a href="/legal#refunds">Возврат</a><a href="/legal#contacts">Контакты</a></nav><a href="#top">Наверх ↑</a></footer>
      {stage === "room" && <button className="mobile-question-cta" type="button" onClick={() => document.getElementById("diagnostic")?.scrollIntoView({ behavior: "smooth" })}>Проверить НДФЛ</button>}
    </main>
  );
}
