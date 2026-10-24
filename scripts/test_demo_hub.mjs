import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('apps-script/Index.html', 'utf8');
const formatter = html.match(/function requestCode\(id\)\{[^\n]+\}/);
assert.ok(formatter, 'a short request label is available');
const labels = vm.createContext({});
vm.runInContext('var auditRequests=[];\n' + formatter[0], labels);
const firstRequest = 'REQ-123E4567-E89B-42D3-A456-426614174001';
const secondRequest = 'REQ-123E4567-9999-42D3-A456-426614174002';
assert.equal(labels.requestCode(firstRequest), 'A-123E4567');
labels.auditRequests = [{ requestId: firstRequest }, { requestId: secondRequest }];
assert.equal(labels.requestCode(firstRequest), 'A-123E4567E89B');
assert.equal(labels.requestCode(secondRequest), 'A-123E45679999');
assert.equal(labels.requestCode('REQ-GROUP'), 'REQ-GROUP');
assert.match(html, /new Option\(row\.topicName\+' · '\+requestCode\(row\.requestId\)\+' · '\+hubStatusLabel\(row\),row\.requestId\)/, 'picker displays the short label but submits the full request ID');
assert.match(html, /requestTechnicalValue'\)\.textContent=request\?request\.requestId/, 'the complete ID stays available for support');
const pure = html.match(/\/\/ UX1_PURE_START[^\n]*\n([\s\S]*?)\/\/ UX1_PURE_END/);
assert.ok(pure, 'the display model is available to test without Google');
const model = vm.createContext({});
vm.runInContext(pure[1], model);
const phase = (overrides = {}) => ({ rsvp: 'accepted', trainerResponseId: 'TR-1',
  acknowledgementResponseId: 'ACK-1', ...overrides });
const person = (state, overrides = {}) => ({ state, reasonCode: '', phases: [phase()],
  proofId: 'PROOF-1', archiveStatus: 'archived_verified', archiveVerifiedAt: '2026-10-24T10:00:00Z',
  skillStatus: state === 'complete' ? 'applied' : '', ...overrides });
const group = { requestId: 'REQ-GROUP', plannedSessions: 1, bookedSessions: 1,
  cases: [person('complete'), person('open', { reasonCode: 'acknowledgement_overdue',
    phases: [phase({ acknowledgementResponseId: '' })], proofId: '', archiveStatus: '', archiveVerifiedAt: '' })] };
const before = JSON.stringify(group);
assert.equal(model.hubNextTask(group), 'followup');
assert.equal(model.hubProgress(group).booking, true);
assert.equal(model.hubProgress(group).participant, false);
assert.equal(model.hubProgress(group).skill, false);
assert.equal(group.cases[0].state, 'complete');
assert.equal(group.cases[1].state, 'open', 'one group booking keeps separate person status');
assert.equal(JSON.stringify(group), before, 'view model never mutates persisted rows');
assert.equal(model.hubNextTask(null), 'intake');
assert.equal(model.hubNextTask({ plannedSessions: 0, cases: [] }), 'plan');
assert.equal(model.hubNextTask({ plannedSessions: 2, bookedSessions: 1, cases: [] }), 'booking');
assert.equal(model.hubNextTask({ ...group, cases: [person('complete'), person('complete')] }), 'register');
assert.equal(model.hubNextTask({ ...group, state: 'complete', cases: [person('complete', { phases: [phase({ rsvp: '' })] })] }), 'register', 'a completed case does not return to RSVP');
assert.equal(model.hubNextTask({ ...group, cases: [person('open', { reasonCode: 'archive_error' })] }), 'proof');
assert.equal(model.hubNextTask({ ...group, cases: [person('waiting', { phases: [phase({ trainerResponseId: '', acknowledgementResponseId: '' })] })] }), 'trainer');
const stepHandler = html.match(/button\.addEventListener\('click',function\(\)\{setTask\(def\.id\)\}\)/);
assert.ok(stepHandler, 'stepper clicks only change the selected view');
const setTask = html.match(/function setTask\(id\)\{([\s\S]*?)\n\}/);
assert.ok(setTask);
assert.doesNotMatch(setTask[1], /google\.script\.run|saveDraftRequest|bookSelectedSlot|applyVerified|processVerified/, 'navigation makes no Google write');

// A saved plan can be reconstructed after refresh without calling savePhasePlan.
const tables = {
  Requests: [{ request_id: 'REQ-GROUP', mode: 'group', demo_marker: '[DEMO]' }],
  ParticipantCases: [
    { case_id: 'CASE-A', request_id: 'REQ-GROUP', person_key: 'A', demo_marker: '[DEMO]' },
    { case_id: 'CASE-B', request_id: 'REQ-GROUP', person_key: 'B', demo_marker: '[DEMO]' }
  ],
  Sessions: [{ session_id: 'SES-THEORY', request_id: 'REQ-GROUP', phase: 'theory', phase_order: 1,
    mode: 'group', trainer_key: 'MATT', duration_minutes: 60, theory_session_id: '',
    calendar_event_id: 'EVENT-1', calendar_event_url: 'https://calendar.google.com/example',
    start_utc: '2026-10-26T10:00:00Z', end_utc: '2026-10-26T11:00:00Z', demo_marker: '[DEMO]' }],
  SessionCases: [
    { session_id: 'SES-THEORY', request_id: 'REQ-GROUP', case_id: 'CASE-A', person_key: 'A', demo_marker: '[DEMO]' },
    { session_id: 'SES-THEORY', request_id: 'REQ-GROUP', case_id: 'CASE-B', person_key: 'B', demo_marker: '[DEMO]' }
  ]
};
const source = fs.readFileSync('apps-script/PhasePlan.gs', 'utf8');
let writes = 0;
const server = vm.createContext({ readDemoTables_: () => tables, auditOwner_: () => {}, Set,
  SpreadsheetApp: { flush: () => { writes++; } }, findDemoSpreadsheet_: () => { writes++; throw Error('write path'); } });
vm.runInContext(source, server);
const recovered = server.getSavedPhasePlan('REQ-GROUP');
assert.equal(recovered.phases.length, 1);
assert.equal(recovered.phases[0].eventId, 'EVENT-1');
assert.equal(recovered.phases[0].personKeys.length, 2);
assert.equal(writes, 0);
assert.throws(() => server.getSavedPhasePlan('OTHER'), /nicht eindeutig/);
console.log('Demo Hub model and read-only resume checks passed');
