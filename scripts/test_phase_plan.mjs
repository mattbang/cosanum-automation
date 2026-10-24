import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture = JSON.parse(fs.readFileSync('data/demo_fixture.json', 'utf8'));
const headers = {
  Topics: ['topic_id','display_name','source_material','theory_required','practice_required','theory_minutes','practice_minutes','group_suitability','progression_rule','demo_marker','configured_target_level'],
  People: ['person_key','email','demo_role','demo_marker','persona_id','display_alias'],
  Skills: ['person_key','topic_id','skill_level','status_mark','demo_marker'],
  Requests: ['request_id','action_id','topic_id','target_level','status','created_at','demo_marker','mode'],
  ParticipantCases: ['case_id','request_id','person_key','current_level','target_level','status','created_at','demo_marker'],
  Sessions: ['session_id','request_id','phase','phase_order','mode','trainer_key','duration_minutes','theory_session_id','status','created_at','demo_marker'],
  SessionCases: ['session_id','case_id','request_id','person_key','demo_marker']
};
const rows = { ...fixture, Requests: [], ParticipantCases: [], Sessions: [], SessionCases: [] };
const objects = name => rows[name].map(row => Object.fromEntries(headers[name].map((h, i) => [h, row[i] ?? ''])));
const sheets = Object.fromEntries(Object.keys(rows).map(name => [name, {
  getLastRow: () => rows[name].length + 1,
  getDataRange: () => ({ getValues: () => [headers[name], ...rows[name]] }),
  getRange: (row, col) => ({
    setValues: values => rows[name].push(...values),
    setValue: value => { rows[name][row - 2][col - 1] = value; }
  }),
  appendRow: value => rows[name].push(value),
  getSheetId: () => 123
}]));
const spreadsheet = { getSheetByName: name => sheets[name] };
const context = vm.createContext({
  console, Set, Date,
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  SpreadsheetApp: { flush: () => {} },
  findDemoSpreadsheet_: () => spreadsheet,
  demoSheetLink_: () => 'https://example.invalid/',
  readDemoTables_: () => Object.fromEntries(Object.keys(rows).map(name => [name, objects(name)]))
});
for (const file of ['Catalogue.gs', 'Intake.gs', 'PhasePlan.gs']) vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), context);
const id = n => `123e4567-e89b-42d3-a456-42661417400${n}`;
const draft = (topicId, targetLevel, personKeys, n) => context.saveDraftRequest({ topicId, targetLevel, personKeys, actionId: id(n) });

const one = draft('TC_R030', 1, ['WOHNUNG'], 1);
const oneGroup = context.getPhasePlanPreview(one.requestId, 'group');
assert.deepEqual(Array.from(oneGroup.phases.map(p => p.durationMinutes)), [60, 180]);
assert.equal(oneGroup.phases[0].trainerKey, 'MATT');
assert.deepEqual(Array.from(oneGroup.phases[0].trainerChoices.map(t => t.key)), ['MATT', 'MARIE']);
assert.equal(oneGroup.phases[1].mode, 'individual');
assert.equal(oneGroup.phases[1].theorySessionId, oneGroup.phases[0].sessionId);
assert.deepEqual(Array.from(oneGroup.phases[1].trainerChoices.map(t => t.key)), ['MARIE']);
assert.equal(context.canCompleteTargetLevel_(oneGroup, [oneGroup.phases[1].sessionId], one.cases[0].caseId), false);
assert.equal(context.canCompleteTargetLevel_(oneGroup, oneGroup.phases.map(p => p.sessionId), one.cases[0].caseId), true);
const trainers = { [oneGroup.phases[1].sessionId]: 'MARIE' };
assert.equal(context.savePhasePlan({ requestId: one.requestId, mode: 'group', trainers }).reused, false);
assert.equal(context.savePhasePlan({ requestId: one.requestId, mode: 'group', trainers }).reused, true);
assert.equal(rows.Sessions.length, 2);
assert.equal(rows.SessionCases.length, 2);
assert.equal(rows.Requests[0][7], 'group');
assert.equal(context.saveDraftRequest({ topicId: 'TC_R030', targetLevel: 1, personKeys: ['WOHNUNG'], actionId: id(1) }).mode, 'group');
const missingLink = rows.SessionCases.pop();
assert.equal(context.savePhasePlan({ requestId: one.requestId, mode: 'group', trainers }).reused, false);
assert.equal(rows.Sessions.length, 2);
assert.equal(rows.SessionCases.length, 2);
assert.equal(rows.SessionCases[1][0], missingLink[0]);
assert.throws(() => context.savePhasePlan({ requestId: one.requestId, mode: 'individual', trainers }), /anderen Modus/);

