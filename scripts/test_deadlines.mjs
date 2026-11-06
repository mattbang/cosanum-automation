import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ Date, Math, Set, Array, Number, String, Object, JSON, RegExp, Error,
  Utilities: { formatDate(date, zone) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } }
});
for (const file of ['Schema.gs', 'Deadlines.gs', 'Intake.gs']) vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), ctx);
const request = { request_id: 'REQ-1', status: 'draft', demo_marker: '[DEMO]' };
const person = id => ({ case_id: id, request_id: 'REQ-1', person_key: id, status: 'draft', demo_marker: '[DEMO]' });
const tables = { Requests: [request], ParticipantCases: [person('CASE-A'), person('CASE-B')], DeadlineChanges: [] };
const audit = { state: 'waiting', skillAppliedAt: '' };
const now = new Date('2026-11-15T12:00:00Z');
const uuid = n => '123e4567-e89b-42d3-a456-' + String(n).padStart(12, '0');
const command = (n, extra = {}) => ({ actionId: uuid(n), requestId: 'REQ-1', caseId: '', date: '2026-11-20', reference: 'Bedarfsanfrage',
  expectedRevision: 0, reason: 'Termin mit anfragender Person abgestimmt', ...extra });
const change = (n, extra = {}) => ctx.deadlineChange_(command(n, extra), tables, now, 'owner@example.test');
function append(n, extra = {}) { const result = change(n, extra); tables.DeadlineChanges.push(result.row); return result.row; }
function project(caseId = 'CASE-A', stamp = now, state = audit) {
  return ctx.deadlineCaseView_(request, tables.ParticipantCases.find(row => row.case_id === caseId), state, tables.DeadlineChanges, stamp);
}
ctx.proofUnique_ = (rows, predicate, label) => { const found = rows.filter(predicate); assert.equal(found.length, 1, label); return found[0]; };
ctx.auditCase_ = () => audit;

