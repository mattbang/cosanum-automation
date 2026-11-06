import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import { assertMemberSessionSchema } from '../src/members/database.ts';

async function database() {
  const db = new PGlite(), pool = new pg.Pool({ ...createPgConfig(db), max: 1 });
  return { pool, async close() { await pool.end(); await db.close(); } };
}

test('member target accepts an empty schema and its auth-only migration', async () => {
  const { pool, close } = await database();
  try {
    await assertMemberSessionSchema(pool);
    await runMigrations(pool, ['004_member_sessions.sql']);
    await assertMemberSessionSchema(pool);
    assert.equal((await pool.query("SELECT to_regclass('workflow_cases') AS cases")).rows[0]?.cases, null);
  } finally { await close(); }
});

test('member target rejects an existing workflow schema without changing it', async () => {
  const { pool, close } = await database();
  try {
    await runMigrations(pool);
    await assert.rejects(assertMemberSessionSchema(pool), /dedicated schema/);
    assert.equal((await pool.query('SELECT migration_id FROM schema_migrations')).rows.length, 4);
    assert.equal((await pool.query("SELECT to_regclass('workflow_cases') AS cases")).rows[0]?.cases, 'workflow_cases');
  } finally { await close(); }
});

test('member target rejects an unrelated relation and an unrelated migration ledger', async () => {
  const { pool, close } = await database();
  try {
    await pool.query('CREATE VIEW unrelated AS SELECT 1 AS value');
    await assert.rejects(assertMemberSessionSchema(pool), /dedicated schema/);
    await pool.query('DROP VIEW unrelated');
    await runMigrations(pool, ['004_member_sessions.sql']);
    await pool.query("INSERT INTO schema_migrations (migration_id, checksum_sha256) VALUES ('001_backend_foundation.sql', 'synthetic-checksum')");
    await assert.rejects(assertMemberSessionSchema(pool), /dedicated migration ledger/);
  } finally { await close(); }
});

test('member target rejects search-path fallback to a mixed legacy schema', async () => {
  const { pool, close } = await database();
  try {
    await runMigrations(pool);
    await pool.query('CREATE SCHEMA member_empty');
    await pool.query('SET search_path = member_empty, public');
    await assert.rejects(assertMemberSessionSchema(pool), /one exact effective application schema/);
    assert.equal((await pool.query("SELECT 'member_sessions'::regclass::oid = 'public.member_sessions'::regclass::oid AS legacy")).rows[0]?.legacy, true);
  } finally { await close(); }
});
