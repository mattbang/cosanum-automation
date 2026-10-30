const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const source = path.resolve(__dirname, '../src/workflow.ts');
const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const compiled = new Module(source, module);
compiled.filename = source;
compiled.paths = Module._nodeModulePaths(path.dirname(source));
compiled._compile(js, source);
const { attentionCases, catalogue, createRequest, deadlineLabel, demoStorageKey, demoWeekSlots, eligibility, futureDeadline, initialState, matrixEntry, matrixPeople, planningSessions, requestForCase, selectionAvailability, sessionCases, slotAvailable, trainerChoices, transition, upcomingSessions } = compiled.exports;
const requestInput = () => ({ requesterName: 'Person F', sourceTeam: 'CCS', reason: 'process_change', deadlineDate: futureDeadline(14) });

test('web demo progress is reused within a Zurich day and resets after local midnight', () => {
  const before = demoStorageKey(new Date('2026-10-28T22:59:00Z'));
  assert.equal(before, demoStorageKey(new Date('2026-10-28T09:00:00Z')));
  assert.notEqual(before, demoStorageKey(new Date('2026-10-28T23:01:00Z')));
});

test('home selectors group shared requests and sessions, and show actionable exceptions', () => {
  const state = initialState();
  assert.equal(catalogue.length, 5);
  assert.deepEqual(planningSessions(state).map(group => group[0].requestId), ['REQ-S']);
  assert.deepEqual(requestForCase(state, planningSessions(state)[0][0]), state.requests.find(request => request.id === 'REQ-S'));
  assert.equal(requestForCase(state, planningSessions(state)[0][0]).requesterName, 'Person D');
  assert.equal(requestForCase(state, planningSessions(state)[0][0]).sourceTeam, 'CCS');
  assert.equal(requestForCase(state, planningSessions(state)[0][0]).deadlineDate, futureDeadline(14));
  assert.deepEqual(upcomingSessions(state).map(group => group[0].sessionId), ['SES-G']);
  assert.equal(upcomingSessions(state)[0].length, 2);
  assert.deepEqual(attentionCases(state).map(entry => entry.id), ['CASE-H-1']);
});

test('catalogue eligibility rejects empty, dash, trainer level and invalid jumps', () => {
  assert.equal(eligibility('TC_R052', 'WOHNUNG', 1).eligible, false);
  assert.equal(eligibility('TC_R077', 'WOHNUNG', 1).eligible, false);
  assert.equal(eligibility('TC_R030', 'MATT', 1).eligible, false);
  assert.equal(eligibility('TC_R027', 'WOHNUNG', 3).eligible, false);
  assert.equal(eligibility('TC_R027', 'SUMNER', 1).eligible, true);
  assert.throws(() => createRequest(initialState(), 'TC_R052', ['WOHNUNG'], 1, 'group', 'MATT', requestInput()));
  assert.throws(() => createRequest(initialState(), 'TC_R030', ['WOHNUNG', 'SUMNER'], 1, 'single', 'MARIE', requestInput()));
  assert.deepEqual(trainerChoices('TC_R030', 'group', 1), ['MATT', 'MARIE']);
  assert.deepEqual(trainerChoices('TC_R030', 'group', 2), ['MATT']);
  assert.equal(createRequest(initialState(), 'TC_R030', ['WOHNUNG'], 1, 'group', 'MARIE', requestInput()).cases.at(-1).trainerKey, 'MARIE');
  assert.throws(() => createRequest(initialState(), 'TC_R030', ['WOHNUNG'], 1, 'group', 'UNKNOWN', requestInput()));
});

test('manual group request books one session with separate person cases', () => {
  const created = createRequest(initialState(), 'TC_R033', ['WOHNUNG', 'SUMNER'], 1, 'group', 'MATT', requestInput());
  const group = planningSessions(created).find(items => items[0].requestId === 'REQ-M-1');
  assert.equal(group.length, 2);
  assert.equal(sessionCases(created, group[0]).length, 2);
  assert.deepEqual(group.map(item => requestForCase(created, item)?.id), ['REQ-M-1', 'REQ-M-1']);
  assert.deepEqual(requestForCase(created, group[0]), { id: 'REQ-M-1', ...requestInput() });
  const booked = transition(created, group[0].id, 'book', 'SLOT-2');
  const members = sessionCases(booked, group[0]);
  assert.equal(new Set(members.map(item => item.eventId)).size, 1);
  assert.deepEqual(requestForCase(booked, members[0]), requestForCase(booked, members[1]));
  const assessed = transition(booked, members[0].id, 'fail');
  assert.equal(assessed.cases.find(item => item.id === members[1].id).status, 'invited');
});

