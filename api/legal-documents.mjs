import { randomUUID } from "node:crypto";
import { getDatabasePool } from "../db/postgres.mjs";
import { consultantKeyMatches } from "../lib/security.mjs";

const MAX_BODY_BYTES = 65_536;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function authorized(request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") && consultantKeyMatches(authorization.slice(7));
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function requestBody(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new Error("body_too_large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("body_too_large");
  return text.trim() ? JSON.parse(text) : {};
}

function mapDocument(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    footerLabel: row.footer_label,
    body: row.body,
    status: row.status,
    showInFooter: row.show_in_footer,
    sortOrder: row.sort_order,
    isSystem: row.is_system,
    revision: row.revision,
    publishedRevision: row.published_revision,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalize(input, { requireSlug = false } = {}) {
  const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const footerLabel = typeof input.footerLabel === "string" ? input.footerLabel.trim() : "";
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").trim() : "";
  const sortOrder = Number(input.sortOrder);
  if ((requireSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) || slug.length > 64) return null;
  if (title.length < 3 || title.length > 160 || footerLabel.length < 2 || footerLabel.length > 80) return null;
  if (body.length < 20 || body.length > 30_000 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) return null;
  if (typeof input.showInFooter !== "boolean") return null;
  return { slug, title, footerLabel, body, sortOrder, showInFooter: input.showInFooter };
}

async function publicList() {
  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);
  const result = await database.query(
    `SELECT d.id, d.slug, v.title, v.footer_label, v.body, 'published' AS status,
            v.show_in_footer, v.sort_order, d.is_system, d.revision,
            d.published_revision, d.published_at, d.created_at, v.created_at AS updated_at
     FROM legal_documents d
     JOIN legal_document_versions v
       ON v.document_id = d.id AND v.revision = d.published_revision
     WHERE d.published_revision IS NOT NULL
     ORDER BY v.sort_order, v.title`,
  );
  return json({ documents: result.rows.map(mapDocument) });
}

async function adminList(request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);
  const [documents, versions] = await Promise.all([
    database.query("SELECT * FROM legal_documents ORDER BY sort_order, title"),
    database.query(
      `SELECT id, document_id, revision, title, footer_label, body, status,
              show_in_footer, sort_order, created_at
       FROM legal_document_versions
       ORDER BY document_id, revision DESC`,
    ),
  ]);
  const history = new Map();
  for (const row of versions.rows) {
    const items = history.get(row.document_id) ?? [];
    if (items.length < 20) items.push({
      id: row.id,
      revision: row.revision,
      title: row.title,
      footerLabel: row.footer_label,
      body: row.body,
      status: row.status,
      showInFooter: row.show_in_footer,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    });
    history.set(row.document_id, items);
  }
  return json({ documents: documents.rows.map((row) => ({ ...mapDocument(row), versions: history.get(row.id) ?? [] })) });
}

async function createDocument(request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const input = await requestBody(request);
  const value = normalize(input, { requireSlug: true });
  if (!value) return json({ error: "invalid_document" }, 400);
  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);
  const id = randomUUID();
  const versionId = randomUUID();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      `INSERT INTO legal_documents
        (id, slug, title, footer_label, body, status, show_in_footer, sort_order, is_system, revision)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, false, 1)
       RETURNING *`,
      [id, value.slug, value.title, value.footerLabel, value.body, value.showInFooter, value.sortOrder],
    );
    await client.query(
      `INSERT INTO legal_document_versions
        (id, document_id, revision, title, footer_label, body, status, show_in_footer, sort_order)
       VALUES ($1, $2, 1, $3, $4, $5, 'draft', $6, $7)`,
      [versionId, id, value.title, value.footerLabel, value.body, value.showInFooter, value.sortOrder],
    );
    await client.query("COMMIT");
    return json({ document: mapDocument(created.rows[0]) }, 201);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") return json({ error: "slug_exists" }, 409);
    throw error;
  } finally {
    client.release();
  }
}

