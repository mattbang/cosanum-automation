import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('apps-script/Audit.gs', 'utf8');
const contract = JSON.parse(fs.readFileSync('contracts/current-task.v1.json', 'utf8'));
assert.equal(contract.schemaVersion, 1);
const projection = source.match(/\/\/ TASK_PROJECTION_START[^\n]*\n([\s\S]*?)\/\/ TASK_PROJECTION_END/);
assert.ok(projection, 'task projection is extractable without Google services');
const ctx = vm.createContext({});
vm.runInContext(projection[1], ctx);
const request = { requestId: 'REQ-1', plannedSessions: 1 };
const tables = { Sessions: [{ session_id: 'SES-1', request_id: 'REQ-1', trainer_key: 'TRAINER', demo_marker: '[DEMO]' }] };
const phase = overrides => ({ sessionId: 'SES-1', eventUrl: 'https://calendar.example.test/event', rsvp: 'accepted',
  trainerResponseId: 'TR-1', acknowledgementResponseId: 'ACK-1', ...overrides });
const person = overrides => ({ caseId: 'CASE-1', personKey: 'LEARNER', state: 'waiting', reasonCode: '',
  phases: [phase()], proofId: 'PROOF-1', archiveStatus: 'archived_verified', archiveVerifiedAt: '2026-10-27T00:00:00Z',
  skillStatus: 'applied', ...overrides });
const cases = [
  [person({ phases: [phase({ trainerResponseId: '' })] }), 'trainer_assessment', 'TRAINER'],
  [person({ phases: [phase({ acknowledgementResponseId: '' })] }), 'participant_acknowledgement', 'LEARNER'],
  [person({ reasonCode: 'declined', phases: [phase({ rsvp: 'declined' })] }), 'reschedule', 'MATT'],
  [person({ proofId: '' }), 'create_proof', 'MATT'],
  [person({ archiveStatus: 'created' }), 'archive_review', 'MATT'],
  [person({ skillStatus: '' }), 'skill_update', 'MATT'],
  [person({ state: 'complete' }), 'complete', 'LEARNER']
];
for (const [row, action, actor] of cases) {
  const before = JSON.stringify(row);
  const task = ctx.currentCaseTask_(tables, request, row);
  assert.equal(task.action, action);
  assert.equal(task.actorKey, actor);
  assert.equal(task.requestId, request.requestId);
  assert.equal(task.caseId, row.caseId);
  for (const key of contract.required) assert.ok(Object.hasOwn(task, key), `task has ${key}`);
  assert.ok(contract.actionEnum.includes(task.action));
  assert.ok(contract.stateEnum.includes(task.state));
  assert.equal(task.canExecute, false, 'projection never grants a write');
  assert.equal(JSON.stringify(row), before, 'projection does not change evidence');
}
const missingTrainer = ctx.currentCaseTask_({ Sessions: [] }, request, cases[0][0]);
assert.equal(missingTrainer.state, 'blocked');
assert.equal(missingTrainer.action, 'audit_review');
const duplicateTrainer = ctx.currentCaseTask_({ Sessions: [...tables.Sessions, ...tables.Sessions] }, request, cases[0][0]);
assert.equal(duplicateTrainer.state, 'blocked', 'duplicate trainer assignments do not select the first row');
const divergent = [cases[6][0], { ...cases[0][0], caseId: 'CASE-2', personKey: 'OTHER' }];
assert.equal(ctx.currentCaseTask_(tables, request, divergent[0]).state, 'complete');
assert.equal(ctx.currentCaseTask_(tables, request, divergent[1]).action, 'trainer_assessment');
const conflictingBooking = ctx.currentCaseTask_(tables, { ...request, bookedSessions: 1 }, person({ phases: [phase({ eventUrl: '' })] }));
assert.equal(conflictingBooking.state, 'blocked', 'booked row with missing event link needs review');
const invalidProof = ctx.currentCaseTask_(tables, request, person({ skillStatus: '', reason: 'Originalbelege weichen vom archivierten Nachweis ab.' }));
assert.equal(invalidProof.action, 'audit_review', 'uncategorized source mismatch blocks skill suggestion');
assert.equal(invalidProof.state, 'blocked');
const html = fs.readFileSync('apps-script/Index.html', 'utf8');
assert.match(html, /currentTaskLabel\(row\.currentTask\)/, 'Hub displays person-level task');
console.log('Current task projection: synthetic cases passed');
