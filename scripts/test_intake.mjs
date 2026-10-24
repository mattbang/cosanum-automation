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
const rows = { Requests: [], ParticipantCases: [] };
const sheets = Object.fromEntries(['Requests','ParticipantCases'].map(name => [name, {
  getLastRow: () => rows[name].length + 1,
  getRange: () => ({ setValues: values => rows[name].push(...values) }),
  appendRow: value => rows[name].push(value)
}]));
sheets.Skills = { getSheetId: () => 123456789 };
const context = vm.createContext({
  console, Set, Date,
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  SpreadsheetApp: { flush: () => {} },
  findDemoSpreadsheet_: () => ({ getSheetByName: name => sheets[name] }),
  demoSheetLink_: (_book, _sheet, row) => 'https://example.invalid/#range=C' + row,
  readDemoTables_: () => ({
    Topics: objects(topicHeaders, fixture.Topics), People: objects(personHeaders, fixture.People),
    Skills: objects(skillHeaders, fixture.Skills), Requests: objects(requestHeaders, rows.Requests),
    ParticipantCases: objects(caseHeaders, rows.ParticipantCases)
  })
});
vm.runInContext(fs.readFileSync('apps-script/Intake.gs', 'utf8'), context);
const preview = (topicId, targetLevel, personKey) => context.getIntakePreview({ topicId, targetLevel, personKeys: [personKey] }).rows[0];
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
const first = context.saveDraftRequest(input), second = context.saveDraftRequest(input);
assert.equal(first.reused, false);
assert.equal(second.reused, true);
assert.equal(first.requestId, second.requestId);
assert.equal(first.cases[0].caseId, second.cases[0].caseId);
assert.equal(rows.Requests.length, 1);
assert.equal(rows.ParticipantCases.length, 1);
assert.throws(() => context.saveDraftRequest({ ...input, personKeys: ['SUMNER'] }), /anderen Entwurf/);
const secondPerson = fixture.Skills.find(row => row[0] === 'SUMNER' && row[1] === 'TC_R030');
secondPerson[2] = 0;
const group = { topicId: 'TC_R030', targetLevel: 1, personKeys: ['WOHNUNG', 'SUMNER'], actionId: '123e4567-e89b-42d3-a456-426614174001' };
const groupSaved = context.saveDraftRequest(group);
assert.equal(groupSaved.cases.length, 2);
assert.notEqual(groupSaved.cases[0].caseId, groupSaved.cases[1].caseId);
assert.equal(context.saveDraftRequest(group).reused, true);
assert.equal(rows.Requests.length, 2);
assert.equal(rows.ParticipantCases.length, 3);
console.log('Pass: next-level and blocked rules, explicit target, live reread, stable draft IDs and duplicate retry.');
