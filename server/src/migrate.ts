import { createDatabasePool, runMigrations } from './database.ts';

const pool = createDatabasePool();
try {
  await runMigrations(pool);
  console.log('Database migrations are current.');
} finally {
  await pool.end();
}
