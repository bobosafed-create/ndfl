import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

const requiredVariables = [
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
];

let pool;

const migrations = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS consultations (
        id uuid PRIMARY KEY,
        code_hash char(64) NOT NULL,
        browser_token_hash char(64) NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'awaiting_payment'
          CHECK (status IN ('awaiting_payment', 'paid', 'question_submitted', 'answered', 'closed', 'cancelled')),
        answer_due_at timestamptz,
        expires_at timestamptz NOT NULL,
        failed_access_attempts integer NOT NULL DEFAULT 0 CHECK (failed_access_attempts >= 0),
        access_locked_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS consultations_code_hash_idx
        ON consultations (code_hash)`,
      `CREATE INDEX IF NOT EXISTS consultations_status_idx
        ON consultations (status, answer_due_at)`,
      `CREATE TABLE IF NOT EXISTS payments (
        id uuid PRIMARY KEY,
        consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
        provider varchar(24) NOT NULL DEFAULT 'yookassa',
        provider_payment_id varchar(128) UNIQUE,
        idempotency_key uuid NOT NULL UNIQUE,
        amount_kopecks integer NOT NULL CHECK (amount_kopecks = 10000),
        currency char(3) NOT NULL DEFAULT 'RUB' CHECK (currency = 'RUB'),
        status varchar(24) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'waiting_for_capture', 'succeeded', 'cancelled', 'refunded')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS payments_consultation_idx
        ON payments (consultation_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS consultation_messages (
        id uuid PRIMARY KEY,
        consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
        author varchar(16) NOT NULL CHECK (author IN ('visitor', 'consultant')),
        ciphertext bytea NOT NULL,
        encryption_iv bytea NOT NULL,
        authentication_tag bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS consultation_messages_consultation_idx
        ON consultation_messages (consultation_id, created_at)`,
    ],
  },
];

function missingDatabaseVariables() {
  return requiredVariables.filter((name) => !process.env[name]);
}

function createPool() {
  if (missingDatabaseVariables().length > 0) return null;

  const certificatePath = process.env.PGSSLROOTCERT;
  if (!certificatePath) {
    throw new Error("PostgreSQL TLS certificate path is not configured");
  }

  const sslMode = process.env.PGSSLMODE ?? "verify-full";
  if (sslMode !== "verify-full") {
    throw new Error("PostgreSQL must use verify-full TLS mode");
  }

  const databasePool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: {
      ca: readFileSync(certificatePath, "utf8"),
      rejectUnauthorized: true,
    },
    application_name: "ndfl-prosto",
    connectionTimeoutMillis: 7000,
    idleTimeoutMillis: 30000,
    max: 5,
  });

  databasePool.on("error", () => {
    console.error("PostgreSQL pool reported an unexpected error");
  });

  return databasePool;
}

export function getDatabasePool() {
  if (pool === undefined) pool = createPool();
  return pool;
}

export async function initializeDatabase() {
  const databasePool = getDatabasePool();
  if (!databasePool) {
    console.log(
      `PostgreSQL configuration is missing: ${missingDatabaseVariables().join(", ")}`,
    );
    return { configured: false };
  }

  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [741032]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const appliedResult = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(appliedResult.rows.map((row) => row.version));

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.statements) {
        await client.query(statement);
      }
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [migration.version],
      );
    }

    await client.query("COMMIT");
    console.log("PostgreSQL connection and schema are ready");
    return { configured: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabase() {
  const databasePool = getDatabasePool();
  if (!databasePool) return { status: "not_configured" };

  try {
    await databasePool.query("SELECT 1");
    return { status: "ok" };
  } catch {
    return { status: "unavailable" };
  }
}
