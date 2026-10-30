import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import { PostgresWorkflowRepository, type CreateRequestInput } from '../src/postgres-workflows.ts';
import { ActionError, type Identity } from '../src/service.ts';

test('request creation rereads the exact active verified identity before writing, including replay', async () => {
  const engine = new PGlite();
  const pool = new pg.Pool({ ...createPgConfig(engine), max: 1 });
  const actor: Identity = { actorKey: 'OWNER-REVIEW', role: 'process_quality', verifiedEmail: 'owner@example.test',
    issuer: 'https://review.example.test', subject: 'owner' };
  const input: CreateRequestInput = {
    id: 'REQ-REVIEW', requesterName: 'Synthetic review', reason: 'new_training', deadlineDate: '2026-11-20',
    sessions: [{ sessionId: 'SES-REVIEW' }],
    cases: [{ caseId: 'CASE-REVIEW', sessionId: 'SES-REVIEW', participantKey: 'PERSON-REVIEW', trainerKey: 'TRAINER-REVIEW', ownerKey: actor.actorKey }],
  };
  const denied = (error: unknown) => error instanceof ActionError && error.status === 403;
  try {
    await runMigrations(pool);
    const repository = new PostgresWorkflowRepository(pool);
    // The caller may have been authenticated earlier; that object cannot grant a new write after revocation.
    await assert.rejects(repository.createRequest(input, actor), denied);
    await pool.query(`INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role, active)
      VALUES ($1, $2, $3, true, $4, $5, false), ($1 || '/alternate', 'other-owner-subject', $3, true, $4, $5, true)`,
      [actor.issuer, actor.subject, actor.verifiedEmail, actor.actorKey, actor.role]);
    await assert.rejects(repository.createRequest(input, actor), denied);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM workflow_requests')).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count, 0);
    await pool.query('UPDATE verified_identities SET active = true WHERE issuer = $1 AND subject = $2', [actor.issuer, actor.subject]);
    assert.equal((await repository.createRequest(input, actor)).replayed, false);
    await pool.query('UPDATE verified_identities SET active = false WHERE issuer = $1 AND subject = $2', [actor.issuer, actor.subject]);
    await assert.rejects(repository.createRequest(input, actor), denied);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count, 1);
  } finally { await pool.end(); await engine.close(); }
});
