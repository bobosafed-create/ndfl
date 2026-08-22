import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../db/postgres.mjs", import.meta.url), "utf8");

test("database schema stores consultation text only as authenticated ciphertext", () => {
  assert.match(source, /ciphertext bytea NOT NULL/);
  assert.match(source, /encryption_iv bytea NOT NULL/);
  assert.match(source, /authentication_tag bytea NOT NULL/);
  assert.doesNotMatch(source, /question_text|answer_text|question varchar|answer varchar/i);
});

test("database schema never stores the four-digit code itself", () => {
  assert.match(source, /code_hash char\(64\) NOT NULL/);
  assert.doesNotMatch(source, /access_code\s+(?:char|varchar|text|integer)/i);
  assert.match(source, /browser_token_hash char\(64\) NOT NULL/);
});

test("configuration diagnostics can reveal variable names but never values", () => {
  assert.match(source, /missingDatabaseVariables\(\)\.join/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*process\.env/);
});

test("connection diagnostics expose only a fixed safe error category", () => {
  assert.match(source, /return "authentication_failed"/);
  assert.match(source, /return "tls_verification_failed"/);
  assert.match(source, /return "unknown_error"/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*error\.message/);
});

test("consultant calculator entries are stored durably", () => {
  assert.match(source, /CREATE TABLE IF NOT EXISTS consultant_calculations/);
  assert.match(source, /amount_kopecks integer NOT NULL/);
  assert.match(source, /note varchar\(120\)/);
});
