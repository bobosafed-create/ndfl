import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the consultation landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Проблемы с НДФЛ — вам сюда<\/title>/i);
  assert.match(html, /Ответ проверяет специалист/);
  assert.match(html, /Проверенный налоговым специалистом письменный ответ в срок выбранного тарифа/);
  assert.match(html, /Выберите подходящий тариф/);
  assert.match(html, /Базовый/);
  assert.match(html, /Стандартный/);
  assert.match(html, /Срочный/);
  assert.match(html, /Сложный случай/);
  assert.match(html, /Задаваемые вопросы/);
  assert.doesNotMatch(html, /Входит ли в консультацию дополнительный уточняющий вопрос/);
  assert.doesNotMatch(html, /Что произойдёт, если для точного вывода недостаточно данных/);
  assert.match(html, /Налоговый консультант/);
  assert.match(html, /Александр Владимирович/);
  assert.match(html, /более 20 лет/i);
  assert.match(html, /СРО аудиторов ААС/);
  assert.match(html, /понедельник–пятница/i);
  assert.match(html, /зашифрованном виде/);
  assert.doesNotMatch(html, /codex-preview|Building your site/);
});

test("renders the preliminary apartment-sale tax calculator", async () => {
  const response = await render("/calc");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /НДФЛ при продаже квартиры/);
  assert.match(html, /почти в/);
  assert.match(html, /20 раз больше/);
  assert.match(html, /Квартира от застройщика без отделки/);
  assert.match(html, /Проверьте возможную экономию/);
  assert.match(html, /подп\. 4 и 5 п\. 3 статьи 220 НК РФ/);
  assert.match(html, /Не всякий ремонт или покупка для интерьера признаются отделкой/);
  assert.doesNotMatch(html, /Покупка — 5 млн ₽/);
  assert.doesNotMatch(html, /130 000 ₽ налога|115 050 ₽ налога|Экономия — 14 950 ₽/);
  assert.doesNotMatch(html, /Кадастровая стоимость на 1 января|Региональный коэффициент/);
});

test("renders the ownership-period landing page with qualified legal claims", async () => {
  const response = await render("/srok-vladeniya");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /не выдержали/);
  assert.match(html, /Срок начинается со дня смерти наследодателя/);
  assert.match(html, /Для приватизации до 1 февраля 1998 года/);
  assert.match(html, /Минимальный срок — 3 года/);
  assert.match(html, /Новое жильё, купленное не более чем за 90 дней/);
  assert.match(html, /Налог может оказаться равен 0 ₽/);
  assert.match(html, /только после проверки документов/);
});

test("keeps consultation codes four digits and uses the protected payment flow", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /maxLength=\{4\}/);
  assert.match(page, /\/api\/payments\/create/);
  assert.match(page, /Защищённая оплата через ЮKassa/);
  assert.match(page, /ndfl-active-consultation/);
  assert.doesNotMatch(page, /Демонстрационный платёж/);
  assert.match(page, /окошко закроется через/);
  assert.match(page, /paginateAnswer/);
  assert.match(page, /answer-carousel/);
  assert.match(page, /Страница <b>/);
  assert.match(page, /Далее →/);
  assert.doesNotMatch(page, /type="file"/);
  assert.doesNotMatch(page, /\/api\/consultations\/attachments/);
  assert.match(page, /не указываю в вопросе персональные данные/);
  assert.match(page, /specialist-photo\.jpg/);
  assert.doesNotMatch(page, /consultant-male-v3\.png/);
  assert.doesNotMatch(page, /Ваш консультант<\/span><strong>Анна/);
  assert.match(page, /className="mobile-question-cta"/);
  assert.match(page, /mobile-question-cta" type="button" onClick=\{\(\) => setStage\("payment"\)\}/);
  assert.match(page, /<span>ВХОД<\/span><strong>\{priceLabel\}<\/strong>/);
  assert.doesNotMatch(page, /ВХОД[^\n]*срок/i);
  assert.match(page, /Срок будет указан после оплаты/);
  assert.match(page, /body: JSON\.stringify\(\{ tariffCode: selectedTariffCode \|\| null \}\)/);
  assert.match(page, /ndfl-calculator-tariff/);
  assert.match(page, /setSelectedTariffCode\(""\)/);
  assert.match(page, /Выключите VPN, если он включён/);
  assert.match(page, /VPN выключен — перейти к оплате/);
  assert.match(page, /Скачать ответ/);
  assert.match(page, /Печать \/ PDF/);
  assert.match(page, /Отзывы и предложения посетителей/);
  assert.match(page, /Отправить на проверку/);
  assert.match(page, /\/api\/feedback/);
  assert.match(page, /\/api\/visits/);
  assert.match(page, /\/api\/consultant\/visitor-stats/);
});

