import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import {
  createLocalPilotHandler, initializeLocalPilotConfig, loadLocalPilotConfig,
  seedLocalPilotIdentities, validateLocalDatabaseUrl, type LocalPilotConfig,
} from '../src/local-pilot.ts';

const issuer = 'https://cosanum-local.test';
const identity = (subject: string, email: string, actorKey: string, role: LocalPilotConfig['identities'][number]['role']) => ({
  issuer, subject, email, actorKey, role, token: randomBytes(32).toString('base64url'),
});

function config(): LocalPilotConfig {
  return { kind: 'cosanum-local-synthetic-v1', identities: [
    identity('daniel', 'daniel@cosanum.test', 'DANIEL', 'process_quality'),
    identity('matthew', 'matthew@cosanum.test', 'MATTHEW', 'assigned_participant'),
    identity('annina', 'annina@cosanum.test', 'ANNINA', 'assigned_participant'),
    identity('hcm4', 'hcm4@cosanum.test', 'HCM4', 'assigned_trainer'),
  ] };
}

async function call(base: string, path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json() as Record<string, any>, headers: response.headers };
}

test('local pilot config stays private and PostgreSQL target stays loopback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cosanum-local-pilot-'));
  const path = join(directory, 'identities.json');
  try {
    await initializeLocalPilotConfig(path);
    const stored = await loadLocalPilotConfig(path);
    assert.equal(stored.kind, 'cosanum-local-synthetic-v1');
    assert.equal(stored.identities.length, 5);
    assert.ok(stored.identities.every(item => item.email.endsWith('.test') && item.token.length >= 43));
    assert.ok((await readFile(path, 'utf8')).includes('daniel@cosanum.test'));
    await assert.rejects(initializeLocalPilotConfig(path));
    await chmod(path, 0o644);
    await assert.rejects(loadLocalPilotConfig(path), /0600/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(validateLocalDatabaseUrl('postgresql://cosanum_api_local:private@127.0.0.1:55432/cosanum_local'),
    'postgresql://cosanum_api_local:private@127.0.0.1:55432/cosanum_local');
  for (const url of [
    'postgresql://cosanum_api_local:private@db.example.test/cosanum_local',
    'postgresql://cosanum_api_local:private@localhost:55432/cosanum_local',
    'postgresql://cosanum_api_local:private@127.0.0.1:55432/cosanum_local?host=db.example.test',
    'postgresql://cosanum_api_local:private@127.0.0.1:55432/other_database',
    'postgresql://cosanum_local:private@127.0.0.1:55432/cosanum_local',
    'postgresql:///cosanum_local',
  ]) assert.throws(() => validateLocalDatabaseUrl(url), /restricted cosanum_api_local role/);
});

