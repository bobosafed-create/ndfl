"use client";

import { useEffect, useMemo, useState } from "react";

type Stage = "room" | "payment" | "question" | "waiting" | "answer";

export default function Home() {
  const [stage, setStage] = useState<Stage>("room");
  const [question, setQuestion] = useState("");
  const [tipVisible, setTipVisible] = useState(true);
  const [consultationCode, setConsultationCode] = useState("");
  const [safeCode, setSafeCode] = useState("");
  const [safeMessage, setSafeMessage] = useState("");
  const [answerReady, setAnswerReady] = useState(false);

  const deadline = useMemo(() => {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }, [stage === "waiting"]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stage !== "question") return;
    setTipVisible(true);
    const timer = window.setTimeout(() => setTipVisible(false), 10000);
    return () => window.clearTimeout(timer);
  }, [stage]);

  function generateConsultationCode() {
    const previousCode = window.sessionStorage.getItem("ndfl-last-consultation-code");
    let nextCode = "";
    do {
      const randomValue = window.crypto.getRandomValues(new Uint32Array(1))[0];
      nextCode = String(10000000 + (randomValue % 90000000));
    } while (nextCode === previousCode);

    window.sessionStorage.setItem("ndfl-last-consultation-code", nextCode);
    setConsultationCode(nextCode);
    setSafeCode("");
    setStage("question");
  }

  function displayCode(value: string) {
    return value.replace(/(\d{4})(\d{4})/, "$1 $2");
  }

  useEffect(() => {
    if (stage !== "waiting") return;
    const timer = window.setTimeout(() => setAnswerReady(true), 7000);
    return () => window.clearTimeout(timer);
  }, [stage]);

  function saveQuestion() {
    if (question.trim().length < 10) return;
    window.localStorage.setItem(`ndfl-question-${consultationCode}`, question.trim());
    setStage("waiting");
    setSafeMessage("");
  }

  function openSafe() {
    if (safeCode !== consultationCode) {
      setSafeMessage("Код не подошёл. Посмотрите номер в правом верхнем углу бланка.");
      return;
    }
    if (!answerReady) {
      setSafeMessage(`Документ принят. Ответ будет здесь не позднее ${deadline}.`);
      return;
    }
    setSafeMessage("");
    setStage("answer");
  }

  function resetDemo() {
    window.localStorage.removeItem(`ndfl-question-${consultationCode}`);
    setStage("room");
    setQuestion("");
    setConsultationCode("");
    setSafeCode("");
    setAnswerReady(false);
    setSafeMessage("");
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
            <img src="/consultant-v2.png" alt="Дружелюбный консультант по НДФЛ в квадратных очках указывает вниз" />
          </div>
          <div className="consultant-label"><span>Ваш консультант</span><strong>Анна</strong><small><i /> Сейчас на связи</small></div>
        </div>
        <div className="guide-copy"><span className="mini-label">Ваш проводник</span><h2>Нужна консультация?<br/><span>Пройдите сюда.</span></h2><p>Три шага: войдите, оставьте вопрос, заберите ответ по своему коду.</p></div>
        <div className="dotted-arrow">↓</div>
      </section>

      <section id="room" className="room-section">
        <div className="section-heading"><span>Комната консультации № 1</span><h2>Один вопрос — один понятный ответ</h2></div>
        <div className={`room stage-${stage}`}>
          <div className="window"><span/><span/><span/><span/></div><div className="plant"><i/><b>✦</b></div>
          <div className="door-wrap">
            <div className={`door ${stage !== "room" && stage !== "payment" ? "door-active" : ""}`}><div className="door-sign">КОНСУЛЬТАНТ<small>на связи</small></div><div className="door-knob" /></div>
            {stage === "room" && <><button className="pay-button" onClick={() => setStage("payment")}>ВХОД <span>→</span></button><p>Оплатите <strong>100 ₽</strong> и получите консультацию</p></>}
          </div>
          <div className={`safe ${answerReady ? "safe-ready" : ""}`} aria-label="Сейф с ответом"><span className="safe-label">{answerReady ? "ОТВЕТ ГОТОВ" : "ВАШ ОТВЕТ"}</span><div className={`safe-door ${stage === "answer" ? "safe-open" : ""}`}><i className="safe-wheel">✦</i><b>КОД</b></div><div className="safe-legs"><i/><i/></div></div><div className="rug" />

          {stage === "payment" && <div className="modal-backdrop"><section className="payment-card" role="dialog" aria-modal="true" aria-labelledby="payment-title"><button className="close" onClick={() => setStage("room")} aria-label="Закрыть">×</button><span className="payment-icon">₽</span><small>Демонстрационный платёж</small><h3 id="payment-title">Консультация по НДФЛ</h3><div className="price-row"><span>К оплате</span><strong>100 ₽</strong></div><button className="action-button" onClick={generateConsultationCode}>Подтвердить демо-оплату</button><p>После подтверждения будет создан новый персональный код. Банковские данные не запрашиваются, деньги не списываются.</p></section></div>}

          {stage === "question" && <div className="desk-layer"><article className="question-paper"><header><span>Бланк вопроса</span><strong>Номер консультации (код) — <b>{displayCode(consultationCode)}</b></strong></header>{tipVisible && <div className="timed-tip"><b>Подсказка</b> Опишите кратко свой вопрос. Ответ будет дан в течение часа и появится в сейфе справа. Сохраните код: он создан специально для этой консультации.</div>}<label htmlFor="question">Ваш вопрос консультанту</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1200} placeholder="Например: в 2025 году я продал квартиру. Нужно ли подавать декларацию и какие документы понадобятся?" autoFocus/><div className="paper-footer"><span>{question.length} / 1200</span><button className="action-button" disabled={question.trim().length < 10} onClick={saveQuestion}>Сохранить документ <b>✓</b></button></div></article></div>}

          {stage === "waiting" && <div className="waiting-panel"><span className="seal">✓</span><h3>Вопрос сохранён</h3><p>Ответ будет подготовлен не позднее <strong>{deadline}</strong>. В этой демонстрации сейф загорится через несколько секунд.</p><div className="code-reminder">Ваш персональный код <strong>{displayCode(consultationCode)}</strong></div><label htmlFor="safe-code">Введите код на сейфе</label><div className="code-entry"><input id="safe-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={safeCode} onChange={(event) => setSafeCode(event.target.value.replace(/\D/g, ""))} placeholder="••••••••" aria-label="Восьмизначный код консультации"/><button onClick={openSafe}>Открыть</button></div>{safeMessage && <p className="safe-message" role="status">{safeMessage}</p>}</div>}

          {stage === "answer" && <div className="answer-layer"><article className="answer-paper"><header><span>Ответ консультанта</span><strong>Консультация № {displayCode(consultationCode)}</strong></header><div className="consultant-stamp">КОНСУЛЬТАНТ<br/><b>ОТВЕТИЛ</b></div><h3>Ваш вопрос получен</h3><p>Это демонстрационный ответ. В рабочем сервисе здесь будет персональная консультация специалиста по вашему вопросу с понятным перечнем следующих шагов и необходимых документов.</p><div className="answer-note"><b>Важно:</b> перед запуском реального сервиса нужно подключить специалиста, защищённое хранение обращений и платёжного провайдера.</div><button className="action-button" onClick={resetDemo}>Завершить консультацию</button></article></div>}
        </div>
        <p className="demo-note">Интерактивный прототип: реального списания денег и юридической консультации не происходит.</p>
      </section>

      <footer><div className="brand"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></div><p>Сложные налоги — простыми словами.</p><a href="#top">Наверх ↑</a></footer>
    </main>
  );
}
