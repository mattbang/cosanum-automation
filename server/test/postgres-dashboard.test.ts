import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import { PostgresProcessQualityDashboard } from '../src/postgres-dashboard.ts';
import { ActionError, type Identity } from '../src/service.ts';

test('Process & Quality dashboard projects durable rows with active identity and per-case owner isolation', async () => {
  const engine = new PGlite();
  const pool = new pg.Pool({ ...createPgConfig(engine), max: 1 });
  try {
    await runMigrations(pool);
    const ownerA: Identity = { actorKey: 'OWNER-A', role: 'process_quality', verifiedEmail: 'a@example.test', issuer: 'https://issuer.test', subject: 'a' };
    const ownerB: Identity = { actorKey: 'OWNER-B', role: 'process_quality', verifiedEmail: 'b@example.test', issuer: 'https://issuer.test', subject: 'b' };
    for (const owner of [ownerA, ownerB]) {
      await pool.query(
        `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role)
         VALUES ($1, $2, $3, true, $4, $5)`,
        [owner.issuer, owner.subject, owner.verifiedEmail, owner.actorKey, owner.role],
      );
    }
    await pool.query(`INSERT INTO workflow_requests (request_id, requester_name, source_team, reason, deadline_date, revision)
      VALUES ('REQ-PLAN', 'Requester One', 'Warehouse', 'retraining', '2026-11-10', 4),
             ('REQ-UPCOMING', 'Requester Two', null, 'process_change', '2026-11-12', 2),
             ('REQ-ATTENTION', 'Requester Three', 'Quality', 'new_training', '2026-11-14', 3)`);
    await pool.query(`INSERT INTO workflow_sessions (session_id, request_id, starts_at, ends_at, calendar_event_id, status, revision, attributes)
      VALUES ('SES-PLAN', 'REQ-PLAN', NULL, NULL, NULL, 'planned', 1, '{"topicId":"TOPIC-1","topicName":"Goods intake"}'),
             ('SES-RETRY', 'REQ-PLAN', NULL, NULL, NULL, 'planned', 2, '{"topicId":"TOPIC-1","topicName":"Goods intake"}'),
             ('SES-GROUP', 'REQ-UPCOMING', now() + interval '2 days', now() + interval '2 days 1 hour', 'EVENT-GROUP', 'invited', 6, '{}'),
             ('SES-ATTENTION', 'REQ-ATTENTION', now() + interval '3 days', now() + interval '3 days 1 hour', 'EVENT-ATTENTION', 'invited', 2, '{}')`);
    await pool.query(`INSERT INTO workflow_cases (case_id, request_id, session_id, participant_key, trainer_key, owner_key, status, revision, state, attributes, evidence_facts)
      VALUES ('CASE-PLAN-A', 'REQ-PLAN', 'SES-PLAN', 'PERSON-A', 'TRAINER-A', 'OWNER-A', 'planning', 7, '{}', '{"mode":"group","targetLevel":2}', '{}'),
             ('CASE-PLAN-B', 'REQ-PLAN', 'SES-PLAN', 'PERSON-B', 'TRAINER-B', 'OWNER-B', 'planning', 8, '{}', '{}', '{}'),
             ('CASE-RETRY-A', 'REQ-PLAN', 'SES-RETRY', 'PERSON-A', 'TRAINER-A', 'OWNER-A', 'planning', 1, '{}', '{"mode":"single","targetLevel":2}', '{}'),
             ('CASE-GROUP-A', 'REQ-UPCOMING', 'SES-GROUP', 'PERSON-A', 'TRAINER-A', 'OWNER-A', 'invited', 9, '{}', '{"mode":"group"}', '{}'),
             ('CASE-GROUP-B', 'REQ-UPCOMING', 'SES-GROUP', 'PERSON-B', 'TRAINER-B', 'OWNER-B', 'invited', 10, '{}', '{"mode":"group"}', '{}'),
             ('CASE-ATTENTION-A', 'REQ-ATTENTION', 'SES-ATTENTION', 'PERSON-A', 'TRAINER-A', 'OWNER-A', 'assessed', 11, '{}', '{}', '{"trainerPass":true}'),
             ('CASE-DECLINED-A', 'REQ-ATTENTION', 'SES-ATTENTION', 'PERSON-A3', 'TRAINER-A', 'OWNER-A', 'invited', 13, '{"declined":true}', '{}', '{}'),
             ('CASE-FAILED-A', 'REQ-ATTENTION', 'SES-ATTENTION', 'PERSON-A4', 'TRAINER-A', 'OWNER-A', 'assessed', 14, '{}', '{}', '{"trainerPass":false}'),
             ('CASE-SUPERSEDED-A', 'REQ-ATTENTION', 'SES-ATTENTION', 'PERSON-A2', 'TRAINER-A', 'OWNER-A', 'proof_ready', 12, '{"supersededByCaseId":"CASE-RETRY"}', '{}', '{}')`);
    await pool.query(`INSERT INTO workflow_assignments (case_id, role, actor_key)
      SELECT case_id, 'process_quality', owner_key FROM workflow_cases`);

    const dashboard = await new PostgresProcessQualityDashboard(pool).read(ownerA);
    assert.equal(dashboard.unscheduledRequests.length, 2);
    assert.deepEqual(dashboard.unscheduledRequests[0], {
      requestId: 'REQ-PLAN', requesterName: 'Requester One', sourceTeam: 'Warehouse', reason: 'retraining',
      deadlineDate: '2026-11-10', revision: '4', sessionId: 'SES-PLAN', sessionRevision: '1',
      cases: [{ caseId: 'CASE-PLAN-A', participantKey: 'PERSON-A', trainerKey: 'TRAINER-A', status: 'planning', revision: '7',
        topicId: 'TOPIC-1', topicName: 'Goods intake', mode: 'group', targetLevel: 2, declined: false }],
    });
    assert.equal(dashboard.unscheduledRequests[1]!.sessionId, 'SES-RETRY');
    assert.deepEqual(dashboard.unscheduledRequests[1]!.cases.map(item => item.caseId), ['CASE-RETRY-A']);
    assert.equal(dashboard.upcomingSessions.length, 2);
    assert.equal(dashboard.upcomingSessions[0]!.sessionId, 'SES-GROUP');
    assert.equal(dashboard.upcomingSessions[0]!.requestId, 'REQ-UPCOMING');
    assert.equal(dashboard.upcomingSessions[0]!.reason, 'process_change');
    assert.equal(dashboard.upcomingSessions[0]!.deadlineDate, '2026-11-12');
    assert.equal(dashboard.upcomingSessions[0]!.sessionRevision, '6');
    assert.deepEqual(dashboard.upcomingSessions[0]!.cases, [{ caseId: 'CASE-GROUP-A', participantKey: 'PERSON-A', trainerKey: 'TRAINER-A', status: 'invited', revision: '9', mode: 'group', declined: false }]);
    assert.equal(dashboard.upcomingSessions[1]!.sessionId, 'SES-ATTENTION');
    assert.deepEqual(dashboard.upcomingSessions[1]!.cases.map(item => item.caseId), ['CASE-ATTENTION-A', 'CASE-DECLINED-A', 'CASE-FAILED-A']);
    assert.equal(dashboard.upcomingSessions[1]!.endsAt?.endsWith('Z'), true);
    assert.equal(dashboard.attentionCases.length, 3);
    const attentionByCase = new Map(dashboard.attentionCases.map(item => [item.caseId, item]));
    assert.equal(attentionByCase.get('CASE-ATTENTION-A')?.attentionAction, 'participant_acknowledgement');
    assert.equal(attentionByCase.get('CASE-ATTENTION-A')?.trainerPassed, true);
    assert.equal(attentionByCase.get('CASE-DECLINED-A')?.attentionAction, 'reschedule');
    assert.equal(attentionByCase.get('CASE-DECLINED-A')?.declined, true);
    assert.equal(attentionByCase.get('CASE-FAILED-A')?.attentionAction, 'reschedule');
    assert.equal(attentionByCase.get('CASE-FAILED-A')?.trainerPassed, false);
    const serialized = JSON.stringify(dashboard);
    for (const forbidden of ['PERSON-B', 'CASE-PLAN-B', 'CASE-GROUP-B', 'CASE-SUPERSEDED-A', 'OWNER-B']) assert.equal(serialized.includes(forbidden), false);
    const ownerBDashboard = await new PostgresProcessQualityDashboard(pool).read(ownerB);
    assert.ok(JSON.stringify(ownerBDashboard).includes('CASE-GROUP-B'));
    assert.equal(JSON.stringify(ownerBDashboard).includes('CASE-GROUP-A'), false);
    await assert.rejects(new PostgresProcessQualityDashboard(pool).read({ ...ownerA, role: 'assigned_trainer' }),
      error => error instanceof ActionError && error.status === 403);
    await pool.query('UPDATE verified_identities SET active = false WHERE issuer = $1 AND subject = $2', [ownerA.issuer, ownerA.subject]);
    const inactive = await new PostgresProcessQualityDashboard(pool).read(ownerA);
    assert.deepEqual(inactive, { unscheduledRequests: [], upcomingSessions: [], attentionCases: [] });
  } finally {
    await pool.end();
    await engine.close();
  }
});