for (const invalid of ['', '2026-2-03', '2026-02-30', '2026-13-01', '2026-00-01', '2026-01-00', '2026-01-32', '2026-11-20T00:00:00Z', '=TODAY()', 20261120]) {
  assert.throws(() => ctx.deadlineDay_(invalid), /Frist/);
}
assert.equal(ctx.deadlineDay_('2028-02-29') - ctx.deadlineDay_('2028-02-28'), 1);
assert.equal(ctx.deadlineLocalDate_(new Date('2026-03-28T23:30:00Z')), '2026-03-29');
assert.equal(ctx.deadlineLocalDate_(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
assert.equal(project().state, 'unset');
append(1);
assert.equal(project().daysRemaining, 5);
assert.equal(project().state, 'upcoming');
assert.equal(project('CASE-A', new Date('2026-11-20T22:59:59Z')).state, 'due_today');
assert.equal(project('CASE-A', new Date('2026-11-20T23:00:00Z')).state, 'overdue');
assert.equal(project('CASE-A', new Date('2026-11-20T23:00:00Z')).daysOverdue, 1);

append(2, { caseId: 'CASE-A', date: '2026-11-15', reference: 'ONBOARDING@2', policyApproved: true });
assert.equal(project().date, '2026-11-15');
assert.equal(project().state, 'due_today');
assert.equal(project('CASE-B').date, '2026-11-20', 'group members keep distinct effective dates');
append(3, { caseId: 'CASE-A', date: '2026-11-25', reference: 'ONBOARDING@3', policyApproved: true, expectedRevision: 1 });
assert.equal(project().date, '2026-11-20', 'request date wins when the policy date is later');
assert.equal(project().policy.originalDate, '2026-11-15');
assert.equal(project().policy.history.length, 2);
append(4, { date: '2026-11-22', expectedRevision: 1, reason: 'Verschiebung freigegeben' });
assert.equal(project().request.originalDate, '2026-11-20');
assert.equal(project().request.date, '2026-11-22');
assert.equal(change(4, { date: '2026-11-22', expectedRevision: 1, reason: 'Verschiebung freigegeben' }).reused, true);
assert.throws(() => change(4, { date: '2026-11-23', expectedRevision: 1, reason: 'Verschiebung freigegeben' }), /anderen Änderung/);
assert.throws(() => change(5), /inzwischen geändert/);
assert.throws(() => change(5, { expectedRevision: 2, reason: '' }), /Änderungsgrund/);
assert.throws(() => change(5, { expectedRevision: 2, reference: '=IMPORTDATA("https://example.test")' }), /Quellenreferenz/);
assert.throws(() => change(5, { caseId: 'CASE-A', policyApproved: false }), /freigegebene Vorgabe/);
assert.throws(() => change(5, { caseId: 5 }), /Personenfall-ID/);
assert.throws(() => change(5, { caseId: 'CASE-OTHER', policyApproved: true }), /gehört nicht/);
assert.throws(() => change(5, { requestId: 'REQ-OTHER' }));

const before = JSON.stringify(tables);
const late = project('CASE-A', now, { state: 'complete', skillAppliedAt: '2026-11-23T23:30:00Z' });
assert.equal(late.state, 'completed_late');
assert.equal(late.daysLate, 2, 'completion uses the Zurich date, not the UTC date');
assert.equal(late.daysOverdue, 0);
assert.equal(project('CASE-A', now, { state: 'complete', skillAppliedAt: '2026-11-22T22:59:59Z' }).state, 'completed_on_time');
assert.equal(project('CASE-A', now, { state: 'complete', skillAppliedAt: '' }).state, 'completed_time_unknown');
assert.equal(project('CASE-A', new Date('2026-11-24T00:00:00Z'), { state: 'open', reason: 'Archive blocked' }).state, 'overdue');
assert.equal(JSON.stringify(tables), before, 'projection cannot change completion or source data');
tables.ParticipantCases[0].status = 'cancelled';
assert.equal(project().state, 'cancelled');
assert.equal(project().editable, false);
tables.ParticipantCases[0].status = 'exception_approved';
assert.equal(project().state, 'exception_approved');
assert.throws(() => change(5, { caseId: 'CASE-A', policyApproved: true, expectedRevision: 2 }), /behalten ihre Frist/);
tables.ParticipantCases[0].status = 'draft';
ctx.auditCase_ = () => ({ state: 'complete' });
assert.throws(() => change(5, { caseId: 'CASE-A', policyApproved: true, expectedRevision: 2 }), /behalten ihre Frist/);
ctx.auditCase_ = () => audit;

const laterChange = ctx.deadlineChange_(command(12, { expectedRevision: 2, date: '2026-12-30' }), tables, new Date('2026-11-25T12:00:00Z'), 'owner@example.test').row;
const laterHistory = [...tables.DeadlineChanges, laterChange];
const completedAt = { state: 'complete', skillAppliedAt: '2026-11-23T12:00:00Z' };
const frozen = ctx.deadlineCaseView_(request, tables.ParticipantCases[0], completedAt, laterHistory, new Date('2026-11-26T12:00:00Z'));
assert.equal(frozen.date, '2026-11-22');
assert.equal(frozen.state, 'completed_late', 'a later group reschedule cannot make a late completion appear on time');
assert.equal(ctx.deadlineCaseView_(request, tables.ParticipantCases[1], audit, laterHistory, now).date, '2026-12-30');

const view = { cases: tables.ParticipantCases.map(row => ({ caseId: row.case_id, ...audit })) };
ctx.deadlineRequestView_(tables, request, view, new Date('2026-11-23T12:00:00Z'));
assert.equal(view.deadline.overdueCount, 2);
assert.equal(view.cases[0].deadline.date, '2026-11-22');
const originalRevision = tables.DeadlineChanges[0].revision;
tables.DeadlineChanges[0].revision = 3;
assert.throws(() => project(), /widersprüchlich/);
tables.DeadlineChanges[0].revision = originalRevision;

let locked = false, ownerAllowed = true, readbackBroken = false, loseReceipt = false, writes = 0;
ctx.LockService = { getScriptLock: () => ({ waitLock() { assert(!locked); locked = true; }, releaseLock() { assert(locked); locked = false; } }) };
ctx.auditOwner_ = () => { assert(locked); if (!ownerAllowed) throw Error('Owner required'); return 'owner@example.test'; };
ctx.SpreadsheetApp = { flush() {} };
ctx.findDemoSpreadsheet_ = () => ({ getSheetByName: () => ({ appendRow(row) {
  assert(locked); writes++;
  tables.DeadlineChanges.push(Object.fromEntries(ctx.DEMO_SCHEMA.sheets.DeadlineChanges.map((key, i) => [key, row[i]])));
  if (loseReceipt) { loseReceipt = false; throw Error('Transport response lost after append'); }
} }) });
ctx.readDemoTables_ = () => {
  if (readbackBroken && writes >= 3) return { ...tables, DeadlineChanges: [] };
  return tables;
};
const stored = command(6, { date: '2026-12-01', expectedRevision: 2 });
assert.equal(ctx.saveRequestDeadline_(stored).revision, 3);
assert.equal(ctx.saveRequestDeadline_(stored).reused, true);
assert.equal(writes, 1);
ownerAllowed = false;
assert.throws(() => ctx.saveRequestDeadline_(command(7, { expectedRevision: 3 })), /Owner required/);
assert.equal(locked, false);
assert.equal(writes, 1);
ownerAllowed = true;
loseReceipt = true;
const uncertain = command(8, { date: '2026-12-02', expectedRevision: 3 });
assert.throws(() => ctx.saveRequestDeadline_(uncertain), /response lost/);
assert.equal(ctx.saveRequestDeadline_(uncertain).reused, true);
assert.equal(writes, 2, 'lost transport response does not duplicate the persisted change');
readbackBroken = true;
assert.throws(() => ctx.saveRequestDeadline_(command(9, { expectedRevision: 4 })), /nicht bestätigt/);
assert.equal(locked, false);
readbackBroken = false;
assert.equal(ctx.saveRequestDeadline_(command(9, { expectedRevision: 4 })).reused, true);

// Intake validates a malformed or unavailable initial deadline before writing a request.
assert.throws(() => ctx.saveDraftRequest_({ actionId: uuid(10), initialDeadline: { date: '2026-02-30', reference: 'Anfrage' } }), /Frist/);
ctx.appUuid_ = () => true;
ctx.findDemoSpreadsheet_ = () => ({ getSheetByName: () => null });
assert.throws(() => ctx.saveDraftRequest_({ actionId: uuid(10), initialDeadline: { date: '2026-11-20', reference: 'Anfrage' } }), /Fristregister fehlt/);

// Schema-12 read compatibility does not hide missing mandatory tabs.
vm.runInContext(fs.readFileSync('apps-script/SheetGateway.gs', 'utf8'), ctx);
let missingTab = 'DeadlineChanges';
ctx.findDemoSpreadsheet_ = () => ({ getSheetByName(name) {
  return name === missingTab ? null : { getDataRange: () => ({ getValues: () => [ctx.DEMO_SCHEMA.sheets[name]] }) };
} });
assert.equal(ctx.readDemoTables_().DeadlineChanges.length, 0);
missingTab = 'Requests';
assert.throws(() => ctx.readDemoTables_(), /Fehlendes Tabellenblatt: Requests/);
console.log('Pass: Zurich calendar days/DST, original sources, group deadlines, completion/dispositions, immutable history, optimistic revisions, owner gate, readback and retry.');
