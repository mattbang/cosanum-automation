import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import { NotificationIntents } from '../src/notification-intents.ts';
import { ActionError, type Identity } from '../src/service.ts';

test('failed-assessment notification intents are authorized, idempotent, private, stale-safe, and audited', async () => {
  const engine = new PGlite();
  const pool = new pg.Pool({ ...createPgConfig(engine), max: 1 });
  try {
    await runMigrations(pool);
    const ownerA: Identity = { actorKey: 'OWNER-A', role: 'process_quality', verifiedEmail: 'owner-a@example.test', issuer: 'https://issuer.test', subject: 'owner-a' };
    const ownerB: Identity = { actorKey: 'OWNER-B', role: 'process_quality', verifiedEmail: 'owner-b@example.test', issuer: 'https://issuer.test', subject: 'owner-b' };
    for (const owner of [ownerA, ownerB]) {
      await pool.query(
        `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role)
         VALUES ($1, $2, $3, true, $4, $5)`,
        [owner.issuer, owner.subject, owner.verifiedEmail, owner.actorKey, owner.role],
      );
    }
    await pool.query(`INSERT INTO workflow_requests (request_id, requester_name, reason, deadline_date)
      VALUES ('REQ-OUTBOX', 'Private requester name', 'retraining', '2026-11-20')`);
    await pool.query(`INSERT INTO workflow_sessions (session_id, request_id)
      VALUES ('SES-OUTBOX', 'REQ-OUTBOX')`);
    await pool.query(`INSERT INTO workflow_cases (case_id, request_id, session_id, participant_key, trainer_key, owner_key, status, evidence_facts)
      VALUES ('CASE-FAILED-A', 'REQ-OUTBOX', 'SES-OUTBOX', 'PERSON-PRIVATE-A', 'TRAINER-A', 'OWNER-A', 'assessed', '{"trainerPass":false}'),
             ('CASE-PASSED-B', 'REQ-OUTBOX', 'SES-OUTBOX', 'PERSON-PRIVATE-B', 'TRAINER-B', 'OWNER-B', 'assessed', '{"trainerPass":true}'),
             ('CASE-FAILED-C', 'REQ-OUTBOX', 'SES-OUTBOX', 'PERSON-PRIVATE-C', 'TRAINER-A', 'OWNER-A', 'assessed', '{"trainerPass":false}')`);
    await pool.query(`INSERT INTO workflow_assignments (case_id, role, actor_key)
      SELECT case_id, 'process_quality', owner_key FROM workflow_cases`);
    const intents = new NotificationIntents(pool);

    await assert.rejects(intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-A', expectedRevision: '0' }, ownerA),
      (error: unknown) => error instanceof ActionError && error.status === 400);
    await assert.rejects(intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-A', expectedRevision: '1' }, ownerB),
      (error: unknown) => error instanceof ActionError && error.status === 403);
    await assert.rejects(intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-A', expectedRevision: '1' }, { ...ownerA, role: 'assigned_trainer' }),
      (error: unknown) => error instanceof ActionError && error.status === 403);
    const passed = await intents.reconcileFailedAssessment({ caseId: 'CASE-PASSED-B', expectedRevision: '1' }, ownerB);
    assert.equal(passed.status, 'not_eligible');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM notification_intents')).rows[0]!.count, 0);

    const created = await intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-A', expectedRevision: '1' }, ownerA);
    assert.equal(created.status, 'pending');
    assert.equal(created.replayed, false);
    assert.equal(created.semanticKey, 'failed_assessment:CASE-FAILED-A:1:OWNER-A');
    const replay = await intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-A', expectedRevision: '1' }, ownerA);
    assert.deepEqual(replay, { ...created, replayed: true });
    const stored = await pool.query<{ recipient_role: string; recipient_actor_key: string; payload: Record<string, unknown>; status: string }>(
      'SELECT recipient_role, recipient_actor_key, payload, status FROM notification_intents WHERE case_id = $1', ['CASE-FAILED-A'],
    );
    assert.deepEqual(stored.rows, [{
      recipient_role: 'process_quality', recipient_actor_key: 'OWNER-A',
      payload: { templateKey: 'exception_notice', reasonCode: 'trainer_failed' }, status: 'pending',
    }]);
    const safePayload = JSON.stringify(stored.rows[0]!.payload);
    for (const privateValue of ['Private requester name', 'PERSON-PRIVATE-A', 'owner-a@example.test', 'TRAINER-A'])
      assert.equal(safePayload.includes(privateValue), false);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE operation = 'notification.intent.create'")).rows[0]!.count, 1);

    await assert.rejects(intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-A', expectedRevision: '2' }, ownerA),
      (error: unknown) => error instanceof ActionError && error.status === 409);
    assert.equal((await pool.query('SELECT status FROM notification_intents WHERE case_id = $1', ['CASE-FAILED-A'])).rows[0]!.status, 'pending');
    await pool.query("UPDATE workflow_cases SET status = 'acknowledged', revision = 2 WHERE case_id = 'CASE-FAILED-A'");
    const stale = await intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-A', expectedRevision: '2' }, ownerA);
    assert.deepEqual(stale, { status: 'not_eligible', sourceRevision: '2', replayed: false, cancelledCount: 1 });
    assert.equal((await pool.query('SELECT status, cancel_reason FROM notification_intents WHERE case_id = $1', ['CASE-FAILED-A'])).rows[0]!.status, 'cancelled');
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE operation = 'notification.intent.cancel'")).rows[0]!.count, 1);
    const repeatAfterCancel = await intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-A', expectedRevision: '2' }, ownerA);
    assert.equal(repeatAfterCancel.status, 'not_eligible');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM notification_intents WHERE case_id = $1', ['CASE-FAILED-A'])).rows[0]!.count, 1);

    await pool.query("ALTER TABLE audit_events ADD CONSTRAINT notification_intent_rollback_probe CHECK (operation <> 'notification.intent.create') NOT VALID");
    await assert.rejects(intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-C', expectedRevision: '1' }, ownerA));
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM notification_intents WHERE case_id = $1', ['CASE-FAILED-C'])).rows[0]!.count, 0);
    await pool.query('ALTER TABLE audit_events DROP CONSTRAINT notification_intent_rollback_probe');
    const recovered = await intents.reconcileFailedAssessment({ caseId: 'CASE-FAILED-C', expectedRevision: '1' }, ownerA);
    assert.equal(recovered.status, 'pending');
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE operation = 'notification.intent.create'")).rows[0]!.count, 2);
  } finally {
    await pool.end();
    await engine.close();
  }
});
