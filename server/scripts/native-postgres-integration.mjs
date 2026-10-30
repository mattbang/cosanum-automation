import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import { HostedParticipantLinks, ParticipantLinkError } from '../src/participant-links.ts';
import { ParticipantResponses } from '../src/participant-responses.ts';
import { PostgresWorkflowGateway } from '../src/postgres-gateway.ts';
import { PostgresWorkflowRepository } from '../src/postgres-workflows.ts';
import { ActionError } from '../src/service.ts';
import { assertEmptyNativeSchema, resolveNativePostgresTarget } from './native-postgres-guard.mjs';

const connectionString = process.env.TEST_DATABASE_URL;
const { host, schemaName, options } = resolveNativePostgresTarget(connectionString, process.env.TEST_DATABASE_SCHEMA);

const pool = new pg.Pool({ connectionString, host, options, max: 8, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
const timeout = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let releasePendingExecutor = () => {};

async function waitForBlockedPid(blockingPid, operation, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query(
      `SELECT pid, pg_blocking_pids(pid) AS blockers
         FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    const waiter = blocked.rows.find(row => row.blockers.map(Number).includes(Number(blockingPid)));
    if (waiter) return Number(waiter.pid);
    if (operation.settled) throw new Error(`${label} did not wait on the pinned transaction lock`);
    await timeout(20);
  }
  throw new Error(`Timed out waiting for ${label} to block on backend ${blockingPid}`);
}

async function withPinnedTransaction(operation) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
    await client.query('BEGIN');
    return await operation(client, Number(rows[0].pid));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function trackPoolConnections() {
  const backendPids = [];
  return {
    backendPids,
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
      backendPids.push(Number(rows[0].pid));
      return client;
    },
    end: () => pool.end(),
  };
}

try {
  await assertEmptyNativeSchema(pool, schemaName);

  const { rows: versionRows } = await pool.query('SELECT version() AS version');
  console.log(`PostgreSQL: ${versionRows[0].version}`);
  await runMigrations(pool);
  await runMigrations(pool);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count, 3);
  console.log('Migrations: three applied from scratch; repeat is idempotent');

  const owner = {
    actorKey: 'OWNER-NATIVE', role: 'process_quality', verifiedEmail: 'owner@example.test',
    issuer: 'https://native-integration.example.test', subject: 'owner-native',
  };
  const trainer = {
    actorKey: 'TRAINER-NATIVE', role: 'assigned_trainer', verifiedEmail: 'trainer@example.test',
    issuer: owner.issuer, subject: 'trainer-native',
  };
  for (const identity of [owner, trainer]) {
    await pool.query(
      `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role)
       VALUES ($1, $2, $3, true, $4, $5)`,
      [identity.issuer, identity.subject, identity.verifiedEmail, identity.actorKey, identity.role],
    );
  }
  // Revocation committed before creation must win, even if the caller was authenticated earlier.
  await withPinnedTransaction(async (lockClient, blockerPid) => {
    await lockClient.query('UPDATE verified_identities SET active = false WHERE issuer = $1 AND subject = $2', [owner.issuer, owner.subject]);
    const operation = { settled: false };
    const create = new PostgresWorkflowRepository(pool).createRequest({
      id: 'REQ-REVOKED-NATIVE', requesterName: 'Revocation race', reason: 'new_training', deadlineDate: '2026-11-20',
      sessions: [{ sessionId: 'SES-REVOKED-NATIVE' }],
      cases: [{ caseId: 'CASE-REVOKED-NATIVE', sessionId: 'SES-REVOKED-NATIVE', participantKey: 'PERSON-REVOKED',
        trainerKey: trainer.actorKey, ownerKey: owner.actorKey }],
    }, owner).finally(() => { operation.settled = true; });
    const waiterPid = await waitForBlockedPid(blockerPid, operation, 'identity deactivate versus request creation');
    assert.notEqual(waiterPid, blockerPid, 'request creation uses its own backend connection');
    await lockClient.query('COMMIT');
    await assert.rejects(create, error => error instanceof ActionError && error.status === 403);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM workflow_requests WHERE request_id = 'REQ-REVOKED-NATIVE'")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE request_id = 'REQ-REVOKED-NATIVE'")).rows[0].count, 0);
  });
  await pool.query('UPDATE verified_identities SET active = true WHERE issuer = $1 AND subject = $2', [owner.issuer, owner.subject]);
  console.log('Identity deactivate/request creation race: passed on separate backends without request or audit writes');

  await new PostgresWorkflowRepository(pool).createRequest({
    id: 'REQ-NATIVE', requesterName: 'Synthetic native integration', sourceTeam: 'Test',
    reason: 'new_training', deadlineDate: '2026-11-20', sessions: [{ sessionId: 'SES-NATIVE' }],
    cases: [
      { caseId: 'CASE-NATIVE-1', sessionId: 'SES-NATIVE', participantKey: 'PERSON-NATIVE-1', participantEmail: 'person1@example.test', trainerKey: trainer.actorKey, ownerKey: owner.actorKey },
      { caseId: 'CASE-NATIVE-2', sessionId: 'SES-NATIVE', participantKey: 'PERSON-NATIVE-2', participantEmail: 'person2@example.test', trainerKey: trainer.actorKey, ownerKey: owner.actorKey },
    ],
  }, owner);

  const assignmentRows = await pool.query(
    `SELECT case_id, role, assignment_id FROM workflow_assignments
      WHERE case_id IN ('CASE-NATIVE-1', 'CASE-NATIVE-2') ORDER BY case_id, role`,
  );
  const assignment = (caseId, role) => Number(assignmentRows.rows.find(row => row.case_id === caseId && row.role === role).assignment_id);
  const links = new HostedParticipantLinks(pool);
  const expiresAt = new Date(Date.now() + 60_000);

  // Assignment deactivation must serialize with link issuance on a separate backend.
  await withPinnedTransaction(async (lockClient, blockerPid) => {
    await lockClient.query(
      'UPDATE workflow_assignments SET active = false, revoked_at = now() WHERE assignment_id = $1',
      [assignment('CASE-NATIVE-1', 'assigned_participant')],
    );
    const operation = { settled: false };
    const issue = links.issue({ caseId: 'CASE-NATIVE-1', assignmentId: assignment('CASE-NATIVE-1', 'assigned_participant'),
      email: 'person1@example.test', expiresAt, createdBy: owner }).finally(() => { operation.settled = true; });
    const waiterPid = await waitForBlockedPid(blockerPid, operation, 'assignment revoke versus issue');
    assert.notEqual(waiterPid, blockerPid, 'link issuance uses its own backend connection');
    await lockClient.query('COMMIT');
    await assert.rejects(issue, error => error instanceof ParticipantLinkError && error.status === 409);
  });
  await pool.query(
    'UPDATE workflow_assignments SET active = true, revoked_at = NULL WHERE assignment_id = $1',
    [assignment('CASE-NATIVE-1', 'assigned_participant')],
  );
  console.log('Assignment revoke/issue race: passed on separate backends');

  // Exact owner identity deactivation must also serialize with issue and revoke.
  await withPinnedTransaction(async (lockClient, blockerPid) => {
    await lockClient.query('UPDATE verified_identities SET active = false WHERE issuer = $1 AND subject = $2', [owner.issuer, owner.subject]);
    const operation = { settled: false };
    const issue = links.issue({ caseId: 'CASE-NATIVE-1', assignmentId: assignment('CASE-NATIVE-1', 'assigned_participant'),
      email: 'person1@example.test', expiresAt, createdBy: owner }).finally(() => { operation.settled = true; });
    const waiterPid = await waitForBlockedPid(blockerPid, operation, 'identity deactivate versus issue');
    assert.notEqual(waiterPid, blockerPid);
    await lockClient.query('COMMIT');
    await assert.rejects(issue, error => error instanceof ParticipantLinkError && error.status === 409);
  });
  await pool.query('UPDATE verified_identities SET active = true WHERE issuer = $1 AND subject = $2', [owner.issuer, owner.subject]);

  const revokeRaceLink = await links.issue({ caseId: 'CASE-NATIVE-1', assignmentId: assignment('CASE-NATIVE-1', 'assigned_participant'),
    email: 'person1@example.test', expiresAt, createdBy: owner });
  const revokeRaceHash = createHash('sha256').update(revokeRaceLink.token).digest();
  const revokeRaceId = (await pool.query('SELECT link_id FROM hosted_participant_links WHERE token_hash = $1', [revokeRaceHash])).rows[0].link_id;
  await links.claim(revokeRaceLink.token, {
    issuer: owner.issuer, subject: 'participant-native-1', email: 'person1@example.test', emailVerified: true,
  });
  await withPinnedTransaction(async (lockClient, blockerPid) => {
    await lockClient.query('UPDATE verified_identities SET active = false WHERE issuer = $1 AND subject = $2', [owner.issuer, owner.subject]);
    const operation = { settled: false };
    const revoke = links.revoke(revokeRaceId, owner).finally(() => { operation.settled = true; });
    const waiterPid = await waitForBlockedPid(blockerPid, operation, 'identity deactivate versus revoke');
    assert.notEqual(waiterPid, blockerPid, 'link revocation uses its own backend connection');
    await lockClient.query('COMMIT');
    assert.equal(await revoke, false, 'revocation is denied after the exact owner identity is deactivated');
  });
  await pool.query('UPDATE verified_identities SET active = true WHERE issuer = $1 AND subject = $2', [owner.issuer, owner.subject]);
  console.log('Owner identity revoke race: passed on separate backends');

  // An absent identity SELECT cannot lock a future row. The upsert must validate the winner.
  const collisionLink = await links.issue({ caseId: 'CASE-NATIVE-2', assignmentId: assignment('CASE-NATIVE-2', 'assigned_participant'),
    email: 'person2@example.test', expiresAt, createdBy: owner });
  for (const registration of [
    { subject: 'collision-native', actorKey: 'OTHER-PERSON-NATIVE', active: true },
    { subject: 'inactive-native', actorKey: 'PERSON-NATIVE-2', active: false },
  ]) {
    await withPinnedTransaction(async (lockClient, blockerPid) => {
      await lockClient.query(
        `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role, active)
         VALUES ($1, $2, 'person2@example.test', true, $3, 'assigned_participant', $4)`,
        [owner.issuer, registration.subject, registration.actorKey, registration.active],
      );
      const operation = { settled: false };
      const claim = links.claim(collisionLink.token, {
        issuer: owner.issuer, subject: registration.subject, email: 'person2@example.test', emailVerified: true,
      }).finally(() => { operation.settled = true; });
      const waiterPid = await waitForBlockedPid(blockerPid, operation, 'concurrent identity registration versus link claim');
      assert.notEqual(waiterPid, blockerPid, 'link claim uses its own backend connection');
      await lockClient.query('COMMIT');
      await assert.rejects(claim, error => error instanceof ParticipantLinkError && error.status === 403);
      const binding = await pool.query(`SELECT l.claimed_issuer, l.claimed_subject, a.identity_issuer, a.identity_subject
        FROM hosted_participant_links l JOIN workflow_assignments a ON a.assignment_id = l.assignment_id
        WHERE l.token_hash = $1`, [createHash('sha256').update(collisionLink.token).digest()]);
      assert.deepEqual(binding.rows[0], { claimed_issuer: null, claimed_subject: null, identity_issuer: null, identity_subject: null });
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE case_id = 'CASE-NATIVE-2' AND operation = 'participant_link.claim'")).rows[0].count, 0);
    });
  }
  console.log('Identity registration/claim races: conflicting and inactive winners denied; link, assignment and audit rollback verified');

  const issued = await links.issue({ caseId: 'CASE-NATIVE-1', assignmentId: assignment('CASE-NATIVE-1', 'assigned_participant'),
    email: 'person1@example.test', expiresAt, createdBy: owner });
  const claimed = await links.claim(issued.token, {
    issuer: owner.issuer, subject: 'participant-native-1', email: 'person1@example.test', emailVerified: true,
  });
  await pool.query("UPDATE workflow_cases SET evidence_facts = evidence_facts || '{\"trainerPass\":true}'::jsonb WHERE case_id = 'CASE-NATIVE-1'");
  const responses = new ParticipantResponses(pool);
  const participant = { ...claimed, issuer: owner.issuer, subject: 'participant-native-1' };

  const trackedPool = trackPoolConnections();
  const executorGate = {};
  executorGate.started = new Promise(resolve => { executorGate.signalStarted = resolve; });
  executorGate.hold = new Promise(resolve => { executorGate.release = resolve; });
  releasePendingExecutor = executorGate.release;
  let executorCalls = 0;
  const gateway = new PostgresWorkflowGateway(trackedPool, {
    async execute({ sessionCases }) {
      executorCalls++;
      executorGate.signalStarted();
      await executorGate.hold;
      const eventId = 'EVENT-NATIVE-SHARED';
      const facts = { eventVerified: true, receiptSaved: true, calendarError: false, slotConflict: false, changedEvent: false };
      return {
        facts, caseStatus: 'invited', state: { calendarEventId: eventId },
        session: { status: 'invited', calendarEventId: eventId },
        relatedCaseUpdates: sessionCases.filter(item => item.scope.caseId !== 'CASE-NATIVE-1').map(item => ({
          caseId: item.scope.caseId, status: 'invited', state: { calendarEventId: eventId }, facts,
        })),
      };
    },
  });
  const snapshot = await gateway.load('CASE-NATIVE-1');
  const baselineConnections = trackedPool.backendPids.length;
  const first = gateway.execute('bookSession', snapshot, {}, owner, 'native-booking-a');
  await executorGate.started;
  const firstPid = trackedPool.backendPids[baselineConnections];
  const second = gateway.execute('bookSession', snapshot, {}, owner, 'native-booking-b');
  const secondConnectionDeadline = Date.now() + 5_000;
  while (trackedPool.backendPids.length < baselineConnections + 2 && Date.now() < secondConnectionDeadline) await timeout(10);
  assert.ok(trackedPool.backendPids.length >= baselineConnections + 2, 'both competing transactions acquired a backend');
  const secondPid = trackedPool.backendPids[baselineConnections + 1];
  assert.notEqual(firstPid, secondPid, 'competing workflow transactions own distinct backend connections');
  const blockedPid = await waitForBlockedPid(firstPid, { settled: false }, 'stale group booking transaction');
  assert.equal(blockedPid, secondPid, 'the losing booking waits on the winner transaction lock');
  executorGate.release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof ActionError && rejected.reason.status === 409);
  assert.equal(executorCalls, 1, 'only the fresh-snapshot transaction reaches the external executor');
  const bookedCases = await pool.query(
    `SELECT case_id, status, revision::text AS revision, state->>'calendarEventId' AS event_id
       FROM workflow_cases WHERE request_id = 'REQ-NATIVE' ORDER BY case_id`,
  );
  assert.ok(bookedCases.rows.every(row => row.status === 'invited' && row.event_id === 'EVENT-NATIVE-SHARED'));
  assert.deepEqual(bookedCases.rows.map(row => row.case_id), ['CASE-NATIVE-1', 'CASE-NATIVE-2']);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM workflow_events WHERE request_id = 'REQ-NATIVE' AND action_id = 'bookSession'")).rows[0].count, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM case_evidence WHERE case_id IN ('CASE-NATIVE-1','CASE-NATIVE-2') AND fact_key = 'eventVerified'")).rows[0].count, 2);
  console.log(`Concurrent group booking: passed; distinct backends ${firstPid}/${secondPid}; one commit, one stale-revision conflict`);

  // Seed assessment state; trainer submission is outside this native harness.
  await pool.query("UPDATE workflow_cases SET status = 'assessed' WHERE case_id = 'CASE-NATIVE-1'");
  const responseInput = { caseId: 'CASE-NATIVE-1', idempotencyKey: 'native-response-1', answer: 'yes', typedName: 'Native Participant' };
  const response = await responses.submit(responseInput, participant);
  const replay = await responses.submit(responseInput, participant);
  assert.equal(replay.responseId, response.responseId);
  assert.equal(replay.replayed, true);
  const responseFacts = await pool.query(
    `SELECT count(*)::int AS count FROM case_evidence
      WHERE case_id = 'CASE-NATIVE-1' AND source_id = $1 AND source_type = 'hosted_participant_response'`, [response.responseId],
  );
  assert.equal(responseFacts.rows[0].count, 3);
  console.log('Participant response: passed; exact retry returns the immutable receipt and three attributed facts');

  await pool.query("ALTER TABLE case_evidence ADD CONSTRAINT native_rollback_probe CHECK (fact_key <> 'rollback_probe')");
  const beforeRollback = await pool.query(
    `SELECT (SELECT count(*) FROM workflow_events)::int AS events,
            (SELECT count(*) FROM audit_events)::int AS audits,
            (SELECT count(*) FROM case_evidence)::int AS evidence,
            (SELECT revision::text FROM workflow_cases WHERE case_id = 'CASE-NATIVE-2') AS revision`,
  );
  const rollbackGateway = new PostgresWorkflowGateway(pool, { async execute() { return { facts: { rollback_probe: true } }; } });
  const secondCase = await rollbackGateway.load('CASE-NATIVE-2');
  await assert.rejects(rollbackGateway.execute('recordTrainerAssessment', secondCase, {}, trainer, 'native-rollback'));
  const afterRollback = await pool.query(
    `SELECT (SELECT count(*) FROM workflow_events)::int AS events,
            (SELECT count(*) FROM audit_events)::int AS audits,
            (SELECT count(*) FROM case_evidence)::int AS evidence,
            (SELECT revision::text FROM workflow_cases WHERE case_id = 'CASE-NATIVE-2') AS revision`,
  );
  assert.deepEqual(afterRollback.rows[0], beforeRollback.rows[0], 'failed evidence insert rolls back status, revision, evidence, event, and audit');
  console.log('Transactional rollback: passed; no partial state, evidence, event, or audit rows remain');
  console.log('Native PostgreSQL integration: all checks passed');
} finally {
  releasePendingExecutor();
  await pool.end();
}