test('manual request requires requester, reason and a real non-past Zurich deadline', () => {
  const base = initialState();
  const create = input => createRequest(base, 'TC_R030', ['WOHNUNG'], 1, 'single', 'MARIE', input);
  assert.throws(() => create({ ...requestInput(), requesterName: '  ' }), /Anfragende Person/);
  assert.throws(() => create({ ...requestInput(), reason: '' }), /Grund der Anfrage/);
  assert.throws(() => create({ ...requestInput(), deadlineDate: '' }), /Gewünschter Abschluss/);
  assert.throws(() => create({ ...requestInput(), deadlineDate: '2026-02-30' }), /gültiges Datum/);
  assert.throws(() => create({ ...requestInput(), deadlineDate: '2000-01-01' }), /Vergangenheit/);
  assert.equal(base.requests.length, 3);
  const created = create({ ...requestInput(), requesterName: '  Person F  ', sourceTeam: '  Leitstand  ' });
  assert.equal(created.requests.at(-1).requesterName, 'Person F');
  assert.equal(created.requests.at(-1).sourceTeam, 'Leitstand');
  assert.match(deadlineLabel(created.requests.at(-1).deadlineDate), /^\d{2}\.\d{2}\.\d{4}$/);
});

test('failed assessment creates one retraining case without changing old evidence', () => {
  const old = initialState().cases.find(item => item.id === 'CASE-H-1');
  const state = transition(initialState(), old.id, 'retry');
  const retained = state.cases.find(item => item.id === old.id);
  const next = state.cases.find(item => item.previousCaseId === old.id);
  assert.equal(retained.status, 'assessed');
  assert.equal(retained.trainerPassed, false);
  assert.equal(retained.eventId, old.eventId);
  assert.equal(retained.supersededByCaseId, next.id);
  assert.equal(next.status, 'planning');
  assert.equal(next.eventId, undefined);
  assert.equal(next.mode, 'single');
  assert.equal(next.requestId, old.requestId);
  assert.deepEqual(requestForCase(state, next), requestForCase(state, old));
  assert.equal(requestForCase(state, next).deadlineDate, requestForCase(initialState(), old).deadlineDate);
  assert.equal(attentionCases(state).some(item => item.id === old.id), false);
  assert.throws(() => transition(state, old.id, 'retry'));
});

test('decline opens a single replacement without changing the shared group booking', () => {
  const initial = initialState();
  const declined = transition(initial, 'CASE-G-2', 'decline');
  const retried = transition(declined, 'CASE-G-2', 'retry');
  const other = retried.cases.find(item => item.id === 'CASE-G-1');
  const old = retried.cases.find(item => item.id === 'CASE-G-2');
  const replacement = retried.cases.find(item => item.previousCaseId === old.id);
  assert.equal(other.eventId, 'DEMO-EVENT-SES-G');
  assert.equal(other.status, 'invited');
  assert.equal(old.declined, true);
  assert.equal(replacement.personKey, old.personKey);
  assert.equal(replacement.sessionId !== old.sessionId, true);
  assert.equal(replacement.requestId, old.requestId);
  assert.deepEqual(requestForCase(retried, replacement), requestForCase(retried, old));
  assert.equal(planningSessions(retried).some(group => group[0].id === replacement.id), true);
});

test('synthetic scheduling slots roll forward with the demo date', () => {
  const slots = initialState().slots.filter(slot => slot.id !== 'SLOT-OLD');
  assert.equal(slots.every(slot => Date.parse(slot.start) > Date.now()), true);
  assert.equal(slots.every(slot => slot.label.includes('Europe/Zurich')), true);
});

test('matrix keeps numeric levels, trainer qualification, dash and blank distinct', () => {
  assert.equal(matrixPeople.length, 4);
  assert.deepEqual(matrixEntry('TC_R030', 'WOHNUNG'), { kind: 'level', level: 0, label: 'Stufe 0' });
  assert.deepEqual(matrixEntry('TC_R030', 'MATT'), { kind: 'level', level: 4, label: 'Stufe 4 · Trainerqualifikation' });
  assert.equal(matrixEntry('TC_R052', 'WOHNUNG').kind, 'not_planned');
  assert.equal(matrixEntry('TC_R077', 'WOHNUNG').kind, 'missing');
  assert.match(eligibility('TC_R052', 'WOHNUNG', 1).reason, /nicht vorgesehen/);
  assert.match(eligibility('TC_R077', 'WOHNUNG', 1).reason, /Kein Matrixeintrag/);
});

test('week availability uses fixture busy actors and synthetic booked sessions per person', () => {
  const state = initialState();
  assert.equal(demoWeekSlots(state).length, 3);
  const booked = selectionAvailability(state, ['WOHNUNG'], 'MARIE', 'SLOT-1');
  assert.equal(booked.available, false);
  assert.equal(booked.actors.find(actor => actor.key === 'WOHNUNG').busy, true);
  assert.equal(booked.actors.find(actor => actor.key === 'MARIE').busy, false);
  assert.equal(selectionAvailability(state, ['WOHNUNG'], 'MATT', 'SLOT-2').available, true);
  assert.equal(selectionAvailability(state, ['WOHNUNG'], 'MARIE', 'SLOT-2').available, false);
  assert.equal(selectionAvailability(state, ['SUMNER'], 'MATT', 'SLOT-3').available, false);
  assert.equal(selectionAvailability(state, ['WOHNUNG'], 'MATT', 'SLOT-3').available, true);
  assert.equal(selectionAvailability(state, ['UNKNOWN'], 'MATT', 'SLOT-3').available, false);
  assert.equal(slotAvailable(state, state.cases.find(item => item.id === 'CASE-S-1'), 'SLOT-3'), true);
});