const singleGroup = draft('TC_R030', 1, ['WOHNUNG'], 5);
const singlePlan = context.getPhasePlanPreview(singleGroup.requestId, 'group');
const singleTrainers = Object.fromEntries(singlePlan.phases.map(p => [p.sessionId, 'MARIE']));
assert.throws(() => context.savePhasePlan({ requestId: singleGroup.requestId, mode: 'group', trainers: { [singlePlan.phases[0].sessionId]: 'WOHNUNG', [singlePlan.phases[1].sessionId]: 'MARIE' } }), /Kein zulässiger Trainer/);
const singleSaved = context.savePhasePlan({ requestId: singleGroup.requestId, mode: 'group', trainers: singleTrainers });
assert(singleSaved.plan.phases.every(p => p.trainerKey === 'MARIE'));
assert.equal(context.savePhasePlan({ requestId: singleGroup.requestId, mode: 'group', trainers: singleTrainers }).reused, true);
assert.equal(rows.Requests.find(r => r[0] === singleGroup.requestId)[7], 'group');

const r027 = draft('TC_R027', 2, ['WOHNUNG'], 2);
const unqualified = context.getPhasePlanPreview(r027.requestId, 'individual');
assert.equal(unqualified.phases[0].trainerChoices.length, 0);
assert.throws(() => context.savePhasePlan({ requestId: r027.requestId, mode: 'individual', trainers: {} }), /Kein qualifizierter/);

const theoryOnly = draft('TC_R052', 1, ['SUMNER'], 3);
const theoryPlan = context.getPhasePlanPreview(theoryOnly.requestId, 'group');
assert.equal(theoryPlan.phases.length, 1);
assert.equal(theoryPlan.phases[0].durationMinutes, 60);
assert.equal(context.savePhasePlan({ requestId: theoryOnly.requestId, mode: 'group', trainers: {} }).plan.phases.length, 1);

// Use a test-only synthetic correction to give two people the same eligible target.
fixture.Skills.find(row => row[0] === 'SUMNER' && row[1] === 'TC_R030')[2] = 0;
const group = draft('TC_R030', 1, ['WOHNUNG', 'SUMNER'], 4);
const groupPlan = context.getPhasePlanPreview(group.requestId, 'group');
assert.equal(groupPlan.phases.length, 3);
assert.equal(groupPlan.phases[0].mode, 'group');
assert.equal(groupPlan.phases[0].caseIds.length, 2);
assert.deepEqual(Array.from(groupPlan.phases[0].trainerChoices.map(t => t.key)), ['MATT']);
assert.throws(() => context.savePhasePlan({ requestId: group.requestId, mode: 'group', trainers: { [groupPlan.phases[0].sessionId]: 'MARIE' } }), /Unbekannte Trainerzuordnung/);
assert.equal(groupPlan.phases.filter(p => p.phase === 'practice').length, 2);
assert(groupPlan.phases.filter(p => p.phase === 'practice').every(p => p.theorySessionId === groupPlan.phases[0].sessionId));
const groupTrainers = Object.fromEntries(groupPlan.phases.filter(p => p.mode === 'individual').map(p => [p.sessionId, 'MARIE']));
context.savePhasePlan({ requestId: group.requestId, mode: 'group', trainers: groupTrainers });
assert.equal(rows.SessionCases.filter(row => row[2] === group.requestId).length, 4);
assert.equal(rows.Sessions.filter(row => row[1] === group.requestId).length, 3);
console.log('Pass: one-person group trainer choice, fixed multi-person group trainer, per-person practice links, 60/180 minutes, theory gate, and idempotent saves.');
