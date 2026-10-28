import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runMigrations, type SqlPool } from '../src/database.ts';

test('migration runner applies each checksum-tracked migration once', async () => {
  const applied = new Map<string, string>();
  const sqlCalls: string[] = [];
  const connection = {
    async query(sql: string, values: readonly unknown[] = []) {
      sqlCalls.push(sql);
      if (sql.startsWith('SELECT checksum_sha256')) {
        const checksum = applied.get(String(values[0]));
        return { rows: checksum ? [{ checksum_sha256: checksum }] : [], rowCount: checksum ? 1 : 0 } as never;
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        applied.set(String(values[0]), String(values[1]));
        return { rows: [], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    },
    release() {},
  };
  const pool = {
    async query(sql: string) { sqlCalls.push(sql); return { rows: [], rowCount: 0 } as never; },
    async connect() { return connection; }, async end() {},
  } as unknown as SqlPool;
  await runMigrations(pool);
  const appliedSqlCount = sqlCalls.filter(sql => sql.includes('CREATE TABLE workflow_requests') || sql.includes('CREATE TABLE participant_responses')).length;
  assert.equal(applied.size, 2);
  assert.equal(appliedSqlCount, 2);
  await runMigrations(pool);
  assert.equal(sqlCalls.filter(sql => sql.includes('CREATE TABLE workflow_requests') || sql.includes('CREATE TABLE participant_responses')).length, 2);
});
