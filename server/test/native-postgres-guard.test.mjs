import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertEmptyNativeSchema, resolveNativePostgresTarget } from '../scripts/native-postgres-guard.mjs';

const localUrl = 'postgresql://tester:secret@localhost/testdb';
const schemaCatalogs = [
  ['text_search_parsers', 'pg_ts_parser'],
  ['text_search_templates', 'pg_ts_template'],
  ['extended_statistics', 'pg_statistic_ext'],
  ['default_privileges', 'pg_default_acl'],
  ['publication_memberships', 'pg_publication_namespace'],
  ['active_database_event_triggers', 'pg_event_trigger'],
];
const emptyCatalogCounts = () => Object.fromEntries([
  'relations', 'routines', 'types', 'operators', 'operator_classes', 'operator_families', 'collations', 'conversions',
  'text_search_dictionaries', 'text_search_configurations', 'text_search_parsers', 'text_search_templates',
  'extended_statistics', 'extensions', 'default_privileges', 'publication_memberships', 'active_database_event_triggers',
].map(name => [name, '0']));

test('native PostgreSQL target requires a dedicated schema and pins its loopback host/search_path', () => {
  assert.deepEqual(resolveNativePostgresTarget(localUrl, 'cosanum_native_check_1'), {
    host: 'localhost', schemaName: 'cosanum_native_check_1', options: '-c search_path=cosanum_native_check_1',
  });
  assert.throws(() => resolveNativePostgresTarget(localUrl, 'public'), /dedicated empty schema/);
});

test('native PostgreSQL target rejects query-string routing and search_path overrides', () => {
  for (const override of ['host=remote.example', 'hostaddr=203.0.113.10', 'options=-c+search_path%3Dpublic', 'search_path=public']) {
    assert.throws(() => resolveNativePostgresTarget(`${localUrl}?${override}`, 'cosanum_native_check_1'), /must not override/);
  }
  assert.throws(() => resolveNativePostgresTarget('postgresql://tester@remote.example/testdb', 'cosanum_native_check_1'), /loopback/);
});

test('native PostgreSQL migration guard requires the sole current empty schema', async () => {
  const replies = [
    { rows: [{ current_schema: 'cosanum_native_check_1', schemas: ['cosanum_native_check_1'], search_path: 'cosanum_native_check_1' }] },
    { rows: [{ oid: 101, ...emptyCatalogCounts() }], rowCount: 1 },
  ];
  const pool = { async query() { return replies.shift(); } };
  await assertEmptyNativeSchema(pool, 'cosanum_native_check_1');

  for (const invalidPath of [
    { current_schema: 'public', schemas: ['public'], search_path: 'public' },
    { current_schema: 'cosanum_native_check_1', schemas: ['cosanum_native_check_1', 'public'], search_path: 'cosanum_native_check_1, public' },
  ]) {
    const mismatched = { async query() { return { rows: [invalidPath] }; } };
    await assert.rejects(assertEmptyNativeSchema(mismatched, 'cosanum_native_check_1'), /search_path/);
  }
  await assert.rejects(assertEmptyNativeSchema({ async query() {
    if (this.calls++ === 0) return { rows: [{ current_schema: 'cosanum_native_check_1', schemas: ['cosanum_native_check_1'], search_path: 'cosanum_native_check_1' }] };
    return { rows: [{ oid: 101, ...emptyCatalogCounts(), relations: '1' }], rowCount: 1 };
  }, calls: 0 }, 'cosanum_native_check_1'), /not empty/);
  await assert.rejects(assertEmptyNativeSchema({ async query() {
    if (this.calls++ === 0) return { rows: [{ current_schema: 'cosanum_native_missing', schemas: ['cosanum_native_missing'], search_path: 'cosanum_native_missing' }] };
    return { rows: [], rowCount: 0 };
  }, calls: 0 }, 'cosanum_native_missing'), /does not exist/);
});

test('native PostgreSQL guard covers text-search, statistic, ACL, and publication schema catalogs', async () => {
  for (const [field, catalog] of schemaCatalogs) {
    const queries = [];
    const pool = { async query(sql) {
      queries.push(sql);
      if (queries.length === 1) return { rows: [{ current_schema: 'cosanum_native_check_1', schemas: ['cosanum_native_check_1'], search_path: 'cosanum_native_check_1' }] };
      return { rows: [{ oid: 101, ...emptyCatalogCounts(), [field]: '1' }], rowCount: 1 };
    } };
    await assert.rejects(assertEmptyNativeSchema(pool, 'cosanum_native_check_1'), /not empty or isolated/);
    assert.match(queries[1], new RegExp(`FROM ${catalog}`));
  }
});
