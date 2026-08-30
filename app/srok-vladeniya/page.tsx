"use client";

import Link from "next/link";

export default function OwnershipPeriodPage() {
  function goToConsultation() {
    const summary = [
      "Прошу проверить минимальный срок владения квартирой и обязанность платить НДФЛ при её продаже.",
      "Нужно определить правильную дату начала владения, применимый срок — 3 или 5 лет — и необходимость подачи 3-НДФЛ.",
      "Основание приобретения квартиры и даты я укажу ниже.",
    ].join("\n");
    window.sessionStorage.setItem("ndfl-calculator-summary", summary);
    window.sessionStorage.setItem("ndfl-calculator-tariff", "situation-check");
    window.location.assign("/#room");
  }

  return (
    <main className="calc-page savings-page period-page">
      <nav className="calc-nav">
        <Link className="brand" href="/" aria-label="НДФЛ.просто — на главную"><span className="brand-mark">₽</span><span>НДФЛ<span className="brand-dot">.просто</span></span></Link>
        <button className="calc-back" type="button" onClick={() => window.location.assign("/#top")}>← На главную</button>
      </nav>

      <header className="savings-hero period-hero">
        <div className="savings-hero-copy">
          <span className="savings-kicker">Проверьте дату до уплаты налога</span>
          <h1>Вы уверены, что <em>не выдержали</em> срок владения?</h1>
          <p>Пять лет — не универсальное правило, а дата регистрации права не всегда является точкой отсчёта. Одна проверка может изменить налог полностью.</p>
          <a href="#period-check">Проверить ситуацию <span>↓</span></a>
        </div>
        <div className="savings-score period-score" aria-label="Возможный результат проверки">
          <small>Возможный результат проверки</small>
          <strong>0 ₽</strong>
          <div><span>НДФЛ с продажи</span><b>не возникает</b></div>
          <p>И декларацию <b>подавать не нужно</b></p>
          <small className="period-score-note">Если минимальный срок действительно истёк и соблюдены условия освобождения</small>
        </div>
      </header>

      <section id="period-check" className="period-check" aria-labelledby="period-check-heading">
        <header>
          <span>Ошибка, которая стоит денег</span>
          <h2 id="period-check-heading">Сначала определите правильную точку отсчёта</h2>
          <p>Человек смотрит на выписку ЕГРН, видит, что пять лет ещё не прошло, и готовится платить налог. Но эксперт проверяет основание приобретения и применимый именно к этой ситуации срок.</p>
        </header>

        <div className="period-situation">
          <span>Обычный вывод</span>
          <strong>«Пяти лет нет — значит, придётся платить»</strong>
          <i aria-hidden="true">↓</i>
          <b>Проверка эксперта</b>
        </div>

        <div className="period-routes">
          <article>
            <span>01</span>
            <small>Наследство</small>
            <h3>Срок начинается со дня смерти наследодателя</h3>
            <p>Более поздняя регистрация права наследника в ЕГРН не переносит начало срока владения.</p>
            <b>Минимальный срок — 3 года</b>
          </article>
          <article>
            <span>02</span>
            <small>Приватизация</small>
            <h3>Важно проверить дату оформления права</h3>
            <p>Для приватизации до 1 февраля 1998 года значение имеет договор передачи. Для более поздней приватизации — государственная регистрация права.</p>
            <b>Минимальный срок — 3 года</b>
          </article>
          <article>
            <span>03</span>
            <small>Единственное жильё</small>
            <h3>Вместо пяти лет могут применяться три</h3>
            <p>Проверяется отсутствие другого жилья или доли, включая совместную собственность супругов, на дату регистрации перехода права к покупателю. Новое жильё, купленное не более чем за 90 дней до продажи старого, не учитывается.</p>
            <b>Минимальный срок — 3 года</b>
          </article>
        </div>

        <div className="period-result">
          <div><small>После проверки документов и дат</small><strong>Налог может оказаться равен 0 ₽</strong><p>Если квартира находилась в собственности не меньше применимого минимального срока, доход от её продажи освобождается от НДФЛ. В общем случае подавать 3-НДФЛ по такой продаже не требуется.</p></div>
          <aside><b>Эксперт проверит</b><ul><li>основание приобретения квартиры;</li><li>юридически значимую дату начала владения;</li><li>срок 3 или 5 лет;</li><li>жильё и доли, принадлежащие супругам;</li><li>исключение для нового жилья, купленного за 90 дней.</li></ul></aside>
        </div>

        <div className="period-sources">
          <b>Проверить правила на сайте ФНС России</b>
          <a href="https://www.nalog.gov.ru/rn60/taxation/taxes/ndfl/13690090/" target="_blank" rel="noreferrer">Срок 3 или 5 лет и единственное жильё →</a>
          <a href="https://www.nalog.gov.ru/rn70/news/international_activities/12068964/" target="_blank" rel="noreferrer">Как определяется дата при приватизации →</a>
        </div>
        <p className="savings-caveat period-caveat">Результат зависит от вида объекта, даты и основания приобретения, состава собственности супругов и других обстоятельств. Вывод «налог 0 ₽» можно делать только после проверки документов.</p>
      </section>

      <section className="savings-offer">
        <div><span>Следующий шаг</span><h2>Узнайте, нужно ли вам платить налог</h2><p>После оплаты в бланк вопроса будет перенесена заготовка. Добавьте основание приобретения квартиры и даты — консультант проверит срок владения.</p></div>
        <aside><strong>390 ₽</strong><b>Проверка ситуации — до 4 часов</b><small>Допопция «Срочно» до 2 часов доступна на главной странице за 300 ₽</small><button type="button" onClick={goToConsultation}>Проверить мой срок владения →</button><em>Без регистрации</em></aside>
      </section>

      <footer className="calc-footer"><p>Информация на странице носит предварительный характер и не заменяет проверку документов.</p><nav><Link href="/legal#offer">Оферта</Link><Link href="/legal#privacy">Конфиденциальность</Link><Link href="/legal#contacts">Контакты</Link></nav></footer>
    </main>
  );
}
