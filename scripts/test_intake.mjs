import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture = JSON.parse(fs.readFileSync('fixtures/synthetic_demo.json', 'utf8'));
const topicHeaders = ['topic_id','display_name','source_material','theory_required','practice_required','theory_minutes','practice_minutes','group_suitability','progression_rule','demo_marker','configured_target_level'];
const personHeaders = ['person_key','email','demo_role','demo_marker','persona_id','display_alias'];
const skillHeaders = ['person_key','topic_id','skill_level','status_mark','demo_marker'];
const requestHeaders = ['request_id','action_id','topic_id','target_level','status','created_at','demo_marker'];
const caseHeaders = ['case_id','request_id','person_key','current_level','target_level','status','created_at','demo_marker'];
const objects = (headers, rows) => rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
const rows = { Requests: [], ParticipantCases: [], DeadlineChanges: [] };
const sheets = Object.fromEntries(['Requests','ParticipantCases','DeadlineChanges'].map(name => [name, {
  getLastRow: () => rows[name].length + 1,
  getRange: () => ({ setValues: values => rows[name].push(...values) }),
  appendRow: value => rows[name].push(value)
}]));
sheets.Skills = { getSheetId: () => 123456789 };
const context = vm.createContext({
  console, Set, Date,
  Utilities: { formatDate: date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) },
  appUuid_: value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value),
  auditOwner_: () => 'owner@example.test', auditCase_: () => ({ state: 'waiting' }),
  proofUnique_: (items, predicate) => { const matches = items.filter(predicate); if (matches.length !== 1) throw Error('Not unique'); return matches[0]; },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  SpreadsheetApp: { flush: () => {} },
  findDemoSpreadsheet_: () => ({ getSheetByName: name => sheets[name] }),
  demoSheetLink_: (_book, _sheet, row) => 'https://example.invalid/#range=C' + row,
  readDemoTables_: () => ({
    Topics: objects(topicHeaders, fixture.Topics), People: objects(personHeaders, fixture.People),
    Skills: objects(skillHeaders, fixture.Skills), Requests: objects(requestHeaders, rows.Requests),
    ParticipantCases: objects(caseHeaders, rows.ParticipantCases), DeadlineChanges: objects(context.DEMO_SCHEMA.sheets.DeadlineChanges, rows.DeadlineChanges)
  })
});
for (const file of ['Schema.gs', 'Deadlines.gs', 'Intake.gs']) vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), context);
const preview = (topicId, targetLevel, personKey) => context.getIntakePreview_({ topicId, targetLevel, personKeys: [personKey] }).rows[0];
assert.equal(preview('TC_R030', 1, 'WOHNUNG').allowed, true);
assert.equal(preview('TC_R030', 1, 'WOHNUNG').personAlias, fixture.People.find(row => row[0] === 'WOHNUNG')[5]);
assert.equal(preview('TC_R030', 2, 'SUMNER').allowed, true);
assert.equal(preview('TC_R030', 2, 'WOHNUNG').allowed, false);
assert.match(preview('TC_R030', 2, 'WOHNUNG').reason, /Übersprungene/);
assert.equal(preview('TC_R030', 3, 'SUMNER').allowed, false);
assert.match(preview('TC_R030', 3, 'SUMNER').reason, /Übersprungene/);
assert.match(preview('TC_R052', 1, 'WOHNUNG').reason, /nicht vorgesehen/);
assert.match(preview('TC_R077', 1, 'WOHNUNG').reason, /leer oder unbekannt/);
assert.equal(preview('TC_R033', 1, 'WOHNUNG').allowed, true);
assert.equal(preview('TC_R033', 2, 'WOHNUNG').allowed, false);
assert.equal(preview('TC_R052', 1, 'SUMNER').allowed, true);
const correction = fixture.Skills.find(row => row[0] === 'WOHNUNG' && row[1] === 'TC_R052');
correction[2] = 0;
assert.equal(preview('TC_R052', 1, 'WOHNUNG').allowed, true);
correction[2] = '–';
const input = { topicId: 'TC_R030', targetLevel: 1, personKeys: ['WOHNUNG'], actionId: '123e4567-e89b-42d3-a456-426614174000' };
const first = context.saveDraftRequest_(input), second = context.saveDraftRequest_(input);
assert.equal(first.reused, false);
assert.equal(second.reused, true);
assert.equal(first.requestId, second.requestId);
assert.equal(first.requestNo, 1);
assert.equal(second.requestNo, 1);
assert.equal(first.cases[0].caseId, second.cases[0].caseId);
assert.equal(rows.Requests.length, 1);
assert.equal(rows.ParticipantCases.length, 1);
assert.throws(() => context.saveDraftRequest_({ ...input, personKeys: ['SUMNER'] }), /anderen Entwurf/);
const secondPerson = fixture.Skills.find(row => row[0] === 'SUMNER' && row[1] === 'TC_R030');
secondPerson[2] = 0;
const group = { topicId: 'TC_R030', targetLevel: 1, personKeys: ['WOHNUNG', 'SUMNER'], actionId: '123e4567-e89b-42d3-a456-426614174001' };
const groupSaved = context.saveDraftRequest_(group);
assert.equal(groupSaved.requestNo, 2);
assert.equal(groupSaved.cases.length, 2);
assert.notEqual(groupSaved.cases[0].caseId, groupSaved.cases[1].caseId);
assert.equal(context.saveDraftRequest_(group).reused, true);
assert.equal(rows.Requests.length, 2);
assert.equal(rows.ParticipantCases.length, 3);
rows.Requests.length = 9999;
assert.throws(() => context.saveDraftRequest_({ ...group, actionId: '123e4567-e89b-42d3-a456-426614174002' }), /Nummernraum/i);
rows.Requests.length = 2;
const withDeadline = { ...input, actionId: '123e4567-e89b-42d3-a456-426614174003', initialDeadline: { date: '2026-11-20', reference: 'Bedarfsanfrage #66' } };
const deadlineRequest = context.saveDraftRequest_(withDeadline);
assert.equal(deadlineRequest.requestNo, 3);
assert.equal(rows.DeadlineChanges.length, 1);
assert.equal(rows.DeadlineChanges[0][1], deadlineRequest.requestId);
assert.equal(rows.DeadlineChanges[0][4], '2026-11-20');
assert.equal(context.saveDraftRequest_(withDeadline).reused, true);
assert.equal(rows.DeadlineChanges.length, 1);
assert.throws(() => context.saveDraftRequest_({ ...withDeadline, initialDeadline: { ...withDeadline.initialDeadline, date: '2026-11-21' } }), /anderen Änderung/);
const countBefore = rows.Requests.length;
assert.throws(() => context.saveDraftRequest_({ ...withDeadline, actionId: '123e4567-e89b-42d3-a456-426614174004', initialDeadline: { date: '2026-02-30', reference: 'Anfrage' } }), /Frist/);
assert.equal(rows.Requests.length, countBefore, 'invalid initial deadline never creates a request');
const retryDeadline = { ...withDeadline, actionId: '123e4567-e89b-42d3-a456-426614174005' };
const appendDeadline = sheets.DeadlineChanges.appendRow;
sheets.DeadlineChanges.appendRow = value => { appendDeadline(value); throw Error('Receipt lost after initial deadline append'); };
assert.throws(() => context.saveDraftRequest_(retryDeadline), /Receipt lost/);
const requestsAfterFailure = rows.Requests.length, casesAfterFailure = rows.ParticipantCases.length;
sheets.DeadlineChanges.appendRow = appendDeadline;
assert.equal(context.saveDraftRequest_(retryDeadline).reused, true);
assert.equal(rows.Requests.length, requestsAfterFailure);
assert.equal(rows.ParticipantCases.length, casesAfterFailure);
assert.equal(rows.DeadlineChanges.length, 2, 'partial intake retry reuses the initial deadline');
console.log('Pass: next-level and blocked rules, explicit target, stable four-digit order numbers, and duplicate retry.');
