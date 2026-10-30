import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import { PostgresWorkflowRepository } from '../src/postgres-workflows.ts';
import { HostedParticipantLinks } from '../src/participant-links.ts';
import { ParticipantResponses } from '../src/participant-responses.ts';
import { ActionError, type Identity } from '../src/service.ts';

test('a new hosted response requires the assessed stage; an exact receipt replay cannot regress later progress', async () => {
  const engine = new PGlite(), pool = new pg.Pool({ ...createPgConfig(engine), max: 1 });
  const owner: Identity = { actorKey: 'OWNER-STATE', role: 'process_quality', verifiedEmail: 'owner@example.test', issuer: 'https://state.example.test', subject: 'owner' };
  const participant: Identity = { actorKey: 'PERSON-STATE', role: 'assigned_participant', verifiedEmail: 'person@example.test', issuer: owner.issuer, subject: 'person' };
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role)
      VALUES ($1, $2, $3, true, $4, $5)`, [owner.issuer, owner.subject, owner.verifiedEmail, owner.actorKey, owner.role]);
    await new PostgresWorkflowRepository(pool).createRequest({ id: 'REQ-STATE', requesterName: 'Synthetic state review', reason: 'new_training', deadlineDate: '2026-11-20',
      sessions: [{ sessionId: 'SES-STATE' }], cases: [{ caseId: 'CASE-STATE', sessionId: 'SES-STATE', participantKey: participant.actorKey,
        participantEmail: participant.verifiedEmail, trainerKey: 'TRAINER-STATE', ownerKey: owner.actorKey }] }, owner);
    const assignment = await pool.query("SELECT assignment_id FROM workflow_assignments WHERE case_id = 'CASE-STATE' AND role = 'assigned_participant'");
    const links = new HostedParticipantLinks(pool);
    const issued = await links.issue({ caseId: 'CASE-STATE', assignmentId: Number(assignment.rows[0].assignment_id), email: participant.verifiedEmail, expiresAt: new Date(Date.now() + 60000), createdBy: owner });
    await links.claim(issued.token, { issuer: participant.issuer!, subject: participant.subject!, email: participant.verifiedEmail, emailVerified: true });
    const responses = new ParticipantResponses(pool);
    const input = { caseId: 'CASE-STATE', idempotencyKey: 'state-response', answer: 'yes' as const, typedName: 'Synthetic Person' };
    const before = (await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count;
    for (const status of ['open', 'invited', 'acknowledged', 'proof_ready', 'archived_verified', 'complete']) {
      await pool.query("UPDATE workflow_cases SET status = $1, evidence_facts = '{\"trainerPass\":true}'::jsonb WHERE case_id = 'CASE-STATE'", [status]);
      await assert.rejects(responses.submit(input, participant), (error: unknown) => error instanceof ActionError && error.status === 409);
      assert.equal((await pool.query("SELECT status FROM workflow_cases WHERE case_id = 'CASE-STATE'")).rows[0].status, status);
    }
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM participant_responses')).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count, before);
    await pool.query("UPDATE workflow_cases SET status = 'assessed' WHERE case_id = 'CASE-STATE'");
    const receipt = await responses.submit(input, participant);
    await pool.query("UPDATE workflow_cases SET status = 'complete', revision = revision + 1 WHERE case_id = 'CASE-STATE'");
    const state = (await pool.query("SELECT status, revision::text FROM workflow_cases WHERE case_id = 'CASE-STATE'")).rows[0];
    const audits = (await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count;
    assert.deepEqual(await responses.submit(input, participant), { ...receipt, replayed: true });
    assert.deepEqual((await pool.query("SELECT status, revision::text FROM workflow_cases WHERE case_id = 'CASE-STATE'")).rows[0], state);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count, audits);
  } finally { await pool.end(); await engine.close(); }
});
