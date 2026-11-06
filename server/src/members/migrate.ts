import { createDatabasePool, runMigrations, verifyMigrations } from '../database.ts';
import { assertMemberSessionSchema } from './database.ts';

const pool = createDatabasePool();
try {
  await assertMemberSessionSchema(pool);
  await runMigrations(pool, ['004_member_sessions.sql']);
  await verifyMigrations(pool, ['004_member_sessions.sql']);
  console.log('Member session migration verified; training schemas and records were not changed.');
} finally { await pool.end(); }
