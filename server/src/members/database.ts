import type { SqlPool } from '../database.ts';

const memberRelations = new Set([
  'schema_migrations', 'member_browser_families', 'member_auth_challenges', 'member_sessions',
]);

/** Reject a mixed training database before any member migration or runtime use. */
export async function assertMemberSessionSchema(pool: SqlPool): Promise<void> {
  const path = await pool.query<{ schemas: string[]; effective: string[] }>(
    'SELECT pg_catalog.to_json(pg_catalog.current_schemas(false)) AS schemas, pg_catalog.to_json(pg_catalog.current_schemas(true)) AS effective',
  );
  const { schemas, effective } = path.rows[0]!;
  if (schemas.length !== 1 || schemas[0] === 'pg_catalog' || effective.some(name => name !== schemas[0] && name !== 'pg_catalog'))
    throw new Error('Member sessions require one exact effective application schema');
  const relations = await pool.query<{ name: string }>(`
    SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  `);
  if (relations.rows.some(row => !memberRelations.has(row.name)))
    throw new Error('Member sessions require a dedicated schema without training or unrelated relations');
  if (relations.rows.some(row => row.name === 'schema_migrations')) {
    const applied = await pool.query<{ migration_id: string }>('SELECT migration_id FROM schema_migrations');
    if (applied.rows.some(row => row.migration_id !== '004_member_sessions.sql'))
      throw new Error('Member sessions require a dedicated migration ledger');
  }
}