async function updateDocument(request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const input = await requestBody(request);
  if (!validUuid(input.id)) return json({ error: "invalid_document" }, 400);
  const value = normalize(input);
  if (!value || !["save", "publish"].includes(input.action)) return json({ error: "invalid_document" }, 400);
  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM legal_documents WHERE id = $1 FOR UPDATE", [input.id]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "not_found" }, 404);
    }
    const revision = current.rows[0].revision + 1;
    const status = input.action === "publish" ? "published" : "draft";
    const updated = await client.query(
      `UPDATE legal_documents
       SET title = $2, footer_label = $3, body = $4, status = $5,
           show_in_footer = $6, sort_order = $7, revision = $8,
           published_revision = CASE WHEN $5 = 'published' THEN $8 ELSE published_revision END,
           published_at = CASE WHEN $5 = 'published' THEN now() ELSE published_at END,
           updated_at = now()
       WHERE id = $1 RETURNING *`,
      [input.id, value.title, value.footerLabel, value.body, status, value.showInFooter, value.sortOrder, revision],
    );
    await client.query(
      `INSERT INTO legal_document_versions
        (id, document_id, revision, title, footer_label, body, status, show_in_footer, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), input.id, revision, value.title, value.footerLabel, value.body, status, value.showInFooter, value.sortOrder],
    );
    await client.query("COMMIT");
    return json({ document: mapDocument(updated.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function restoreDocument(request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const input = await requestBody(request);
  if (!validUuid(input.documentId) || !Number.isInteger(input.revision) || input.revision < 1) return json({ error: "invalid_version" }, 400);
  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM legal_documents WHERE id = $1 FOR UPDATE", [input.documentId]);
    const version = await client.query(
      "SELECT * FROM legal_document_versions WHERE document_id = $1 AND revision = $2",
      [input.documentId, input.revision],
    );
    if (!current.rows[0] || !version.rows[0]) {
      await client.query("ROLLBACK");
      return json({ error: "not_found" }, 404);
    }
    const revision = current.rows[0].revision + 1;
    const source = version.rows[0];
    const updated = await client.query(
      `UPDATE legal_documents
       SET title = $2, footer_label = $3, body = $4, status = 'draft',
           show_in_footer = $5, sort_order = $6, revision = $7, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [input.documentId, source.title, source.footer_label, source.body, source.show_in_footer, source.sort_order, revision],
    );
    await client.query(
      `INSERT INTO legal_document_versions
        (id, document_id, revision, title, footer_label, body, status, show_in_footer, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8)`,
      [randomUUID(), input.documentId, revision, source.title, source.footer_label, source.body, source.show_in_footer, source.sort_order],
    );
    await client.query("COMMIT");
    return json({ document: mapDocument(updated.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function deleteDocument(request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const input = await requestBody(request);
  if (!validUuid(input.id)) return json({ error: "invalid_document" }, 400);
  const database = getDatabasePool();
  if (!database) return json({ error: "service_unavailable" }, 503);
  const result = await database.query(
    "DELETE FROM legal_documents WHERE id = $1 AND is_system = false RETURNING id",
    [input.id],
  );
  if (!result.rows[0]) return json({ error: "protected_or_missing" }, 409);
  return json({ deleted: true });
}

export async function routeLegalDocuments(request) {
  const { pathname } = new URL(request.url);
  const route = `${request.method} ${pathname}`;
  if (route === "GET /api/legal-documents") return publicList();
  if (route === "GET /api/consultant/legal-documents") return adminList(request);
  if (route === "POST /api/consultant/legal-documents") return createDocument(request);
  if (route === "PATCH /api/consultant/legal-documents") return updateDocument(request);
  if (route === "DELETE /api/consultant/legal-documents") return deleteDocument(request);
  if (route === "POST /api/consultant/legal-documents/restore") return restoreDocument(request);
  return null;
}