test('local pilot serves durable assigned cases while external actions remain disabled', async () => {
  const engine = new PGlite();
  const pool = new pg.Pool({ ...createPgConfig(engine), max: 1 });
  const identities = config();
  const owner = identities.identities.find(item => item.subject === 'daniel')!;
  const participant = identities.identities.find(item => item.subject === 'matthew')!;
  const other = identities.identities.find(item => item.subject === 'annina')!;
  const server = createServer(createLocalPilotHandler(pool, identities));
  try {
    await runMigrations(pool);
    await seedLocalPilotIdentities(pool, identities);
    await seedLocalPilotIdentities(pool, identities);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM verified_identities')).rows[0].count, 4);
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => { server.off('error', rejectListen); resolveListen(); });
    });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const health = await call(base, '/health');
    assert.deepEqual(health.body, { status: 'ready', mode: 'local_synthetic', database: 'ready', externalActions: 'disabled' });
    assert.equal(health.headers.get('access-control-allow-origin'), null);

    const input = {
      id: 'REQ-LOCAL-1', requesterName: 'Synthetic CCS request', sourceTeam: 'CCS', reason: 'new_training', deadlineDate: '2026-11-20',
      sessions: [{ sessionId: 'SES-LOCAL-1', attributes: { topicId: 'TR-1', topicName: 'Wareneingang', mode: 'single' } }],
      cases: [{ caseId: 'CASE-LOCAL-1', sessionId: 'SES-LOCAL-1', participantKey: participant.actorKey,
        participantEmail: participant.email, trainerKey: 'HCM4', ownerKey: owner.actorKey,
        attributes: { topicId: 'TR-1', topicName: 'Wareneingang', mode: 'single', targetLevel: 2 } }],
    };
    assert.equal((await call(base, '/requests', { method: 'POST', token: participant.token, body: input })).status, 403);
    const wrongOwner = await call(base, '/requests', { method: 'POST', token: owner.token, body: {
      ...input, id: 'REQ-LOCAL-ORPHAN', sessions: [{ ...input.sessions[0], sessionId: 'SES-LOCAL-ORPHAN' }],
      cases: [{ ...input.cases[0], caseId: 'CASE-LOCAL-ORPHAN', sessionId: 'SES-LOCAL-ORPHAN', ownerKey: 'UNKNOWN-OWNER' }],
    } });
    assert.equal(wrongOwner.status, 409);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM workflow_requests WHERE request_id = 'REQ-LOCAL-ORPHAN'")).rows[0].count, 0);
    const unknownTopic = await call(base, '/requests', { method: 'POST', token: owner.token, body: {
      ...input, id: 'REQ-LOCAL-BAD-TOPIC', sessions: [{ ...input.sessions[0], sessionId: 'SES-LOCAL-BAD-TOPIC', attributes: { topicId: 'TR-X', topicName: 'Unknown', mode: 'single' } }],
      cases: [{ ...input.cases[0], caseId: 'CASE-LOCAL-BAD-TOPIC', sessionId: 'SES-LOCAL-BAD-TOPIC' }],
    } });
    assert.equal(unknownTopic.status, 400);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM workflow_requests WHERE request_id = 'REQ-LOCAL-BAD-TOPIC'")).rows[0].count, 0);
    const unsupportedGroup = await call(base, '/requests', { method: 'POST', token: owner.token, body: {
      ...input, id: 'REQ-LOCAL-GROUP', sessions: [{ sessionId: 'SES-LOCAL-GROUP', attributes: { topicId: 'TR-1', topicName: 'Wareneingang', mode: 'group' } }],
      cases: [
        { ...input.cases[0], caseId: 'CASE-LOCAL-GROUP-1', sessionId: 'SES-LOCAL-GROUP', attributes: { topicId: 'TR-1', topicName: 'Wareneingang', mode: 'group', targetLevel: 2 } },
        { ...input.cases[0], caseId: 'CASE-LOCAL-GROUP-2', sessionId: 'SES-LOCAL-GROUP', participantKey: other.actorKey, participantEmail: other.email,
          attributes: { topicId: 'TR-1', topicName: 'Wareneingang', mode: 'group', targetLevel: 2 } },
      ],
    } });
    assert.equal(unsupportedGroup.status, 400);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM workflow_requests WHERE request_id = 'REQ-LOCAL-GROUP'")).rows[0].count, 0);
    const unknownPerson = await call(base, '/requests', { method: 'POST', token: owner.token, body: {
      ...input, id: 'REQ-LOCAL-UNKNOWN', sessions: [{ ...input.sessions[0], sessionId: 'SES-LOCAL-UNKNOWN' }],
      cases: [{ ...input.cases[0], caseId: 'CASE-LOCAL-UNKNOWN', sessionId: 'SES-LOCAL-UNKNOWN', participantKey: 'UNKNOWN' }],
    } });
    assert.equal(unknownPerson.status, 400);
    const onePersonGroup = await call(base, '/requests', { method: 'POST', token: owner.token, body: {
      ...input, id: 'REQ-LOCAL-GROUP-ONE', sessions: [{ sessionId: 'SES-LOCAL-GROUP-ONE', attributes: { topicId: 'TR-1', topicName: 'Wareneingang', mode: 'group' } }],
      cases: [{ ...input.cases[0], caseId: 'CASE-LOCAL-GROUP-ONE', sessionId: 'SES-LOCAL-GROUP-ONE',
        attributes: { topicId: 'TR-1', topicName: 'Wareneingang', mode: 'group', targetLevel: 2 } }],
    } });
    assert.equal(onePersonGroup.status, 201);
    assert.equal((await call(base, '/cases/CASE-LOCAL-GROUP-ONE', { token: owner.token })).body.trainerKey, 'HCM4');
    assert.equal((await call(base, '/requests', { method: 'POST', token: owner.token, body: input })).status, 201);
    const replay = await call(base, '/requests', { method: 'POST', token: owner.token, body: input });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal((await call(base, '/requests', { method: 'POST', token: owner.token, body: { ...input, requesterName: 'Changed' } })).status, 409);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE operation = 'workflow.request.create' AND request_id = $1", [input.id])).rows[0].count, 1);

    const dashboard = await call(base, '/dashboard/process-quality', { token: owner.token });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.unscheduledRequests[0].requestId, input.id);
    assert.equal(dashboard.body.unscheduledRequests[0].cases[0].caseId, 'CASE-LOCAL-1');
    assert.equal((await call(base, '/dashboard/process-quality', { token: participant.token })).status, 403);
    assert.equal((await call(base, '/cases/CASE-LOCAL-1', { token: owner.token })).status, 200);
    assert.equal((await call(base, '/cases/CASE-LOCAL-1', { token: participant.token })).status, 403);
    assert.equal((await call(base, '/cases/CASE-LOCAL-1', { token: other.token })).status, 403);
    assert.equal((await call(base, '/cases/CASE-LOCAL-1', { token: randomBytes(32).toString('base64url') })).status, 401);

    const assignment = await pool.query<{ assignment_id: string }>(
      "SELECT assignment_id FROM workflow_assignments WHERE case_id = 'CASE-LOCAL-1' AND role = 'assigned_participant'",
    );
    const issue = await call(base, '/participant-links', { method: 'POST', token: owner.token, body: {
      caseId: 'CASE-LOCAL-1', assignmentId: Number(assignment.rows[0]!.assignment_id), email: participant.email,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } });
    assert.equal(issue.status, 201);
    assert.equal((await call(base, '/participant-links/claim', { method: 'POST', token: other.token, body: { linkToken: issue.body.token } })).status, 403);
    const claim = await call(base, '/participant-links/claim', { method: 'POST', token: participant.token, body: { linkToken: issue.body.token } });
    assert.equal(claim.status, 200);
    assert.equal(claim.body.actorKey, participant.actorKey);
    assert.equal((await call(base, '/cases/CASE-LOCAL-1', { token: participant.token })).status, 200);
    assert.equal((await call(base, '/cases/CASE-LOCAL-1', { token: other.token })).status, 403);

    // Recreate the handler with the same database to prove durable readback.
    const secondServer = createServer(createLocalPilotHandler(pool, identities));
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        secondServer.once('error', rejectListen);
        secondServer.listen(0, '127.0.0.1', () => { secondServer.off('error', rejectListen); resolveListen(); });
      });
      const secondBase = `http://127.0.0.1:${(secondServer.address() as { port: number }).port}`;
      assert.equal((await call(secondBase, '/cases/CASE-LOCAL-1', { token: participant.token })).status, 200);
      assert.equal((await call(secondBase, '/dashboard/process-quality', { token: owner.token })).body.unscheduledRequests[0].requestId, input.id);
    } finally {
      await new Promise<void>(resolveClose => secondServer.close(() => resolveClose()));
    }

    await pool.query("UPDATE workflow_cases SET evidence_facts = '{\"sessionPlanned\":true,\"slotAvailable\":true,\"calendarError\":false,\"slotConflict\":false,\"changedEvent\":false}'::jsonb WHERE case_id = 'CASE-LOCAL-1'");
    const before = await pool.query<{ events: number; audit: number; evidence: number; revision: string }>(
      `SELECT (SELECT count(*)::int FROM workflow_events WHERE case_id = 'CASE-LOCAL-1') AS events,
              (SELECT count(*)::int FROM audit_events WHERE case_id = 'CASE-LOCAL-1') AS audit,
              (SELECT count(*)::int FROM case_evidence WHERE case_id = 'CASE-LOCAL-1') AS evidence,
              revision::text AS revision FROM workflow_cases WHERE case_id = 'CASE-LOCAL-1'`,
    );
    const disabled = await call(base, '/actions', { method: 'POST', token: owner.token, body: {
      actionId: 'bookSession', caseId: 'CASE-LOCAL-1', idempotencyKey: 'local-book-attempt', payload: {},
    } });
    assert.equal(disabled.status, 503);
    const after = await pool.query<{ events: number; audit: number; evidence: number; revision: string }>(
      `SELECT (SELECT count(*)::int FROM workflow_events WHERE case_id = 'CASE-LOCAL-1') AS events,
              (SELECT count(*)::int FROM audit_events WHERE case_id = 'CASE-LOCAL-1') AS audit,
              (SELECT count(*)::int FROM case_evidence WHERE case_id = 'CASE-LOCAL-1') AS evidence,
              revision::text AS revision FROM workflow_cases WHERE case_id = 'CASE-LOCAL-1'`,
    );
    assert.deepEqual(after.rows[0], before.rows[0]);

    await pool.query("UPDATE verified_identities SET active = false WHERE subject = 'daniel'");
    await assert.rejects(seedLocalPilotIdentities(pool, identities), /conflicts/);
    assert.equal((await call(base, '/cases/CASE-LOCAL-1', { token: owner.token })).status, 401);
  } finally {
    if (server.listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await pool.end();
    await engine.close();
  }
});
