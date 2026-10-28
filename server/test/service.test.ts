import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionError, WorkflowService, type Snapshot, type WorkflowGateway } from '../src/service.ts';

function fixture() {
  const row: Snapshot = {
    scope: { requestId: 'REQ-1', sessionId: 'SES-1', caseId: 'CASE-1' },
    personKey: 'LEARNER', trainerKey: 'TRAINER', ownerKey: 'OWNER', revision: '1',
    evidence: { facts: { sessionPlanned: true, slotAvailable: true, calendarError: false, slotConflict: false, changedEvent: false }, values: {} },
  };
  let current = row;
  let writes = 0;
  const gateway: WorkflowGateway = {
    async load() { return current; },
    async execute(_action, before) {
      assert.equal(before.revision, current.revision, 'conditional write uses fresh revision');
      writes++;
      current = { ...current, revision: '2', evidence: { facts: { ...current.evidence.facts, eventVerified: true, receiptSaved: true }, values: {} } };
    },
  };
  const identity = { actorKey: 'OWNER', role: 'process_quality' as const, verifiedEmail: 'owner@example.test' };
  const service = new WorkflowService({ async authenticate(token) { return token === 'valid' ? identity : null; } }, gateway);
  return { service, get writes() { return writes; }, setCurrent(value: Snapshot) { current = value; }, row };
}

test('rejects unverified caller and wrong assignment before any write', async () => {
  const testCase = fixture();
  await assert.rejects(testCase.service.act('invalid', { actionId: 'bookSession', caseId: 'CASE-1' }), (error: unknown) => error instanceof ActionError && error.status === 401);
  testCase.setCurrent({ ...testCase.row, ownerKey: 'OTHER' });
  await assert.rejects(testCase.service.act('valid', { actionId: 'bookSession', caseId: 'CASE-1' }), (error: unknown) => error instanceof ActionError && error.status === 403);
  assert.equal(testCase.writes, 0);
});

test('ignores client facts and fails closed when server evidence is missing', async () => {
  const testCase = fixture();
  testCase.setCurrent({ ...testCase.row, evidence: { facts: { ...testCase.row.evidence.facts, slotAvailable: false }, values: {} } });
  await assert.rejects(testCase.service.act('valid', { actionId: 'bookSession', caseId: 'CASE-1', payload: { facts: { slotAvailable: true } } }), (error: unknown) => error instanceof ActionError && error.status === 409);
  assert.equal(testCase.writes, 0);
});

test('reports verified result only after same-scope persisted readback', async () => {
  const testCase = fixture();
  const result = await testCase.service.act('valid', { actionId: 'bookSession', caseId: 'CASE-1' });
  assert.deepEqual(result, { status: 'verified', actionId: 'bookSession', caseId: 'CASE-1', revision: '2' });
  assert.equal(testCase.writes, 1);
});
