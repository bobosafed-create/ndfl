"use client";

import { useMemo, useState } from "react";

type Acquisition = "purchase" | "inheritance" | "gift-close" | "gift-other" | "privatization";
type Answers = { unfinished: boolean | null; inheritedOrGifted: boolean | null; newHome: boolean | null; maternityCapital: boolean | null };

const RUB = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const initialAnswers: Answers = { unfinished: null, inheritedOrGifted: null, newHome: null, maternityCapital: null };

function money(value: number) {
  return `${RUB.format(Math.max(0, Math.round(value)))} ₽`;
}

function monthsBetween(start: string, end: string) {
  if (!start || !end) return 0;
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  let months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

function tenureLabel(months: number) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years % 10 === 1 && years % 100 !== 11 ? "год" : years % 10 >= 2 && years % 10 <= 4 && (years % 100 < 12 || years % 100 > 14) ? "года" : "лет"}`);
  if (rest) parts.push(`${rest} ${rest === 1 ? "месяц" : rest < 5 ? "месяца" : "месяцев"}`);
  return parts.join(" ") || "менее месяца";
}

function taxByPassiveScale(base: number) {
  const firstBand = Math.min(Math.max(base, 0), 2_400_000);
  return firstBand * 0.13 + Math.max(0, base - 2_400_000) * 0.15;
}

function yearsLabel(months: number) {
  const years = months / 12;
  return `${years} ${years === 1 ? "год" : years >= 2 && years <= 4 ? "года" : "лет"}`;
}

export default function CalculatorPage() {
  const [step, setStep] = useState(1);
  const [purchaseDate, setPurchaseDate] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [cadastralValue, setCadastralValue] = useState("");
  const [coefficient, setCoefficient] = useState("0.7");
  const [acquisition, setAcquisition] = useState<Acquisition>("purchase");
  const [onlyHome, setOnlyHome] = useState(false);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);

  const calculation = useMemo(() => {
    const bought = Number(purchasePrice) || 0;
    const sold = Number(salePrice) || 0;
    const cadastral = Number(cadastralValue) || 0;
    const coef = Math.min(1, Math.max(0.7, Number(coefficient) || 0.7));
    const tenureMonths = monthsBetween(purchaseDate, saleDate);
    const threeYearReason = onlyHome || acquisition === "inheritance" || acquisition === "gift-close" || acquisition === "privatization";
    const minimumMonths = threeYearReason ? 36 : 60;
    const exemptByTenure = tenureMonths >= minimumMonths;
    const taxableIncome = Math.max(sold, cadastral * coef);
    const documentedExpenses = acquisition === "purchase" ? bought : 0;
    const deduction = Math.max(1_000_000, documentedExpenses);
    const base = exemptByTenure ? 0 : Math.max(0, taxableIncome - deduction);
    const tax = exemptByTenure ? 0 : taxByPassiveScale(base);
    return { bought, sold, cadastral, coef, tenureMonths, minimumMonths, exemptByTenure, taxableIncome, deduction, base, tax };
  }, [purchasePrice, salePrice, cadastralValue, coefficient, purchaseDate, saleDate, acquisition, onlyHome]);

  const basicValid = Boolean(purchaseDate && saleDate && calculation.sold > 0 && new Date(saleDate) > new Date(purchaseDate));
  const diagnosticComplete = Object.values(answers).every((answer) => answer !== null);
  const positiveAnswers = Object.entries(answers).filter(([, answer]) => answer).map(([key]) => key);

  const reasons: Record<string, string> = {
    unfinished: "Расходы на отделку могут повлиять на расчёт при наличии необходимых условий и подтверждающих документов.",
    inheritedOrGifted: "В отдельных случаях можно учесть подтверждённые расходы наследодателя или дарителя.",
    newHome: "Покупка другого жилья может дать право на отдельный имущественный вычет, если он ранее не использован полностью.",
    maternityCapital: "Материнский капитал влияет на распределение расходов и долей собственников; требуется отдельная проверка.",
  };

  function setAnswer(key: keyof Answers, value: boolean) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  function goToConsultation() {
    const summary = [
      "Прошу проверить предварительный расчёт НДФЛ при продаже квартиры.",
      `Дата приобретения: ${purchaseDate}. Дата продажи: ${saleDate}.`,
      `Цена приобретения: ${money(calculation.bought)}. Цена продажи: ${money(calculation.sold)}.`,
      `Кадастровая стоимость: ${money(calculation.cadastral)}. Коэффициент: ${calculation.coef}.`,
      `Предварительная налоговая база: ${money(calculation.base)}. Предварительный налог: ${money(calculation.tax)}.`,
      positiveAnswers.length ? `Нужно проверить особые обстоятельства: ${positiveAnswers.map((key) => reasons[key]).join(" ")}` : "На диагностические вопросы даны отрицательные ответы.",
    ].join("\n");
    window.sessionStorage.setItem("ndfl-calculator-summary", summary);
    window.location.assign("/#room");
  }

  return (
    <main className="calc-page">
      <nav className="calc-nav">
        <a className="brand" href="/" aria-label="НДФЛ.просто — на главную"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></a>
        <a className="calc-back" href="/">← На главную</a>
      </nav>

      <header className="calc-hero">
        <div><span className="calc-kicker">Бесплатный предварительный расчёт</span><h1>НДФЛ при продаже квартиры</h1><p>Ответьте на несколько вопросов и получите ориентировочную сумму налога. Введённые данные рассчитываются только в вашем браузере и не отправляются на сервер.</p></div>
        <aside><b>Важно</b><p>Это предварительная оценка, а не налоговое заключение. Итог зависит от документов и обстоятельств сделки.</p></aside>
      </header>

      <ol className="calc-progress" aria-label="Этапы расчёта">
        {["Данные сделки", "Особые обстоятельства", "Результат"].map((label, index) => <li className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} key={label}><span>{step > index + 1 ? "✓" : index + 1}</span><b>{label}</b></li>)}
      </ol>

      <section className="calc-shell">
        {step === 1 && <div className="calc-step">
          <header><span>Шаг 1 из 3</span><h2>Данные о покупке и продаже</h2><p>Для срока владения важны точные даты, а не только годы.</p></header>
          <div className="calc-fields two-columns">
            <label>Дата приобретения<input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} /></label>
            <label>Дата продажи<input type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} /></label>
            <label>Цена приобретения, ₽<input type="number" min="0" step="10000" inputMode="numeric" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} placeholder="Например, 5 000 000" /></label>
            <label>Цена продажи, ₽<input type="number" min="0" step="10000" inputMode="numeric" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} placeholder="Например, 7 000 000" /></label>
            <label>Кадастровая стоимость на 1 января, ₽<input type="number" min="0" step="10000" inputMode="numeric" value={cadastralValue} onChange={(event) => setCadastralValue(event.target.value)} placeholder="Укажите, если известна" /><small>Нужна для сравнения с ценой продажи.</small></label>
            <label>Региональный коэффициент<select value={coefficient} onChange={(event) => setCoefficient(event.target.value)}><option value="0.7">0,7 — предварительно</option><option value="0.8">0,8</option><option value="0.9">0,9</option><option value="1">1,0</option></select><small>С 2025 года значение может зависеть от региона.</small></label>
            <label>Как получена квартира?<select value={acquisition} onChange={(event) => setAcquisition(event.target.value as Acquisition)}><option value="purchase">Покупка</option><option value="inheritance">Наследство</option><option value="gift-close">Дар от близкого родственника</option><option value="gift-other">Дар от другого лица</option><option value="privatization">Приватизация</option></select></label>
            <label className="calc-check"><input type="checkbox" checked={onlyHome} onChange={(event) => setOnlyHome(event.target.checked)} /><span><b>На дату продажи это было единственное жильё</b><small>Жильё, приобретённое за 90 дней до продажи, требует отдельной проверки.</small></span></label>
          </div>
          {purchaseDate && saleDate && <div className={`calc-preview ${basicValid ? "" : "warning"}`}><b>{basicValid ? "Предварительный расчёт" : "Проверьте даты"}</b>{basicValid ? <><span>Срок владения: <strong>{tenureLabel(calculation.tenureMonths)}</strong></span><span>Минимальный срок: <strong>{yearsLabel(calculation.minimumMonths)}</strong></span><span>Налоговая база: <strong>{money(calculation.base)}</strong></span><span>Налог: <strong>{money(calculation.tax)}</strong></span></> : <p>Дата продажи должна быть позже даты приобретения.</p>}</div>}
          <div className="calc-actions"><a href="/">Отмена</a><button type="button" disabled={!basicValid} onClick={() => setStep(2)}>Проверить возможные льготы →</button></div>
        </div>}

        {step === 2 && <div className="calc-step">
          <header><span>Шаг 2 из 3</span><h2>Что может изменить расчёт</h2><p>Ответьте «Да» или «Нет». Положительный ответ не гарантирует льготу — он показывает, что условие нужно проверить.</p></header>
          <div className="diagnostic-list">
            <DiagnosticQuestion number="01" text="Квартира покупалась у застройщика без чистовой отделки и сохранились документы о расходах?" value={answers.unfinished} onChange={(value) => setAnswer("unfinished", value)} />
            <DiagnosticQuestion number="02" text="Квартира была получена по наследству или в дар?" value={answers.inheritedOrGifted} onChange={(value) => setAnswer("inheritedOrGifted", value)} />
            <DiagnosticQuestion number="03" text="Вы покупали другое жильё в том же календарном году и не использовали весь имущественный вычет?" value={answers.newHome} onChange={(value) => setAnswer("newHome", value)} />
            <DiagnosticQuestion number="04" text="Для покупки использовался материнский капитал или доли принадлежат детям?" value={answers.maternityCapital} onChange={(value) => setAnswer("maternityCapital", value)} />
          </div>
          <div className="calc-actions"><button className="secondary" type="button" onClick={() => setStep(1)}>← Назад</button><button type="button" disabled={!diagnosticComplete} onClick={() => setStep(3)}>Показать результат →</button></div>
        </div>}

        {step === 3 && <div className="calc-step calc-result">
          <header><span>Шаг 3 из 3</span><h2>{calculation.exemptByTenure ? "По сроку владения налог предварительно не возникает" : positiveAnswers.length ? "Найдены обстоятельства для проверки" : "Предварительный расчёт готов"}</h2><p>Расчёт основан только на введённых данных.</p></header>
          <div className="result-grid">
            <article><small>Срок владения</small><strong>{tenureLabel(calculation.tenureMonths)}</strong><p>{calculation.exemptByTenure ? "Минимальный срок предварительно соблюдён." : `Меньше предварительного минимального срока — ${yearsLabel(calculation.minimumMonths)}.`}</p></article>
            <article><small>Доход для расчёта</small><strong>{money(calculation.taxableIncome)}</strong><p>Большее из цены продажи и кадастровой стоимости с выбранным коэффициентом.</p></article>
            <article><small>Налоговая база</small><strong>{money(calculation.base)}</strong><p>Учтён наиболее выгодный из базовых вариантов: расходы на покупку либо вычет 1 млн ₽.</p></article>
            <article className="tax-total"><small>Предварительный НДФЛ</small><strong>{money(calculation.tax)}</strong><p>13% с базы до 2,4 млн ₽ и 15% с превышения.</p></article>
          </div>
          {positiveAnswers.length > 0 && <div className="found-reasons"><b>Следует проверить дополнительно</b><ul>{positiveAnswers.map((key) => <li key={key}>{reasons[key]}</li>)}</ul><p><strong>Потенциальная экономия пока не рассчитана:</strong> для неё нужны дополнительные суммы и подтверждающие документы.</p></div>}
          <div className="deadline-note"><b>Сроки</b><p>{calculation.exemptByTenure ? "Если освобождение подтверждается, декларация по этой продаже обычно не требуется." : `Если продажа состоялась в ${new Date(saleDate).getFullYear()} году, декларацию обычно подают до 30 апреля ${new Date(saleDate).getFullYear() + 1} года, а налог уплачивают до 15 июля ${new Date(saleDate).getFullYear() + 1} года.`}</p></div>
          <div className="expert-offer"><span>Нужна проверка специалиста?</span><h3>Точный расчёт и пошаговая инструкция</h3><p>Передадим введённые данные в бланк вопроса. До отправки вы сможете проверить и отредактировать текст.</p><button type="button" onClick={goToConsultation}>Перейти к консультации →</button><small>Стоимость и срок выбираются на основной странице. Без регистрации.</small></div>
          <div className="calc-actions"><button className="secondary" type="button" onClick={() => setStep(2)}>← Изменить ответы</button><button className="secondary" type="button" onClick={() => { setStep(1); setAnswers(initialAnswers); }}>Новый расчёт</button></div>
        </div>}
      </section>

      <footer className="calc-footer"><p>Предварительный расчёт не заменяет проверку документов и индивидуальную консультацию.</p><nav><a href="/legal#offer">Оферта</a><a href="/legal#privacy">Конфиденциальность</a><a href="/legal#contacts">Контакты</a></nav></footer>
    </main>
  );
}

function DiagnosticQuestion({ number, text, value, onChange }: { number: string; text: string; value: boolean | null; onChange: (value: boolean) => void }) {
  return <fieldset><legend><span>{number}</span>{text}</legend><div><label className={value === true ? "selected" : ""}><input type="radio" checked={value === true} onChange={() => onChange(true)} />Да</label><label className={value === false ? "selected" : ""}><input type="radio" checked={value === false} onChange={() => onChange(false)} />Нет</label></div></fieldset>;
}