test("sets the selected tariff deadline when the visitor saves a question", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /COALESCE\(tariff_deadline_minutes, 240\) \* interval '1 minute'/);
  assert.match(router, /SET status = 'question_submitted'/);
  assert.match(router, /RETURNING answer_due_at/);
  assert.doesNotMatch(router, /interval '4 hours'/);
});

test("legal documents describe the anonymous mode without hiding technical processing", async () => {
  const legal = await readFile(new URL("../app/legal/page.tsx", import.meta.url), "utf8");
  assert.match(legal, /<a className="cabinet-back" href="\/#room" aria-label="Вернуться на сайт">/);
  assert.doesNotMatch(legal, /next\/link/);
  assert.match(legal, /не идентифицирует и не персонализирует Посетителя/);
  assert.match(legal, /Функция загрузки файлов и документов отключена/);
  assert.match(legal, /не означает полного отсутствия технической обработки/);
  assert.match(legal, /IP-адрес и время запросов/);
  assert.match(legal, /Дополнительный или уточняющий вопрос в эту услугу не входит/);
  assert.match(legal, /Ответ составлен по предоставленным данным/);
  assert.match(legal, /не ограничивает обязательные права потребителя/);
});

test("renders the consultant cabinet", async () => {
  const page = await readFile(new URL("../app/consultant/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Кабинет консультанта/);
  assert.match(page, /\/api\/consultant\/consultations/);
  assert.match(page, /Отправить в сейф/);
  assert.match(page, /type="password"/);
  assert.match(page, /Вернуться на сайт/);
  assert.match(page, /Стоимость консультации/);
  assert.match(page, /Подготовить черновик с ИИ/);
  assert.match(page, /Скопировать вопрос/);
  assert.match(page, /\/api\/consultant\/calculations/);
  assert.match(page, /Архив консультаций/);
  assert.match(page, /Удалить вопрос и ответ/);
  assert.match(page, /window\.location\.assign\("\/#room"\)/);
  assert.match(page, /window\.print/);
  assert.match(page, /Установить цену на сайте/);
  assert.match(page, /consultant\/attachments/);
  assert.match(page, /цена по умолчанию/i);
  assert.match(page, /Тариф:/);
  assert.match(page, /Срочный тариф/);
  assert.match(page, /\/api\/consultant\/settings/);
  assert.match(page, /\/api\/consultant\/pending-summary/);
  assert.match(page, /Включить звук/);
  assert.match(page, /Поступил новый вопрос/);
  assert.match(page, /new Notification/);
  assert.match(page, /Оповещения по НДФЛ включены/);
  assert.match(page, /пробное системное уведомление Windows/);
  assert.match(page, /AudioContext/);
  assert.match(page, /Отзывы и предложения/);
  assert.match(page, /Опубликовать/);
  assert.match(page, /\/api\/consultant\/feedback/);
  assert.match(page, /Дни и часы приёма вопросов/);
  assert.match(page, /Сохранить расписание/);
  assert.match(page, /serviceSchedule/);
  assert.match(page, /Выберите консультацию в перечне выше/);
  assert.doesNotMatch(page, /Старые тестовые записи|Тестовых записей нет|не являются платежами ЮKassa/);
});

test("provides the short consultant cabinet address", async () => {
  const alias = await readFile(new URL("../app/cons/page.tsx", import.meta.url), "utf8");
  assert.match(alias, /consultant\/page/);
});
