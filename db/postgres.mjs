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
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS consultant_calculations (
        id uuid PRIMARY KEY,
        amount_kopecks integer NOT NULL CHECK (amount_kopecks > 0 AND amount_kopecks <= 100000000),
        note varchar(120) NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS consultant_calculations_created_idx
        ON consultant_calculations (created_at DESC)`,
    ],
  },
  {
    version: 3,
    statements: [
      `ALTER TABLE consultations
        DROP CONSTRAINT IF EXISTS consultations_status_check`,
      `ALTER TABLE consultations
        ADD CONSTRAINT consultations_status_check
        CHECK (status IN ('awaiting_payment', 'paid', 'question_submitted', 'answered', 'archived', 'closed', 'cancelled'))`,
      `ALTER TABLE consultations
        ADD COLUMN IF NOT EXISTS archived_at timestamptz`,
      `CREATE INDEX IF NOT EXISTS consultations_archive_idx
        ON consultations (status, archived_at DESC)`,
    ],
  },
  {
    version: 4,
    statements: [
      `ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_kopecks_check`,
      `ALTER TABLE payments ADD CONSTRAINT payments_amount_kopecks_check
        CHECK (amount_kopecks >= 100 AND amount_kopecks <= 100000000)`,
      `CREATE TABLE IF NOT EXISTS site_settings (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        consultation_price_kopecks integer NOT NULL
          CHECK (consultation_price_kopecks >= 100 AND consultation_price_kopecks <= 100000000),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `INSERT INTO site_settings (singleton, consultation_price_kopecks)
        VALUES (true, 10000) ON CONFLICT (singleton) DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS consultation_attachments (
        id uuid PRIMARY KEY,
        consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
        ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
        extension varchar(8) NOT NULL CHECK (extension IN ('pdf', 'doc', 'docx', 'jpg', 'png', 'webp')),
        mime_type varchar(100) NOT NULL,
        size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
        ciphertext bytea NOT NULL,
        encryption_iv bytea NOT NULL,
        authentication_tag bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (consultation_id, ordinal)
      )`,
      `CREATE INDEX IF NOT EXISTS consultation_attachments_consultation_idx
        ON consultation_attachments (consultation_id, ordinal)`,
    ],
  },
  {
    version: 5,
    statements: [
      `ALTER TABLE consultation_messages
        DROP CONSTRAINT IF EXISTS consultation_messages_author_check`,
      `ALTER TABLE consultation_messages
        ADD CONSTRAINT consultation_messages_author_check
        CHECK (author IN ('visitor', 'consultant', 'ai_draft'))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS consultation_ai_draft_unique
        ON consultation_messages (consultation_id) WHERE author = 'ai_draft'`,
    ],
  },
  {
    version: 6,
    statements: [
      `ALTER TABLE consultations ADD COLUMN IF NOT EXISTS tariff_code varchar(40)`,
      `ALTER TABLE consultations ADD COLUMN IF NOT EXISTS tariff_name varchar(80)`,
      `ALTER TABLE consultations ADD COLUMN IF NOT EXISTS tariff_amount_kopecks integer`,
      `ALTER TABLE consultations ADD COLUMN IF NOT EXISTS tariff_deadline_minutes integer`,
      `ALTER TABLE consultations DROP CONSTRAINT IF EXISTS consultations_tariff_amount_check`,
      `ALTER TABLE consultations ADD CONSTRAINT consultations_tariff_amount_check
        CHECK (tariff_amount_kopecks IS NULL OR tariff_amount_kopecks BETWEEN 100 AND 100000000)`,
      `ALTER TABLE consultations DROP CONSTRAINT IF EXISTS consultations_tariff_deadline_check`,
      `ALTER TABLE consultations ADD CONSTRAINT consultations_tariff_deadline_check
        CHECK (tariff_deadline_minutes IS NULL OR tariff_deadline_minutes BETWEEN 15 AND 10080)`,
    ],
  },
  {
    version: 7,
    statements: [
      `ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS urgent_tariff_available boolean NOT NULL DEFAULT true`,
    ],
  },
  {
    version: 8,
    statements: [
      `CREATE TABLE IF NOT EXISTS visitor_feedback (
        id uuid PRIMARY KEY,
        category varchar(16) NOT NULL CHECK (category IN ('review', 'suggestion')),
        status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'hidden')),
        ciphertext bytea NOT NULL,
        encryption_iv bytea NOT NULL,
        authentication_tag bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS visitor_feedback_status_idx
        ON visitor_feedback (status, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS visitor_daily_counts (
        visit_day date PRIMARY KEY,
        visit_count bigint NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
    ],
  },
  {
    version: 9,
    statements: [
      `ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS consultation_schedule jsonb NOT NULL DEFAULT
        '[{"day":"monday","enabled":true,"start":"09:00","end":"13:00"},{"day":"tuesday","enabled":true,"start":"09:00","end":"13:00"},{"day":"wednesday","enabled":true,"start":"09:00","end":"13:00"},{"day":"thursday","enabled":true,"start":"09:00","end":"13:00"},{"day":"friday","enabled":true,"start":"09:00","end":"13:00"},{"day":"saturday","enabled":false,"start":"09:00","end":"13:00"},{"day":"sunday","enabled":false,"start":"09:00","end":"13:00"}]'::jsonb`,
    ],
  },
  {
    version: 10,
    statements: [
      `ALTER TABLE consultations
        ADD COLUMN IF NOT EXISTS answer_opened_at timestamptz`,
      `CREATE INDEX IF NOT EXISTS consultations_answer_opened_idx
        ON consultations (answer_opened_at DESC) WHERE answer_opened_at IS NOT NULL`,
    ],
  },
  {
    version: 11,
    statements: [
      `ALTER TABLE consultations
        ADD COLUMN IF NOT EXISTS tariff_assessment jsonb NOT NULL DEFAULT '[]'::jsonb`,
      `ALTER TABLE consultations
        ADD COLUMN IF NOT EXISTS tariff_assessment_confirmed boolean NOT NULL DEFAULT false`,
    ],
  },
  {
    version: 12,
    statements: [
      `ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS purpose varchar(24) NOT NULL DEFAULT 'consultation'`,
      `ALTER TABLE payments
        DROP CONSTRAINT IF EXISTS payments_purpose_check`,
      `ALTER TABLE payments
        ADD CONSTRAINT payments_purpose_check
        CHECK (purpose IN ('consultation', 'tariff_upgrade'))`,
      `ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS confirmation_url text`,
      `ALTER TABLE consultations
        ADD COLUMN IF NOT EXISTS upgrade_status varchar(24)`,
      `ALTER TABLE consultations
        DROP CONSTRAINT IF EXISTS consultations_upgrade_status_check`,
      `ALTER TABLE consultations
        ADD CONSTRAINT consultations_upgrade_status_check
        CHECK (upgrade_status IS NULL OR upgrade_status IN ('requested', 'declined', 'awaiting_payment', 'completed'))`,
      `ALTER TABLE consultations
        ADD COLUMN IF NOT EXISTS upgrade_requested_at timestamptz`,
      `ALTER TABLE consultations
        ADD COLUMN IF NOT EXISTS upgrade_completed_at timestamptz`,
      `CREATE INDEX IF NOT EXISTS payments_upgrade_idx
        ON payments (consultation_id, created_at DESC) WHERE purpose = 'tariff_upgrade'`,
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

export function classifyDatabaseError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";

  if (code === "28P01") return "authentication_failed";
  if (code === "3D000") return "database_not_found";
  if (code === "42501") return "permission_denied";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host_not_found";
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ETIMEDOUT" || message.includes("timeout")) return "connection_timeout";
  if (
    code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
    code.includes("CERT") ||
    message.includes("certificate")
  ) {
    return "tls_verification_failed";
  }

  return "unknown_error";
}
