"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const RUB = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const CONSULTATION_PRICE = 750;

function money(value: number) {
  return `${RUB.format(Math.max(0, Math.round(value)))} ₽`;
}

function taxBySaleScale(base: number) {
  const firstBand = Math.min(Math.max(base, 0), 2_400_000);
  return firstBand * 0.13 + Math.max(0, base - 2_400_000) * 0.15;
}

export default function CalculatorPage() {
  const [purchasePrice, setPurchasePrice] = useState("5000000");
  const [salePrice, setSalePrice] = useState("6000000");
  const [finishingExpenses, setFinishingExpenses] = useState("115000");
  const [withoutFinishing, setWithoutFinishing] = useState<boolean | null>(true);
  const [hasDocuments, setHasDocuments] = useState<boolean | null>(true);

  const calculation = useMemo(() => {
    const purchase = Math.max(0, Number(purchasePrice) || 0);
    const sale = Math.max(0, Number(salePrice) || 0);
    const finishing = Math.max(0, Number(finishingExpenses) || 0);
    const initialBase = Math.max(0, sale - purchase);
    const eligibleForExample = withoutFinishing === true && hasDocuments === true;
    const acceptedFinishing = eligibleForExample ? Math.min(finishing, initialBase) : 0;
    const newBase = Math.max(0, initialBase - acceptedFinishing);
    const initialTax = taxBySaleScale(initialBase);
    const newTax = taxBySaleScale(newBase);
    const saving = Math.max(0, initialTax - newTax);
    const payback = saving / CONSULTATION_PRICE;
    return { purchase, sale, finishing, initialTax, newTax, saving, payback };
  }, [purchasePrice, salePrice, finishingExpenses, withoutFinishing, hasDocuments]);

  function goToConsultation() {
    const summary = [
      "Прошу проверить возможность учесть расходы на отделку при расчёте НДФЛ с продажи квартиры.",
      `Цена покупки: ${money(calculation.purchase)}. Цена продажи: ${money(calculation.sale)}.`,
      `Расходы на отделочные материалы и работы: ${money(calculation.finishing)}.`,
      `В договоре указано приобретение квартиры без отделки: ${withoutFinishing ? "да" : "нет"}.`,
      `Подтверждающие документы сохранились: ${hasDocuments ? "да" : "нет"}.`,
      `Предварительный налог без учёта отделки: ${money(calculation.initialTax)}.`,
      `Предварительный налог с учётом указанных расходов: ${money(calculation.newTax)}.`,
      "Прошу проверить применимость правила, состав расходов и документы.",
    ].join("\n");
    window.sessionStorage.setItem("ndfl-calculator-summary", summary);
    window.sessionStorage.setItem("ndfl-calculator-tariff", "urgent");
    window.location.assign("/#room");
  }

  return (
    <main className="calc-page savings-page">
      <nav className="calc-nav">
        <Link className="brand" href="/" aria-label="НДФЛ.просто — на главную"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></Link>
        <Link className="calc-back" href="/">← На главную</Link>
      </nav>

      <header className="savings-hero">
        <div className="savings-hero-copy">
          <span className="savings-kicker">Один забытый расход — заметная разница</span>
          <h1>Вы можете потерять почти в <em>20 раз больше</em> стоимости консультации</h1>
          <p>Покажем на простом примере, как одно обстоятельство может уменьшить НДФЛ при продаже квартиры.</p>
          <a href="#example">Посмотреть расчёт <span>↓</span></a>
        </div>
        <div className="savings-score" aria-label="Экономия в примере">
          <small>Экономия в примере</small>
          <strong>14 950 ₽</strong>
          <div><span>Консультация</span><b>750 ₽</b></div>
          <p>Окупилась почти в <b>20 раз</b></p>
        </div>
      </header>

      <section id="example" className="simple-calculator savings-calculator-section" aria-labelledby="example-heading">
        <header className="savings-calculator-heading">
          <span>Наглядный пример</span>
          <h2 id="example-heading">Квартира от застройщика без отделки</h2>
          <h3>Проверьте возможную экономию</h3>
          <p>Введите три суммы и ответьте на два важных вопроса. Остальные обстоятельства после заказа проверит консультант.</p>
        </header>
        <div className="simple-calc-card">
          <div className="simple-calc-inputs">
            <label>Цена покупки, ₽<input type="number" min="0" step="10000" inputMode="numeric" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} /></label>
            <label>Цена продажи, ₽<input type="number" min="0" step="10000" inputMode="numeric" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} /></label>
            <label>Расходы на отделку, ₽<input type="number" min="0" step="1000" inputMode="numeric" value={finishingExpenses} onChange={(event) => setFinishingExpenses(event.target.value)} /></label>
          </div>
          <div className="simple-calc-questions">
            <BinaryQuestion text="В договоре указано, что квартира приобретена без отделки?" value={withoutFinishing} onChange={setWithoutFinishing} />
            <BinaryQuestion text="Сохранились чеки, договоры, акты и подтверждения оплаты?" value={hasDocuments} onChange={setHasDocuments} />
          </div>
          <div className="simple-result">
            <div><small>Без учёта отделки</small><strong>{money(calculation.initialTax)}</strong><span>предварительный налог</span></div>
            <i aria-hidden="true">→</i>
            <div><small>После проверки расходов</small><strong>{money(calculation.newTax)}</strong><span>предварительный налог</span></div>
            <article className={calculation.saving > 0 ? "positive" : ""}><small>Возможная экономия</small><strong>{money(calculation.saving)}</strong>{calculation.saving > 0 ? <p>Это примерно <b>{calculation.payback.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}</b> стоимости консультации по 750 ₽.</p> : <p>{withoutFinishing === false ? "В договоре нет необходимого условия." : hasDocuments === false ? "Без документов расходы подтвердить нельзя." : "Укажите сумму расходов на отделку."}</p>}</article>
          </div>
          <div className="simple-disclaimer"><b>Это демонстрационный расчёт</b><p>Он не учитывает срок владения, кадастровую стоимость, региональные правила, доли собственников и другие обстоятельства. Они могут изменить итог в любую сторону.</p></div>
        </div>
        <div className="savings-law"><b>Почему это возможно</b><p>ФНС разъясняет: доход от продажи квартиры можно уменьшить на подтверждённые расходы по её отделке, если договор предусматривал приобретение квартиры без отделки. Для квартиры применяются подп. 2 п. 2 статьи 220 НК РФ во взаимосвязи с подп. 4 и 5 п. 3 статьи 220 НК РФ.</p><a href="https://www.nalog.gov.ru/rn40/news/tax_doc_news/6168830/" target="_blank" rel="noreferrer">Проверить разъяснение на сайте ФНС России →</a></div>
        <p className="savings-caveat">В примере предполагается, что все расходы относятся к допустимым и подтверждены надлежащими документами. Не всякий ремонт или покупка для интерьера признаются отделкой.</p>
      </section>

      <section className="savings-offer">
        <div><span>Следующий шаг</span><h2>Проверьте расчёт до подачи 3-НДФЛ</h2><p>Цифры из калькулятора будут перенесены в бланк вопроса. Вы сможете дополнить и отредактировать их перед отправкой.</p></div>
        <aside><strong>750 ₽</strong><b>Срочная консультация — до 1 часа</b><small>Если срочный тариф доступен в момент заказа</small><button type="button" onClick={goToConsultation}>Оплатить и задать вопрос →</button><em>Без регистрации</em></aside>
      </section>

      <footer className="calc-footer"><p>Предварительный пример не заменяет проверку договора, расходов и подтверждающих документов.</p><nav><a href="/legal#offer">Оферта</a><a href="/legal#privacy">Конфиденциальность</a><a href="/legal#contacts">Контакты</a></nav></footer>
    </main>
  );
}

function BinaryQuestion({ text, value, onChange }: { text: string; value: boolean | null; onChange: (value: boolean) => void }) {
  return <fieldset><legend>{text}</legend><div><label className={value === true ? "selected" : ""}><input type="radio" checked={value === true} onChange={() => onChange(true)} />Да</label><label className={value === false ? "selected" : ""}><input type="radio" checked={value === false} onChange={() => onChange(false)} />Нет</label></div></fieldset>;
}
