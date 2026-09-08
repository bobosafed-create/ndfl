"use client";

import Link from "next/link";
import LegalFooterLinks from "../../components/LegalFooterLinks";
import { reachMetrikaGoal } from "../../lib/metrika";

export default function ApartmentSalePage() {
  return (
    <main className="calc-page apartment-page">
      <nav className="calc-nav">
        <Link className="brand" href="/" aria-label="НДФЛ.просто — на главную"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></Link>
        <button className="calc-back" type="button" onClick={() => window.location.assign("/#top")}>← На главную</button>
      </nav>

      <header className="apartment-hero">
        <div>
          <span className="savings-kicker">НДФЛ при продаже квартиры</span>
          <h1>Продали квартиру? <em>Проверьте обстоятельства</em></h1>
          <p>Цена продажи — не единственное, от чего зависит налог. Важны срок и основание владения, кадастровая стоимость, подтверждённые расходы, право на вычет и порядок декларирования.</p>
          <div className="apartment-hero-actions">
            <a href="#sale-routes">Что проверить <span>↓</span></a>
            <button type="button" onClick={() => { reachMetrikaGoal("content_to_consultation", { source: "apartment_landing", destination: "diagnostic" }); window.location.assign("/?situation=prodazha-kvartiry#diagnostic"); }}>Пройти бесплатную диагностику</button>
          </div>
        </div>
        <aside>
          <small>Порядок проверки</small>
          <ol><li><b>1</b><span>Возникает ли налог</span></li><li><b>2</b><span>Из какой суммы его считать</span></li><li><b>3</b><span>За счёт чего уменьшить налогооблагаемую базу</span></li><li><b>4</b><span>Нужна ли декларация</span></li></ol>
        </aside>
      </header>

      <section id="sale-routes" className="apartment-routes" aria-labelledby="sale-routes-heading">
        <header><span>Четыре ключевые проверки</span><h2 id="sale-routes-heading">Начните с вопроса, который влияет на результат</h2><p>Ответы зависят от документов и конкретных дат. Эта страница помогает выбрать правильный следующий шаг, но не заменяет индивидуальную проверку.</p></header>
        <div>
          <article><span>01</span><h3>Минимальный срок владения</h3><p>Проверьте основание приобретения и юридически значимую дату. В разных ситуациях применяются разные сроки, а дата регистрации права не всегда является точкой отсчёта.</p><a href="/srok-vladeniya" onClick={() => reachMetrikaGoal("content_period_open", { source: "apartment_landing" })}>Проверить срок владения →</a></article>
          <article><span>02</span><h3>Доход для расчёта</h3><p>Сопоставьте цену договора и кадастровую стоимость. Правило 70% кадастровой стоимости может повлиять на сумму дохода, принимаемую для налогообложения.</p></article>
          <article><span>03</span><h3>Расходы на отделку квартиры</h3><p>Проверьте, можно ли учесть документально подтверждённые расходы на отделку. Важны условия договора, состав расходов и сохранность подтверждающих документов.</p><a href="/calc" onClick={() => reachMetrikaGoal("content_calc_open", { source: "apartment_landing" })}>Открыть пример расчёта →</a></article>
          <article><span>04</span><h3>3-НДФЛ и сроки</h3><p>Отдельно проверьте обязанность подать декларацию, срок её представления и срок уплаты налога. Освобождение от налога и освобождение от декларирования требуют проверки условий.</p></article>
        </div>
      </section>

      <section className="apartment-checklist">
        <div><span>Подготовьте перед проверкой</span><h2>Какие сведения понадобятся</h2></div>
        <ul><li>дата и основание приобретения квартиры;</li><li>дата и цена продажи;</li><li>кадастровая стоимость на 1 января года продажи;</li><li>договоры и подтверждения расходов;</li><li>сведения о долях и семейном статусе, если они влияют на ситуацию.</li></ul>
      </section>

      <section className="apartment-final">
        <div><span>Не уверены в результате?</span><h2>Начните с бесплатной первичной диагностики</h2><p>Вы получите предварительный обзор того, что важно проверить. Если потребуется персональный вывод или расчёт, сайт предложит подходящий формат консультации.</p></div>
        <button type="button" onClick={() => { reachMetrikaGoal("content_to_consultation", { source: "apartment_landing", destination: "diagnostic_bottom" }); window.location.assign("/?situation=prodazha-kvartiry#diagnostic"); }}>Проверить ситуацию бесплатно →</button>
      </section>

      <footer className="calc-footer"><p>Материалы страницы носят предварительный характер. Итог зависит от документов и обстоятельств конкретной сделки.</p><LegalFooterLinks /></footer>
    </main>
  );
}
