import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import { HostedParticipantLinks, ParticipantLinkError } from '../src/participant-links.ts';
import { PostgresWorkflowGateway } from '../src/postgres-gateway.ts';
import { PostgresWorkflowRepository } from '../src/postgres-workflows.ts';
import { ParticipantResponses } from '../src/participant-responses.ts';
import { ActionError, type Identity } from '../src/service.ts';

test('PostgreSQL integration: migration, group booking, case history, link binding, and rollback', async () => {
  const engine = new PGlite();
  const pool = new pg.Pool({ ...createPgConfig(engine), max: 1 });
  try {
    await runMigrations(pool);
    await runMigrations(pool);
    const migrationRows = await pool.query('SELECT count(*)::int AS count FROM schema_migrations');
    assert.equal(migrationRows.rows[0].count, 2);

    const owner: Identity = {
      actorKey: 'OWNER-1', role: 'process_quality', verifiedEmail: 'owner@example.test',
      issuer: 'https://issuer.example.test', subject: 'owner-subject',
    };
    await pool.query(
      `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role)
       VALUES ($1, $2, $3, true, $4, $5)`,
      [owner.issuer, owner.subject, owner.verifiedEmail, owner.actorKey, owner.role],
    );
    await pool.query(
      `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role)
       VALUES ($1, $2, $3, true, $4, $5)`,
      ['https://other-issuer.example.test', 'owner-alt-subject', owner.verifiedEmail, owner.actorKey, owner.role],
    );
    const trainer: Identity = {
      actorKey: 'TRAINER-2', role: 'assigned_trainer', verifiedEmail: 'trainer2@example.test',
      issuer: 'https://issuer.example.test', subject: 'trainer-2-subject',
    };
    await pool.query(
      `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role)
       VALUES ($1, $2, $3, true, $4, $5)`,
      [trainer.issuer, trainer.subject, trainer.verifiedEmail, trainer.actorKey, trainer.role],
    );
    const repository = new PostgresWorkflowRepository(pool);
    const request = {
      id: 'REQ-PGLITE', requesterName: 'Synthetic requester', sourceTeam: 'Operations', reason: 'new_training' as const,
      deadlineDate: '2026-11-20',
      sessions: [{ sessionId: 'SES-PGLITE', attributes: { topicId: 'TOPIC-1' } }],
      cases: [
        { caseId: 'CASE-PGLITE-1', sessionId: 'SES-PGLITE', participantKey: 'PERSON-1', participantEmail: 'person@example.test', trainerKey: 'TRAINER-1', ownerKey: owner.actorKey, attributes: { targetLevel: 2 } },
        { caseId: 'CASE-PGLITE-2', sessionId: 'SES-PGLITE', participantKey: 'PERSON-2', participantEmail: 'person2@example.test', trainerKey: 'TRAINER-2', ownerKey: owner.actorKey, attributes: { targetLevel: 3 } },
      ],
    };
    assert.equal((await repository.createRequest(request, owner)).replayed, false);
    assert.equal((await repository.createRequest(request, owner)).replayed, true);

    const links = new HostedParticipantLinks(pool);
    const assignment = await pool.query<{ assignment_id: string }>(
      `SELECT assignment_id FROM workflow_assignments WHERE case_id = $1 AND role = 'assigned_participant'`, ['CASE-PGLITE-1'],
    );
    const assignmentId = Number(assignment.rows[0]!.assignment_id);
    const expiry = new Date(Date.now() + 60_000);
    const firstLink = await links.issue({ caseId: 'CASE-PGLITE-1', assignmentId, email: 'person@example.test', expiresAt: expiry, createdBy: owner });
    const secondLink = await links.issue({ caseId: 'CASE-PGLITE-1', assignmentId, email: 'person@example.test', expiresAt: expiry, createdBy: owner });
    const secondLinkRow = await pool.query<{ link_id: string }>(
      'SELECT link_id FROM hosted_participant_links WHERE token_hash = $1', [createHash('sha256').update(secondLink.token).digest()],
    );
    const ownerAssignment = await pool.query<{ assignment_id: string }>(
      `SELECT assignment_id FROM workflow_assignments WHERE case_id = $1 AND role = 'process_quality'`, ['CASE-PGLITE-1'],
    );
    await pool.query('UPDATE workflow_assignments SET active = false, revoked_at = now() WHERE assignment_id = $1', [ownerAssignment.rows[0]!.assignment_id]);
    await assert.rejects(links.issue({ caseId: 'CASE-PGLITE-1', assignmentId, email: 'person@example.test', expiresAt: expiry, createdBy: owner }),
      (error: unknown) => error instanceof ParticipantLinkError && error.status === 409);
    await pool.query('UPDATE workflow_assignments SET active = true, revoked_at = NULL WHERE assignment_id = $1', [ownerAssignment.rows[0]!.assignment_id]);
    await pool.query('UPDATE verified_identities SET active = false WHERE issuer = $1 AND subject = $2', [owner.issuer, owner.subject]);
    assert.equal(await links.revoke(secondLinkRow.rows[0]!.link_id, owner), false);
    await assert.rejects(links.issue({ caseId: 'CASE-PGLITE-1', assignmentId, email: 'person@example.test', expiresAt: expiry, createdBy: owner }),
      (error: unknown) => error instanceof ParticipantLinkError && error.status === 409);
    await pool.query('UPDATE verified_identities SET active = true WHERE issuer = $1 AND subject = $2', [owner.issuer, owner.subject]);
    const hashRows = await pool.query<{ token_hash: Buffer }>(
      'SELECT token_hash FROM hosted_participant_links WHERE case_id = $1 ORDER BY created_at, link_id', ['CASE-PGLITE-1'],
    );
    const firstHash = createHash('sha256').update(firstLink.token).digest();
    assert.ok(hashRows.rows.every(row => !Buffer.from(row.token_hash).equals(Buffer.from(firstLink.token))));
    assert.ok(hashRows.rows.some(row => Buffer.from(row.token_hash).equals(firstHash)));
    await links.claim(firstLink.token, { issuer: owner.issuer!, subject: 'participant-subject-1', email: 'person@example.test', emailVerified: true });
    await assert.rejects(links.claim(secondLink.token, {
      issuer: owner.issuer!, subject: 'participant-subject-2', email: 'person@example.test', emailVerified: true,
    }), (error: unknown) => error instanceof ParticipantLinkError && error.status === 403);
    assert.equal(await links.revoke(secondLinkRow.rows[0]!.link_id, owner), true);
    await assert.rejects(links.claim(secondLink.token, {
      issuer: owner.issuer!, subject: 'participant-subject-1', email: 'person@example.test', emailVerified: true,
    }), (error: unknown) => error instanceof ParticipantLinkError && error.status === 401);

    const participant: Identity = {
      actorKey: 'PERSON-1', role: 'assigned_participant', verifiedEmail: 'person@example.test',
      issuer: owner.issuer, subject: 'participant-subject-1',
    };
    await pool.query("UPDATE workflow_cases SET evidence_facts = evidence_facts || '{\"trainerPass\":true}'::jsonb WHERE case_id = $1", ['CASE-PGLITE-1']);
    const responses = new ParticipantResponses(pool);
    const wrongAccount = { ...participant, subject: 'wrong-participant-subject' };
    await assert.rejects(responses.submit({ caseId: 'CASE-PGLITE-1', idempotencyKey: 'wrong-account', answer: 'yes', typedName: 'Other Person' }, wrongAccount),
      (error: unknown) => error instanceof ActionError && error.status === 403);

    const participant2: Identity = {
      actorKey: 'PERSON-2', role: 'assigned_participant', verifiedEmail: 'person2@example.test',
      issuer: owner.issuer, subject: 'participant-subject-2',
    };
    await pool.query("UPDATE workflow_cases SET evidence_facts = evidence_facts || '{\"trainerPass\":true}'::jsonb WHERE case_id = $1", ['CASE-PGLITE-2']);
    const assignment2 = await pool.query<{ assignment_id: string }>(
      "SELECT assignment_id FROM workflow_assignments WHERE case_id = 'CASE-PGLITE-2' AND role = 'assigned_participant'",
    );
    const expiredLink = await links.issue({ caseId: 'CASE-PGLITE-2', assignmentId: Number(assignment2.rows[0]!.assignment_id),
      email: participant2.verifiedEmail, expiresAt: expiry, createdBy: owner });
    await links.claim(expiredLink.token, { issuer: participant2.issuer!, subject: participant2.subject!, email: participant2.verifiedEmail, emailVerified: true });
    await pool.query("UPDATE hosted_participant_links SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
      [createHash('sha256').update(expiredLink.token).digest()]);
    await assert.rejects(responses.submit({ caseId: 'CASE-PGLITE-2', idempotencyKey: 'expired-link', answer: 'yes', typedName: 'Participant Two' }, participant2),
      (error: unknown) => error instanceof ActionError && error.status === 403);
    const revokedLink = await links.issue({ caseId: 'CASE-PGLITE-2', assignmentId: Number(assignment2.rows[0]!.assignment_id),
      email: participant2.verifiedEmail, expiresAt: expiry, createdBy: owner });
    await links.claim(revokedLink.token, { issuer: participant2.issuer!, subject: participant2.subject!, email: participant2.verifiedEmail, emailVerified: true });
    await pool.query('UPDATE hosted_participant_links SET revoked_at = now() WHERE token_hash = $1',
      [createHash('sha256').update(revokedLink.token).digest()]);
    await assert.rejects(responses.submit({ caseId: 'CASE-PGLITE-2', idempotencyKey: 'revoked-link', answer: 'yes', typedName: 'Participant Two' }, participant2),
      (error: unknown) => error instanceof ActionError && error.status === 403);

    const responseKeys = ['participant-response-1', 'participant-response-racer-2'];
    const competing = await Promise.allSettled(responseKeys.map(idempotencyKey => responses.submit({
      caseId: 'CASE-PGLITE-1', idempotencyKey, answer: 'yes', typedName: 'Participant One',
    }, participant)));
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    const winnerIndex = competing.findIndex(result => result.status === 'fulfilled');
    const response = (competing[winnerIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof responses.submit>>>).value;
    assert.equal(competing.filter(result => result.status === 'rejected' && result.reason instanceof ActionError && result.reason.status === 409).length, 1);
    const responseInput = { caseId: 'CASE-PGLITE-1', idempotencyKey: responseKeys[winnerIndex]!, answer: 'yes' as const, typedName: 'Participant One' };
    assert.equal(response.status, 'verified');
    assert.equal(response.actionId, 'acceptParticipantAcknowledgement');
    assert.equal(response.revision, '2');
    assert.equal(response.replayed, false);
    assert.deepEqual(await responses.submit(responseInput, participant), { ...response, replayed: true });
    await assert.rejects(responses.submit({ ...responseInput, idempotencyKey: 'participant-response-2' }, participant),
      (error: unknown) => error instanceof ActionError && error.status === 409);
    const savedResponse = await pool.query<{ actor_key: string; typed_name: string; answer: string; source_type: string; revision: string }>(
      'SELECT actor_key, typed_name, answer, source_type, revision::text AS revision FROM participant_responses WHERE response_id = $1', [response.responseId],
    );
    assert.deepEqual(savedResponse.rows[0], {
      actor_key: 'PERSON-1', typed_name: 'Participant One', answer: 'yes', source_type: 'hosted_participant_response', revision: '2',
    });
    const participantHistory = await pool.query<{ event_count: number; audit_count: number; evidence_count: number; status: string; revision: string }>(
      `SELECT (SELECT count(*)::int FROM workflow_events WHERE event_id = (SELECT event_id FROM participant_responses WHERE response_id = $1)) AS event_count,
              (SELECT count(*)::int FROM audit_events WHERE event_id = (SELECT event_id FROM participant_responses WHERE response_id = $1)) AS audit_count,
              (SELECT count(*)::int FROM case_evidence WHERE case_id = 'CASE-PGLITE-1' AND source_id = $1::text) AS evidence_count,
              c.status, c.revision::text AS revision
         FROM workflow_cases c WHERE c.case_id = 'CASE-PGLITE-1'`, [response.responseId],
    );
    assert.deepEqual(participantHistory.rows[0], { event_count: 1, audit_count: 1, evidence_count: 3, status: 'acknowledged', revision: '2' });

    let executorCalls = 0;
    const gateway = new PostgresWorkflowGateway(pool, { async execute({ sessionCases }) {
      executorCalls++;
      const eventId = 'EVENT-PGLITE-1';
      return {
        facts: { eventVerified: true, receiptSaved: true, calendarError: false, slotConflict: false, changedEvent: false },
        caseStatus: 'invited', state: { calendarEventId: eventId },
        session: { status: 'invited', calendarEventId: eventId },
        relatedCaseUpdates: sessionCases.filter(item => item.scope.caseId !== 'CASE-PGLITE-1').map(item => ({
          caseId: item.scope.caseId, status: 'invited', state: { calendarEventId: eventId },
          facts: { eventVerified: true, receiptSaved: true, calendarError: false, slotConflict: false, changedEvent: false },
        })),
      };
    } });
    const snapshot = await gateway.load('CASE-PGLITE-1');
    assert.ok(snapshot);
    const race = await Promise.allSettled([
      gateway.execute('bookSession', snapshot, {}, owner, 'booking-pglite-race-a'),
      gateway.execute('bookSession', snapshot, {}, owner, 'booking-pglite-race-b'),
    ]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = race.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof ActionError && rejected.reason.status === 409);
    assert.equal(executorCalls, 1);
    const casesAfterBooking = await pool.query<{ case_id: string; status: string; revision: string; event_id: string }>(
      `SELECT c.case_id, c.status, c.revision::text AS revision, c.state->>'calendarEventId' AS event_id
         FROM workflow_cases c WHERE c.request_id = $1 ORDER BY c.case_id`, ['REQ-PGLITE'],
    );
    assert.equal(casesAfterBooking.rows.length, 2);
    assert.ok(casesAfterBooking.rows.every(row => row.status === 'invited' && row.event_id === 'EVENT-PGLITE-1'));
    assert.equal(casesAfterBooking.rows.find(row => row.case_id === 'CASE-PGLITE-1')?.revision, '3');
    assert.equal(casesAfterBooking.rows.find(row => row.case_id === 'CASE-PGLITE-2')?.revision, '2');
    const session = await pool.query<{ status: string; calendar_event_id: string; revision: string }>(
      'SELECT status, calendar_event_id, revision::text AS revision FROM workflow_sessions WHERE session_id = $1', ['SES-PGLITE'],
    );
    assert.deepEqual(session.rows[0], { status: 'invited', calendar_event_id: 'EVENT-PGLITE-1', revision: '2' });
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM workflow_events WHERE request_id = $1', ['REQ-PGLITE'])).rows[0].count, 3);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_events WHERE request_id = $1', ['REQ-PGLITE'])).rows[0].count, 4);
    const evidence = await pool.query<{ case_id: string; facts: string[]; count: number }>(
      `SELECT case_id, array_agg(fact_key ORDER BY fact_key) AS facts, count(*)::int AS count
         FROM case_evidence WHERE case_id IN ($1, $2) GROUP BY case_id ORDER BY case_id`,
      ['CASE-PGLITE-1', 'CASE-PGLITE-2'],
    );
    assert.equal(evidence.rows.length, 2);
    assert.equal(evidence.rows.find(row => row.case_id === 'CASE-PGLITE-1')?.count, 8);
    assert.equal(evidence.rows.find(row => row.case_id === 'CASE-PGLITE-2')?.count, 5);
    assert.ok(evidence.rows.every(row => row.facts.includes('eventVerified') && row.facts.includes('receiptSaved')));
    const latest = await gateway.load('CASE-PGLITE-1');
    await assert.rejects(gateway.execute('bookSession', latest!, {}, owner, 'booking-pglite-2'),
      (error: unknown) => error instanceof ActionError && error.status === 409);

    await pool.query("ALTER TABLE case_evidence ADD CONSTRAINT integration_rollback_probe CHECK (fact_key <> 'rollback_probe')");
    const beforeRollback = await pool.query('SELECT count(*)::int AS count FROM workflow_events');
    const beforeAudit = await pool.query('SELECT count(*)::int AS count FROM audit_events');
    const rollbackGateway = new PostgresWorkflowGateway(pool, { async execute() {
      return { facts: { rollback_probe: true } };
    } });
    const rollbackSnapshot = await rollbackGateway.load('CASE-PGLITE-2');
    await assert.rejects(rollbackGateway.execute('recordTrainerAssessment', rollbackSnapshot!, {}, trainer, 'booking-pglite-rollback'));
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM workflow_events')).rows[0].count, beforeRollback.rows[0].count);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_events')).rows[0].count, beforeAudit.rows[0].count);
    assert.equal((await pool.query('SELECT revision::text FROM workflow_cases WHERE case_id = $1', ['CASE-PGLITE-2'])).rows[0].revision, '2');
  } finally {
    await pool.end();
    await engine.close();
  }
});
