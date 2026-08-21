import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import worker from "./dist/server/index.js";

const port = Number(process.env.PORT ?? 3000);
const clientRoot = join(process.cwd(), "dist", "client");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function assetResponse(input) {
  const assetUrl = new URL(typeof input === "string" ? input : input.url);
  const relativePath = normalize(decodeURIComponent(assetUrl.pathname)).replace(
    /^(\.\.(\/|\\|$))+|^(\/|\\)+/,
    "",
  );
  const filePath = join(clientRoot, relativePath);

  if (!filePath.startsWith(clientRoot)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return new Response("Not found", { status: 404 });
    const body = await readFile(filePath);
    return new Response(body, {
      headers: {
        "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
        "cache-control": assetUrl.pathname.startsWith("/_next/static/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const server = createServer(async (request, response) => {
  try {
    const host = request.headers.host ?? `127.0.0.1:${port}`;
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    const method = request.method ?? "GET";

    if (method === "GET" || method === "HEAD") {
      const staticResponse = await assetResponse(requestUrl.href);
      if (staticResponse.status !== 404) {
        response.writeHead(
          staticResponse.status,
          Object.fromEntries(staticResponse.headers),
        );
        response.end(
          method === "HEAD"
            ? undefined
            : Buffer.from(await staticResponse.arrayBuffer()),
        );
        return;
      }
    }

    const fetchRequest = new Request(requestUrl, {
      method,
      headers: request.headers,
      body: method === "GET" || method === "HEAD" ? undefined : request,
      duplex: method === "GET" || method === "HEAD" ? undefined : "half",
    });

    const fetchResponse = await worker.fetch(
      fetchRequest,
      { ASSETS: { fetch: assetResponse } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    response.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers));
    if (method === "HEAD" || !fetchResponse.body) {
      response.end();
      return;
    }

    response.end(Buffer.from(await fetchResponse.arrayBuffer()));
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`NDFL site is running on port ${port}`);
});
