import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export interface SqlExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}
export interface SqlConnection extends SqlExecutor { release(): void }
export interface SqlPool extends SqlExecutor { connect(): Promise<SqlConnection>; end(): Promise<void> }

export function createDatabasePool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX || 5), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export async function inTransaction<T>(pool: SqlPool, operation: (connection: SqlConnection) => Promise<T>): Promise<T> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const value = await operation(connection);
    await connection.query('COMMIT');
    return value;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export async function runMigrations(pool: SqlPool): Promise<void> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
  const files = (await readdir(directory)).filter(file => /^\d+_[a-z0-9_-]+\.sql$/.test(file)).sort();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id text PRIMARY KEY,
    checksum_sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const file of files) {
    const sql = await readFile(join(directory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    await inTransaction(pool, async connection => {
      const prior = await connection.query<{ checksum_sha256: string }>('SELECT checksum_sha256 FROM schema_migrations WHERE migration_id = $1', [file]);
      if (prior.rowCount) {
        if (prior.rows[0]!.checksum_sha256 !== checksum) throw new Error(`Applied migration changed: ${file}`);
        return;
      }
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (migration_id, checksum_sha256) VALUES ($1, $2)', [file, checksum]);
    });
  }
}
