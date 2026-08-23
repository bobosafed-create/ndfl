import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
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
  assert.match(html, /Нужна консультация/);
  assert.match(html, /Проверенный налоговым специалистом письменный ответ в течение 4 часов/);
  assert.match(html, /<strong>100 ₽<\/strong>/);
  assert.match(html, /Задаваемые вопросы/);
  assert.match(html, /Входит ли в консультацию дополнительный уточняющий вопрос/);
  assert.match(html, /Дополнительный или уточняющий вопрос оформляется как новая консультация/);
  assert.match(html, /Дежурный/);
  assert.match(html, /зашифрованном виде/);
  assert.doesNotMatch(html, /codex-preview|Building your site/);
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
  assert.match(page, /consultant-male-v3\.png/);
  assert.doesNotMatch(page, /Ваш консультант<\/span><strong>Анна/);
  assert.match(page, /className="mobile-question-cta"/);
  assert.match(page, /mobile-question-cta" type="button" onClick=\{\(\) => setStage\("payment"\)\}/);
  assert.match(page, /<span>ВХОД<\/span><strong>\{priceLabel\}<\/strong>/);
  assert.doesNotMatch(page, /ВХОД[^\n]*срок/i);
  assert.match(page, /в течение 4 часов/);
});

test("sets a four-hour answer deadline for new paid consultations", async () => {
  const router = await readFile(new URL("../api/router.mjs", import.meta.url), "utf8");
  assert.match(router, /interval '4 hours'/);
  assert.doesNotMatch(router, /interval '1 hour'/);
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
});
