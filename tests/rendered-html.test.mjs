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
  assert.match(html, /Интерактивный прототип/);
  assert.doesNotMatch(html, /codex-preview|Building your site/);
});

test("keeps consultation codes four digits and avoids real payment claims", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /1000 \+ \(randomValue % 9000\)/);
  assert.match(page, /maxLength=\{4\}/);
  assert.match(page, /Демонстрационный платёж/);
  assert.match(page, /деньги не списываются/i);
  assert.match(page, /окошко закроется через/);
});
