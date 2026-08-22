import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import worker from "./dist/server/index.js";
import { routeApi } from "./api/router.mjs";
import {
  checkDatabase,
  classifyDatabaseError,
  initializeDatabase,
} from "./db/postgres.mjs";

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

    if (requestUrl.pathname === "/health") {
      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end("OK");
      return;
    }

    if (requestUrl.pathname === "/api/health/database") {
      const databaseStatus = await checkDatabase();
      const statusCode = databaseStatus.status === "ok" ? 200 : 503;
      response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(databaseStatus));
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      const apiRequest = new Request(requestUrl, {
        method,
        headers: request.headers,
        body: method === "GET" || method === "HEAD" ? undefined : request,
        duplex: method === "GET" || method === "HEAD" ? undefined : "half",
      });
      const apiResponse = await routeApi(apiRequest);
      if (apiResponse) {
        response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers));
        response.end(Buffer.from(await apiResponse.arrayBuffer()));
        return;
      }
    }

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

try {
  await initializeDatabase();
  server.listen(port, () => {
    console.log(`NDFL site is running on port ${port}`);
  });
} catch (error) {
  console.error(
    `PostgreSQL initialization failed: ${classifyDatabaseError(error)}`,
  );
  process.exitCode = 1;
}
