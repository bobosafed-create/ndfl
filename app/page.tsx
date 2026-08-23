"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Stage = "room" | "payment" | "question" | "waiting" | "answer";

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
  const [priceKopecks, setPriceKopecks] = useState(10000);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const priceLabel = useMemo(() => `${(priceKopecks / 100).toLocaleString("ru-RU")} ₽`, [priceKopecks]);
  const answerPages = useMemo(() => paginateAnswer(answer), [answer]);

  const deadline = useMemo(() => {
    if (!answerDueAt) return "в течение 4 часов";
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
      setPaymentMessage("");
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
    fetch("/api/consultation-price").then((response) => response.ok ? response.json() : null).then((result) => {
      if (Number.isInteger(result?.amountKopecks)) setPriceKopecks(result.amountKopecks);
    }).catch(() => {});
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
    setBusy(true);
    setPaymentMessage("");
    try {
      const response = await fetch("/api/payments/create", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "payment_failed");
      window.localStorage.setItem("ndfl-active-consultation", JSON.stringify({
        id: result.consultationId,
        token: result.browserToken,
        code: result.code,
      }));
      window.location.assign(result.confirmationUrl);
    } catch {
      setPaymentMessage("Не удалось открыть защищённую страницу оплаты. Попробуйте ещё раз немного позже.");
      setBusy(false);
    }
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
  }

  return (
    <main>
      <header className="hero">
        <nav className="nav">
          <a className="brand" href="#top" aria-label="НДФЛ.просто — наверх"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></a>
          <a className="nav-link" href="#room">Как это работает <span>↓</span></a>
        </nav>
        <section id="top" className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Разберёмся без паники</span>
            <h1>Проблемы с НДФЛ — <em>вам сюда</em></h1>
            <p>Задайте вопрос понятным языком. Консультант подготовит ответ, а вы заберёте его из защищённого сейфа.</p>
            <a className="primary-link" href="#room">Получить консультацию <span>→</span></a>
            <div className="trust-row"><span>✓ Без сложных форм</span><span>✓ Код вместо регистрации</span></div>
          </div>
          <div className="people-scene" aria-label="Люди с налоговыми уведомлениями">
            <div className="sun" />
            <div className="person person-left"><i className="head"/><i className="body"/><b className="paper">НАЛОГИ<br/><small>заплатите</small></b></div>
            <div className="person person-main"><i className="head"/><i className="hair"/><i className="body"/><b className="paper">НАЛОГИ<br/><small>заплатите</small></b><span className="confused">?</span></div>
            <div className="person person-right"><i className="head"/><i className="body"/><b className="paper">НАЛОГИ<br/><small>заплатите</small></b></div>
          </div>
        </section>
      </header>

      <section className="guide">
        <div className="consultant-portrait">
          <div className="portrait-sun" aria-hidden="true">✦</div>
          <div className="portrait-frame">
            <img src="/consultant-male-v3.png" alt="Дежурный консультант по НДФЛ в квадратных очках указывает вниз" />
          </div>
          <div className="consultant-label"><span>Дежурный</span><strong>Консультант</strong><small><i /> Сейчас на связи</small></div>
        </div>
        <div className="guide-copy"><span className="mini-label">Ваш проводник</span><h2>Нужна консультация?<br/><span>Пройдите сюда.</span></h2><p>Три шага: войдите, оставьте вопрос, заберите ответ по своему коду.</p></div>
      </section>

      <section className="qa-section" aria-labelledby="qa-heading">
        <div className="qa-heading"><span>Примеры консультаций</span><h2 id="qa-heading">Задаваемые вопросы<br/>и наши ответы</h2><p>Краткие разборы типичных ситуаций. Откройте интересующий вопрос.</p></div>
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

      <section id="room" className="room-section">
        <div className="section-heading"><span>Комната консультации № 1</span><h2>Один вопрос — один понятный ответ</h2></div>
        <div className={`room stage-${stage}`}>
          <div className="window"><span/><span/><span/><span/></div><div className="plant"><i/><b>✦</b></div>
          <div className="door-wrap">
            <div className={`door ${stage !== "room" && stage !== "payment" ? "door-active" : ""}`}><div className="door-sign">КОНСУЛЬТАНТ<small>на связи</small></div><div className="door-knob" /></div>
            {stage === "room" && <><button className="pay-button" onClick={() => setStage("payment")}><span>ВХОД</span><strong>{priceLabel}</strong></button><p>Один письменный вопрос без регистрации</p></>}
          </div>
          <div className={`safe ${answerReady ? "safe-ready" : ""}`} aria-label="Защищённый сейф с ответом"><span className="safe-label">{answerReady ? "ОТВЕТ ГОТОВ" : "Проверенный налоговым специалистом письменный ответ в течение 4 часов"}</span><div className={`safe-door ${stage === "answer" ? "safe-open" : ""}`}><i className="safe-wheel" aria-hidden="true"><span /></i><b>ПЕРСОНАЛЬНЫЙ КОД</b></div><div className="safe-legs"><i/><i/></div></div><div className="rug" />

          {stage === "payment" && <div className="modal-backdrop"><section className="payment-card" role="dialog" aria-modal="true" aria-labelledby="payment-title"><button className="close" onClick={() => setStage("room")} aria-label="Закрыть">×</button><span className="payment-icon">₽</span><small>Защищённая оплата через ЮKassa</small><h3 id="payment-title">Консультация по НДФЛ</h3><div className="price-row"><span>К оплате</span><strong>{priceLabel}</strong></div><button className="action-button" disabled={busy || Boolean(paymentMessage && consultationId)} onClick={startPayment}>{busy ? "Открываем оплату…" : consultationId ? "Проверяем платёж…" : `Оплатить ${priceLabel}`}</button>{paymentMessage && <p className="payment-error" role="status">{paymentMessage}</p>}<p>Оплата проходит на странице ЮKassa. Сайт не получает и не хранит данные банковской карты.</p></section></div>}

          {stage === "question" && <div className="desk-layer"><article className="question-paper"><header><span>Бланк вопроса</span><strong>Номер консультации (код) — <b>{displayCode(consultationCode)}</b></strong></header>{tipVisible && <div className="timed-tip"><b>Подсказка</b> Опишите кратко свой вопрос. Ответ будет дан в течение 4 часов и появится в сейфе справа. Не указывайте ФИО, адрес, телефон, e-mail, номера документов и другие персональные данные.</div>}<label htmlFor="question">Ваш вопрос консультанту</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1200} placeholder="Например: в 2025 году я продал квартиру. Нужно ли подавать декларацию и какие документы понадобятся?"/><label className="privacy-check"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span>Я ознакомился(ась) с <a href="/legal#privacy" target="_blank">условиями конфиденциальности</a> и подтверждаю, что не указываю в вопросе персональные данные свои или третьих лиц.</span></label><div className="paper-footer"><span>{question.length} / 1200</span><button className="action-button" disabled={question.trim().length < 10 || busy || !privacyAccepted} onClick={saveQuestion}>{busy ? "Сохраняем…" : "Сохранить документ"} <b>✓</b></button></div>{safeMessage && <p className="form-message" role="status">{safeMessage}</p>}</article></div>}

          {stage === "waiting" && codeNoticeVisible && <div className="waiting-panel code-notice-panel"><span className="seal">✓</span><h3>Вопрос сохранён</h3><p>Ответ будет подготовлен не позднее <strong>{deadline}</strong>.</p><div className="code-reminder"><span>Ваш персональный код</span><strong>{displayCode(consultationCode)}</strong></div><div className="privacy-countdown"><b>Запомните код!</b><span>Для конфиденциальности окошко закроется через <strong>{codeNoticeSeconds}</strong> сек.</span></div></div>}

          {stage === "waiting" && !codeNoticeVisible && !answerReady && <div className="pending-toast" role="status"><i />Вопрос принят и зашифрован. Ожидаем ответ консультанта.</div>}

          {stage === "waiting" && !codeNoticeVisible && answerReady && <div className="safe-entry-panel"><span className="safe-entry-kicker">Ответ готов</span><h3>Откройте сейф</h3><p>Введите сохранённый персональный код консультации.</p><label htmlFor="safe-code">Код от сейфа</label><div className="code-entry"><input id="safe-code" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={safeCode} onChange={(event) => setSafeCode(event.target.value.replace(/\D/g, ""))} placeholder="••••" aria-label="Четырёхзначный код консультации"/><button onClick={openSafe}>Открыть</button></div>{safeMessage && <p className="safe-message" role="status">{safeMessage}</p>}</div>}

          {stage === "answer" && <div className="answer-layer"><section className="answer-carousel" aria-label={`Ответ консультанта, страница ${answerPage + 1} из ${answerPages.length}`}><div className="answer-track" style={{ transform: `translateX(-${answerPage * 100}%)` }}>{answerPages.map((page, index) => <article className="answer-paper" key={index} aria-hidden={index !== answerPage}><header><span>Ответ консультанта</span><strong>Консультация № {displayCode(consultationCode)}</strong></header><div className="consultant-stamp">КОНСУЛЬТАНТ<br/><b>ОТВЕТИЛ</b></div><h3>{index === 0 ? "Ответ готов" : "Продолжение ответа"}</h3><p className="consultation-answer">{page}</p>{index === answerPages.length - 1 && <div className="answer-note"><b>Важно:</b> ответ относится к описанной ситуации. Если существенные обстоятельства не были указаны, вывод может измениться.</div>}</article>)}</div><div className="answer-pagination"><button type="button" disabled={answerPage === 0} onClick={() => setAnswerPage((page) => Math.max(0, page - 1))}>← Назад</button><span>Страница <b>{answerPage + 1}</b> из {answerPages.length}</span>{answerPage < answerPages.length - 1 ? <button type="button" onClick={() => setAnswerPage((page) => Math.min(answerPages.length - 1, page + 1))}>Далее →</button> : <button className="finish-answer" type="button" onClick={resetConsultation}>Завершить</button>}</div><div className="answer-dots" aria-hidden="true">{answerPages.map((_, index) => <i className={index === answerPage ? "active" : ""} key={index} />)}</div></section></div>}
        </div>
        <p className="demo-note">Вопрос и ответ хранятся в зашифрованном виде. Для открытия сейфа нужны этот браузер и ваш четырёхзначный код.</p>
      </section>

      <footer><div className="brand"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></div><nav aria-label="Правовая информация"><a href="/legal#offer">Оферта</a><a href="/legal#privacy">Конфиденциальность</a><a href="/legal#refunds">Возврат</a><a href="/legal#contacts">Контакты</a></nav><a href="#top">Наверх ↑</a></footer>
      {stage === "room" && <button className="mobile-question-cta" type="button" onClick={() => setStage("payment")}>Задать вопрос</button>}
    </main>
  );
}
