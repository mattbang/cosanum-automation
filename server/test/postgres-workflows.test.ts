import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SqlPool } from '../src/database.ts';
import { PostgresWorkflowRepository, WorkflowConflictError, WorkflowInputError, type CreateRequestInput } from '../src/postgres-workflows.ts';
import type { Identity } from '../src/service.ts';

const input: CreateRequestInput = {
  id: 'REQ-1', requesterName: 'Requester', sourceTeam: 'Warehouse', reason: 'process_change', deadlineDate: '2026-11-20',
  sessions: [{ sessionId: 'SES-1', startsAt: '2026-11-02T09:00:00Z', endsAt: '2026-11-02T10:00:00Z', attributes: { location: 'Synthetic room' } }],
  cases: [{ caseId: 'CASE-1', sessionId: 'SES-1', participantKey: 'PERSON-1', trainerKey: 'TRAINER-1', ownerKey: 'OWNER-1', attributes: { topicId: 'TOPIC-1', targetLevel: 2 } }],
};
const actor: Identity = { actorKey: 'OWNER-1', role: 'process_quality', verifiedEmail: 'owner@example.test' };
function result(rows: unknown[] = [], rowCount = rows.length) { return { rows, rowCount } as never; }

function repositoryDb() {
  const requests = new Map<string, { requester_name: string; source_team: string | null; reason: string; deadline_date: string; attributes: Record<string, unknown> }>();
  const sessions = new Map<string, { request_id: string; starts_at: string | null; ends_at: string | null; attributes: Record<string, unknown> }>();
  const cases = new Map<string, { request_id: string; session_id: string; participant_key: string; trainer_key: string; owner_key: string; attributes: Record<string, unknown> }>();
  const assignments = new Map<string, string | null>();
  const calls: string[] = [];
  const connection = {
    async query(sql: string, values: readonly unknown[] = []) {
      calls.push(sql);
      if (sql.startsWith('INSERT INTO workflow_requests')) {
        const id = String(values[0]);
        if (requests.has(id)) return result([], 0);
        requests.set(id, { requester_name: String(values[1]), source_team: values[2] as string | null, reason: String(values[3]), deadline_date: String(values[4]), attributes: JSON.parse(String(values[5])) });
        return result([], 1);
      }
      if (sql.startsWith('SELECT requester_name')) return result([requests.get(String(values[0]))!]);
      if (sql.startsWith('INSERT INTO workflow_sessions')) {
        const id = String(values[0]);
        if (!sessions.has(id)) sessions.set(id, { request_id: String(values[1]), starts_at: values[2] as string | null, ends_at: values[3] as string | null, attributes: JSON.parse(String(values[4])) });
        return result([], 1);
      }
      if (sql.startsWith('SELECT request_id, starts_at')) return result([sessions.get(String(values[0]))!]);
      if (sql.startsWith('INSERT INTO workflow_cases')) {
        const id = String(values[0]);
        if (!cases.has(id)) cases.set(id, { request_id: String(values[1]), session_id: String(values[2]), participant_key: String(values[3]), trainer_key: String(values[4]), owner_key: String(values[5]), attributes: JSON.parse(String(values[6])) });
        return result([], 1);
      }
      if (sql.startsWith('SELECT request_id, session_id')) return result([cases.get(String(values[0]))!]);
      if (sql.startsWith('INSERT INTO workflow_assignments')) {
        const key = [values[0], values[1], values[2]].join(':');
        if (!assignments.has(key)) assignments.set(key, values[3] as string | null);
        return result([], 1);
      }
      if (sql.startsWith('SELECT assignment_id')) {
        const key = [values[0], values[1], values[2]].join(':');
        return result(assignments.has(key) ? [{ assignment_id: '1', email_normalized: assignments.get(key) }] : []);
      }
      return result([], 1);
    },
    release() {},
  };
  const pool = { async connect() { return connection; }, async query() { return result(); }, async end() {} } as unknown as SqlPool;
  return { pool, calls };
}

test('request creation preserves origin fields and is idempotent for the same cases and sessions', async () => {
  const db = repositoryDb();
  const repository = new PostgresWorkflowRepository(db.pool);
  assert.deepEqual(await repository.createRequest(input, actor), { requestId: 'REQ-1', caseIds: ['CASE-1'], replayed: false });
  assert.deepEqual(await repository.createRequest(input, actor), { requestId: 'REQ-1', caseIds: ['CASE-1'], replayed: true });
  assert.equal(db.calls.filter(sql => sql.startsWith('INSERT INTO audit_events')).length, 1);
});

test('request ID cannot be reused with a changed deadline, case set, or malformed date', async () => {
  const repository = new PostgresWorkflowRepository(repositoryDb().pool);
  await repository.createRequest(input, actor);
  await assert.rejects(repository.createRequest({ ...input, deadlineDate: '2026-11-21' }, actor), WorkflowConflictError);
  await assert.rejects(repository.createRequest({ ...input, cases: [{ ...input.cases[0]!, caseId: 'CASE-2' }] }, actor), WorkflowConflictError);
  await assert.rejects(repository.createRequest({ ...input, cases: [{ ...input.cases[0]!, attributes: { topicId: 'TOPIC-2', targetLevel: 3 } }] }, actor), WorkflowConflictError);
  await assert.rejects(repository.createRequest({ ...input, cases: [{ ...input.cases[0]!, participantEmail: 'person@example.test' }] }, actor), WorkflowConflictError);
  await assert.rejects(repository.createRequest({ ...input, deadlineDate: '2026-02-31' }, actor), WorkflowInputError);
});

test('request creation rejects an owner key different from the authenticated Process & Quality actor before SQL', async () => {
  const db = repositoryDb();
  const repository = new PostgresWorkflowRepository(db.pool);
  await assert.rejects(repository.createRequest({
    ...input, cases: [{ ...input.cases[0]!, ownerKey: 'OTHER-OWNER' }],
  }, actor), /Case owner must match/);
  assert.equal(db.calls.length, 0);
});
