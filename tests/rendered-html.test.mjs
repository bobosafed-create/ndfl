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
  assert.match(html, /Оплатите <strong>100 ₽<\/strong>/);
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
