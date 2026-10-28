import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionError, type Identity, type Snapshot } from '../src/service.ts';
import { PostgresWorkflowGateway } from '../src/postgres-gateway.ts';
import type { SqlPool } from '../src/database.ts';

const snapshot: Snapshot = {
  scope: { requestId: 'REQ-1', sessionId: 'SES-1', caseId: 'CASE-1' },
  request: { requesterName: 'Synthetic requester', sourceTeam: 'Demo', reason: 'new_training', deadlineDate: '2026-11-20' },
  personKey: 'PERSON-1', trainerKey: 'TRAINER-1', ownerKey: 'OWNER-1', revision: '1',
  evidence: { facts: { sessionPlanned: true, slotAvailable: true, calendarError: false, slotConflict: false, changedEvent: false }, values: {} },
};
const identity: Identity = { actorKey: 'OWNER-1', role: 'process_quality', verifiedEmail: 'owner@example.test', issuer: 'https://issuer.example.test', subject: 'owner-sub' };

function queryResult(rows: unknown[] = []) { return { rows, rowCount: rows.length } as never; }
function fakePool(options: { revision?: string; duplicate?: boolean; assignment?: boolean } = {}) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const connection = {
    async query(sql: string, values?: readonly unknown[]) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT c.request_id')) return queryResult([{
        request_id: 'REQ-1', session_id: 'SES-1', case_id: 'CASE-1', proof_id: null, proof_version: null,
        participant_key: 'PERSON-1', trainer_key: 'TRAINER-1', owner_key: 'OWNER-1', revision: options.revision ?? '1',
        attributes: { topicId: 'TOPIC-1', targetLevel: 2 }, state: {}, status: 'planning',
        evidence_facts: snapshot.evidence.facts, evidence_values: {}, requester_name: 'Synthetic requester', source_team: 'Demo',
        reason: 'new_training', deadline_date: '2026-11-20',
      }]);
      if (sql.startsWith('SELECT 1 FROM workflow_events')) return options.duplicate ? queryResult([{ '?column?': 1 }]) : queryResult();
      if (sql.includes('FROM verified_identities i')) return options.assignment === false ? queryResult() : queryResult([{ '?column?': 1 }]);
      if (sql.includes('RETURNING event_id')) return queryResult([{ event_id: '00000000-0000-0000-0000-000000000001' }]);
      if (sql.startsWith('UPDATE workflow_cases')) return { rows: [], rowCount: 1 } as never;
      return queryResult();
    },
    release() {},
  };
  const pool = { async connect() { return connection; }, async query() { return queryResult(); }, async end() {} } as unknown as SqlPool;
  return { pool, calls };
}

test('Postgres gateway locks the revision and persists evidence, event, and audit atomically', async () => {
  const db = fakePool();
  let executions = 0;
  const gateway = new PostgresWorkflowGateway(db.pool, { async execute(input) {
    executions++;
    assert.equal(input.idempotencyKey, 'booking-1');
    return { facts: { eventVerified: true, receiptSaved: true, calendarError: false, slotConflict: false, changedEvent: false },
      caseStatus: 'invited', state: { calendarEventId: 'EVENT-1' }, details: { externalReadback: 'synthetic' } };
  } });
  await gateway.execute('bookSession', snapshot, {}, identity, 'booking-1');
  assert.equal(executions, 1);
  assert.equal(db.calls[0]!.sql, 'BEGIN');
  assert.ok(db.calls.some(call => call.sql.includes('FOR UPDATE OF c')));
  assert.ok(db.calls.some(call => call.sql.startsWith('INSERT INTO workflow_events')));
  assert.ok(db.calls.some(call => call.sql.startsWith('INSERT INTO audit_events')));
  const update = db.calls.find(call => call.sql.startsWith('UPDATE workflow_cases'))!;
  assert.equal(update.values?.[5], 'invited');
  assert.deepEqual(JSON.parse(String(update.values?.[6])), { calendarEventId: 'EVENT-1' });
  assert.equal(db.calls.at(-1)!.sql, 'COMMIT');
});

test('Postgres gateway rejects stale and replayed revisions before executing the action', async () => {
  const stale = fakePool({ revision: '2' });
  let executions = 0;
  const executor = { async execute() { executions++; return { facts: {} }; } };
  const staleGateway = new PostgresWorkflowGateway(stale.pool, executor);
  await assert.rejects(staleGateway.execute('bookSession', snapshot, {}, identity, 'booking-1'),
    (error: unknown) => error instanceof ActionError && error.status === 409);
  assert.equal(executions, 0);
  assert.equal(stale.calls.at(-1)!.sql, 'ROLLBACK');

  const unassigned = fakePool({ assignment: false });
  const unassignedGateway = new PostgresWorkflowGateway(unassigned.pool, executor);
  await assert.rejects(unassignedGateway.execute('bookSession', snapshot, {}, identity, 'booking-1'),
    (error: unknown) => error instanceof ActionError && error.status === 403);
  assert.equal(executions, 0);
  assert.equal(unassigned.calls.at(-1)!.sql, 'ROLLBACK');

  const duplicate = fakePool({ duplicate: true });
  const duplicateGateway = new PostgresWorkflowGateway(duplicate.pool, executor);
  await assert.rejects(duplicateGateway.execute('bookSession', snapshot, {}, identity, 'booking-1'),
    (error: unknown) => error instanceof ActionError && error.status === 409);
  assert.equal(executions, 0);
});

test('Postgres gateway does not commit an executor result with missing postconditions or forbidden facts', async () => {
  const cases: Array<Record<string, boolean>> = [
    { eventVerified: true, calendarError: false, slotConflict: false, changedEvent: false },
    { eventVerified: true, receiptSaved: true, calendarError: true, slotConflict: false, changedEvent: false },
  ];
  for (const facts of cases) {
    const db = fakePool();
    const gateway = new PostgresWorkflowGateway(db.pool, { async execute() { return { facts }; } });
    await assert.rejects(gateway.execute('bookSession', snapshot, {}, identity, 'booking-1'),
      (error: unknown) => error instanceof ActionError && error.status === 502);
    assert.equal(db.calls.at(-1)!.sql, 'ROLLBACK');
    assert.equal(db.calls.some(call => call.sql.startsWith('INSERT INTO workflow_events')), false);
  }
});
