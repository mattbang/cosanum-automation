#!/usr/bin/env node
/** Repeatable, synthetic HTTP + native PostgreSQL pilot check. Never prints tokens. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadLocalPilotConfig, validateLocalDatabaseUrl } from '../src/local-pilot.ts';

const phase = process.argv[2];
if (!['create', 'verify'].includes(phase)) throw new Error('Usage: node --import tsx scripts/local-pilot-smoke.mjs create|verify');
const config = await loadLocalPilotConfig(process.env.COSANUM_LOCAL_CONFIG || '');
const connectionString = validateLocalDatabaseUrl(process.env.DATABASE_URL || '');
const people = Object.fromEntries(config.identities.map(item => [item.subject, item]));
const owner = people.daniel;
const participant = people.matthew;
assert(owner && participant, 'Daniel and Matthew synthetic identities are required');
const base = 'http://127.0.0.1:8788';
const requestId = 'REQ-LOCAL-PILOT-001';
const sessionId = 'SES-LOCAL-PILOT-001';
const caseId = 'CASE-LOCAL-PILOT-001';
const pool = new pg.Pool({ connectionString });

async function call(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const health = await call('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.mode, 'local_synthetic');
  assert.equal(health.body.externalActions, 'disabled');

  if (phase === 'create') {
    const body = {
      id: requestId, requesterName: 'Synthetic CCS request', sourceTeam: 'CCS', reason: 'new_training', deadlineDate: '2026-11-20',
      sessions: [{ sessionId, attributes: { topicId: 'TR-1', topicName: 'Wareneingang', mode: 'single' } }],
      cases: [{ caseId, sessionId, participantKey: participant.actorKey, participantEmail: participant.email,
        trainerKey: 'HCM4', ownerKey: owner.actorKey,
        attributes: { topicId: 'TR-1', topicName: 'Wareneingang', mode: 'single', targetLevel: 2 } }],
    };
    assert.equal((await call('/requests', { method: 'POST', token: participant.token, body })).status, 409);
    const created = await call('/requests', { method: 'POST', token: owner.token, body });
    assert.ok([200, 201].includes(created.status));
    assert.deepEqual(created.body.caseIds, [caseId]);
    const replay = await call('/requests', { method: 'POST', token: owner.token, body });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal((await call('/cases/' + caseId, { token: participant.token })).status, 403);

    const assignment = await pool.query(
      "SELECT assignment_id FROM workflow_assignments WHERE case_id = $1 AND role = 'assigned_participant' AND active", [caseId],
    );
    assert.equal(assignment.rows.length, 1);
    const issued = await call('/participant-links', { method: 'POST', token: owner.token, body: {
      caseId, assignmentId: Number(assignment.rows[0].assignment_id), email: participant.email,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    } });
    assert.equal(issued.status, 201);
    assert.equal((await call('/participant-links/claim', { method: 'POST', token: participant.token, body: { linkToken: issued.body.token } })).status, 200);
    assert.equal((await call('/cases/' + caseId, { token: participant.token })).status, 200);
    const disabled = await call('/actions', { method: 'POST', token: owner.token, body: {
      actionId: 'bookSession', caseId, idempotencyKey: 'local-pilot-disabled-action', payload: {},
    } });
    assert.ok([409, 503].includes(disabled.status));
  }

  const dashboard = await call('/dashboard/process-quality', { token: owner.token });
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.body.unscheduledRequests.some(item => item.requestId === requestId && item.cases.some(entry => entry.caseId === caseId)));
  assert.equal((await call('/dashboard/process-quality', { token: participant.token })).status, 403);
  assert.equal((await call('/cases/' + caseId, { token: owner.token })).status, 200);
  assert.equal((await call('/cases/' + caseId, { token: participant.token })).status, 200);
  assert.equal((await call('/cases/' + caseId, { token: randomBytes(32).toString('base64url') })).status, 401);

  const audit = await pool.query(
    "SELECT count(*)::int AS count FROM audit_events WHERE operation = 'workflow.request.create' AND request_id = $1", [requestId],
  );
  assert.equal(audit.rows[0].count, 1);
  const actionEvidence = await pool.query('SELECT count(*)::int AS count FROM workflow_events WHERE case_id = $1', [caseId]);
  assert.equal(actionEvidence.rows[0].count, 0);
  console.log(`${phase}: PostgreSQL case, assignment, authorization, dashboard, and audit readback passed (${caseId}); external actions stayed disabled.`);
} finally {
  await pool.end();
}
