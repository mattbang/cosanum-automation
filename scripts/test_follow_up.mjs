import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const headers = ['send_key','purpose','template_version','request_id','case_id','session_id','recipient_email','due_at_utc','attempted_at_utc','sent_at_utc','state','error_summary','demo_marker'];
const caseId = 'CASE-DEMO-SUMNER', sessionId = 'SES-DEMO-THEORY-SUMNER';
const ownerEmail = 'demo-owner@example.test', participantEmail = 'participant@example.test';
function sheet(initial = []) {
  return { rows: [headers, ...initial], getDataRange() { return { getValues: () => this.rows.map(row => [...row]) }; },
    appendRow(row) { this.rows.push([...row]); }, getRange(r, c) { return { setValues: values => { values[0].forEach((value, i) => { this.rows[r-1][c-1+i] = value; }); } }; } };
}
function setup() {
  const ledger = sheet([['ack_request:' + caseId + ':' + sessionId, 'acknowledgement_request', 3,
    'REQ-DEMO', caseId, sessionId, participantEmail, '2026-10-22T12:00:00Z',
    '2026-10-22T12:10:00Z', '2026-10-22T12:10:00Z', 'sent', '', '[DEMO]']]), actions = [];
  const tables = {
    Sessions: [{ session_id: sessionId, request_id: 'REQ-DEMO', status: 'invited', demo_marker: '[DEMO]', start_utc: '2026-10-22T11:00:00Z', end_utc: '2026-10-22T12:00:00Z' }],
    SessionCases: [{ session_id: sessionId, case_id: caseId, demo_marker: '[DEMO]' }],
    ParticipantAcknowledgements: [], MessageLedger: [], FollowUps: actions,
    TrainerAssessments: [{ session_id: sessionId, case_id: caseId, disposition: 'accepted', attendance: 'attended', assessment: 'passed', demo_marker: '[DEMO]' }]
  };
  const owner = { email: ownerEmail }, person = { person_key: 'SUMNER', email: participantEmail, display_alias: 'Selina Keller' };
  const context = { session: tables.Sessions[0], person, owner, personCase: { case_id: caseId }, request: { request_id: 'REQ-DEMO' }, topic: { display_name: 'Hochregallager' } };
  const form = { form_id: 'FORM-TEST', form_url: 'https://docs.google.com/forms/d/e/test/viewform', verified_at: '2026-10-22T12:05:00Z', verified_by: owner.email };
  const sent = [];
  const ctx = vm.createContext({ Date, Object, Array, Number, String, RegExp, Error, Set });
  for (const file of ['FormsIdentity.gs', 'NotificationTemplates.gs', 'FollowUp.gs']) vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), ctx);
  ctx.ScriptApp = { getOAuthToken: () => 'test-token' };
  ctx.UrlFetchApp = { fetch: url => ({ getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ formId: decodeURIComponent(url.split('/').at(-1)),
      settings: { emailCollectionType: 'VERIFIED' } }) }) };
  ctx.DEMO_SCHEMA = { sheets: { MessageLedger: headers } };
  ctx.SLOT_TIME_ZONE = 'Europe/Zurich';
  ctx.Utilities = { formatDate: date => new Date(date).toISOString().slice(0,10), parseDate: (value) => {
    const [date, time] = value.split(' '), [year,month,day] = date.split('-').map(Number), [hour,minute] = time.split(':').map(Number);
    return new Date(Date.UTC(year, month-1, day, hour - (day >= 25 ? 1 : 2), minute));
  }, getUuid: () => 'ACTION-1' };
  ctx.localDatePlusDays_ = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n*86400000).toISOString().slice(0,10);
  ctx.localDateTime_ = (date, minutes) => ctx.Utilities.parseDate(date + ' ' + String(Math.floor(minutes/60)).padStart(2,'0') + ':' + String(minutes%60).padStart(2,'0'));
  ctx.trainerCaseContext_ = () => context;
  ctx.participantAcknowledgementGate_ = () => ({ allowed: tables.TrainerAssessments[0].attendance === 'attended' && tables.TrainerAssessments[0].assessment === 'passed' });
  ctx.participantFormRow_ = () => form;
  ctx.assertParticipantFormAssignment_ = () => {};
  ctx.reconcileParticipantResponsesLocked_ = () => [];
  ctx.getPrivateFixture_ = () => ({ Topics: new Array(5), People: [['MATT', owner.email, '', '[DEMO]'], ['SUMNER', participantEmail, '', '[DEMO]']], Skills: new Array(20) });
  ctx.validateFixture_ = () => {};
  ctx.Session = { getEffectiveUser: () => ({ getEmail: () => owner.email }) };
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  ctx.SpreadsheetApp = { flush() {} };
  ctx.assertHeaders_ = (actual, expected) => assert.deepEqual(actual, expected);
  ctx.readDemoTables_ = () => ({ ...tables, MessageLedger: ledger.rows.slice(1).map(row => Object.fromEntries(headers.map((key, i) => [key, row[i]]))) });
  ctx.findDemoSpreadsheet_ = () => ({ getSheetByName: name => name === 'MessageLedger' ? ledger : { appendRow: row => actions.push({ action_id: row[0], case_id: row[1], session_id: row[2], action: row[4], note: row[5], demo_marker: row[8] }) } });
  const gateway = { sheet: ledger, remainingQuota: () => 100, verifyCalendar() {}, sendEmail: message => sent.push(message) };
  return { ctx, tables, context, form, ledger, actions, sent, gateway };
}

{
  const {ctx, sent, ledger, gateway} = setup();
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T06:59:00Z'), gateway).results.length, 0);
  const first = ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T07:00:00Z'), gateway);
  assert.equal(first.results[0].state, 'sent');
  assert.equal(first.rows[0].state, 'awaiting_acknowledgement');
  assert.equal(sent.length, 1); assert.equal(sent[0].to, participantEmail);
  assert.match(sent[0].subject, /^\[DEMO\] Erinnerung/);
  assert.match(sent[0].body, /22\.10\.2026/); assert.match(sent[0].body, /https:\/\/docs\.google\.com\/forms/);
  assert.match(sent[0].body, /keine reale Schulung stattgefunden/);
  ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T07:01:00Z'), gateway);
  assert.equal(sent.length, 1); assert.equal(ledger.rows.length, 3);
  const fifth = ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-27T08:00:00Z'), gateway);
  assert.equal(fifth.results[0].state, 'sent'); assert.equal(fifth.rows[0].state, 'open');
  assert.equal(sent.length, 2); assert.match(sent[1].subject, /Zweite Erinnerung/);
  ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-28T08:00:00Z'), gateway);
  assert.equal(sent.length, 2); assert.equal(ledger.rows.length, 4);
}
{
  const {ctx, tables, sent, gateway} = setup();
  tables.ParticipantAcknowledgements.push({ session_id: sessionId, case_id: caseId, disposition: 'accepted', demo_marker: '[DEMO]' });
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-27T08:00:00Z'), gateway).results.length, 0);
  assert.equal(sent.length, 0);
}
{
  const {ctx, sent, ledger, gateway} = setup();
  ledger.rows.splice(1, 1);
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:00:00Z'), gateway).results.length, 0,
    'do not remind before the initial acknowledgement request was delivered');
  assert.equal(sent.length, 0);
}
{
  const {ctx, sent, ledger, gateway} = setup();
  ledger.rows[1][9] = '2026-10-24T07:30:00Z';
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:00:00Z'), gateway).results.length, 0,
    'do not send a reminder immediately after a delayed initial request');
  assert.equal(sent.length, 0);
}
{
  const {ctx, tables, sent, gateway} = setup();
  ctx.reconcileParticipantResponsesLocked_ = () => {
    tables.ParticipantAcknowledgements.push({ session_id: sessionId, case_id: caseId, disposition: 'accepted', demo_marker: '[DEMO]' });
  };
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:00:00Z'), gateway).results.length, 0,
    'raw accepted Form response must suppress a reminder when its trigger was delayed');
  assert.equal(sent.length, 0);
}
{
  const {ctx, sent, gateway} = setup();
  ctx.reconcileParticipantResponsesLocked_ = () => { throw Error('Forms temporarily unavailable'); };
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:00:00Z'), gateway).results[0].state, 'blocked');
  assert.equal(sent.length, 0, 'Forms read failure must block the reminder');
}
{
  const {ctx, sent, gateway, ledger} = setup();
  const firstRun = ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-27T08:00:00Z'), gateway);
  assert.equal(firstRun.results.length, 1);
  assert.match(firstRun.results[0].key, /^ack_day_5:/);
  assert.equal(sent.length, 1); assert.equal(ledger.rows.length, 3);
}
for (const change of ['absent', 'cancelled']) {
  const {ctx, tables, sent, gateway} = setup();
  if (change === 'absent') tables.TrainerAssessments[0].attendance = 'absent';
  else tables.Sessions[0].status = 'cancelled';
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-27T08:00:00Z'), gateway).results.length, 0);
  assert.equal(sent.length, 0);
}
{
  const {ctx, sent, gateway, ledger} = setup();
  gateway.verifyCalendar = () => { throw Error('Calendar event cancelled'); };
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:00:00Z'), gateway).results[0].state, 'blocked');
  assert.equal(sent.length, 0); assert.equal(ledger.rows.length, 2);
}
{
  const {ctx, sent, ledger, gateway} = setup();
  gateway.sendEmail = () => { throw Error('connection uncertain'); };
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:00:00Z'), gateway).results[0].state, 'unknown');
  gateway.sendEmail = message => sent.push(message);
  ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:01:00Z'), gateway);
  assert.equal(sent.length, 0); assert.equal(ledger.rows.length, 3);
}
{
  const {ctx, sent, ledger, gateway} = setup();
  ledger.rows.push(['ack_day_2:' + caseId + ':' + sessionId,'acknowledgement_reminder_day_2',2,'REQ-DEMO',caseId,sessionId,
    participantEmail,'2026-10-24T07:00:00Z','2026-10-24T07:00:00Z','','reserved','','[DEMO]']);
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T09:00:00Z'), gateway).results[0].state, 'unknown');
  assert.equal(ledger.rows[2][10], 'unknown');
  ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T09:01:00Z'), gateway);
  assert.equal(sent.length, 0); assert.equal(ledger.rows.length, 3);
}
{
  const {ctx, sent, ledger, gateway} = setup();
  ledger.rows.push(['ack_day_2:' + caseId + ':' + sessionId,'acknowledgement_reminder_day_2',2,'REQ-DEMO',caseId,sessionId,
    participantEmail,'2026-10-24T07:00:00Z','2026-10-24T07:00:00Z','','reserved','','[DEMO]']);
  const result = ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-27T08:00:00Z'), gateway);
  assert.equal(ledger.rows[2][10], 'unknown'); assert.equal(result.recoveredUnknown.length, 1);
  assert.equal(result.results[0].state, 'sent'); assert.match(result.results[0].key, /^ack_day_5:/);
  assert.equal(sent.length, 1);
}
{
  const {ctx, sent, ledger, gateway} = setup();
  gateway.remainingQuota = () => 0;
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:00:00Z'), gateway).results[0].state, 'pending_quota');
  assert.equal(sent.length, 0); assert.equal(ledger.rows.length, 2);
}
{
  const {ctx, tables, gateway, sent, ledger, context} = setup();
  context.person.email = 'non-test@example.com';
  assert.equal(ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:00:00Z'), gateway).results[0].state, 'blocked');
  assert.equal(sent.length, 0); assert.equal(ledger.rows.length, 2);
}
{
  const {ctx, sent, gateway, actions} = setup();
  const open = ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-27T08:00:00Z'), gateway).rows[0];
  assert.equal(open.state, 'open'); assert.equal(sent.length, 1);
  // Persistent action row is separate from acknowledgement and skill evidence.
  actions.push({ case_id: caseId, session_id: sessionId, action: 'arrange_follow_up', note: 'Anruf geplant', demo_marker: '[DEMO]' });
  const queue = ctx.acknowledgementFollowUpQueue_(ctx.readDemoTables_(), new Date('2026-10-27T08:00:00Z'));
  assert.equal(queue[0].lastAction, 'arrange_follow_up'); assert.equal(queue[0].state, 'open');
}
{
  const {ctx, form, sent, gateway} = setup();
  form.verified_at = '';
  const result = ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-27T08:00:00Z'), gateway);
  assert.equal(result.results.length, 0); assert.equal(sent.length, 0);
  assert.equal(result.rows[0].state, 'open'); assert.equal(result.rows[0].formReady, false);
}
{
  const {ctx, sent, gateway} = setup();
  ctx.participantAcknowledgementGate_ = () => { throw Error('Forms API GET fehlgeschlagen'); };
  const queue = ctx.acknowledgementFollowUpQueue_(ctx.readDemoTables_(), new Date('2026-10-24T08:00:00Z'));
  assert.equal(queue[0].state, 'identity_blocked');
  assert.equal(queue[0].formReady, false);
  assert.throws(() => ctx.processAcknowledgementFollowUpsCore_(new Date('2026-10-24T08:00:00Z'), gateway),
    /Forms API GET fehlgeschlagen/);
  assert.equal(sent.length, 0);
}
console.log('Follow-up reminders: due dates, one send per day, gates, unknown delivery, quota, allowlist and open queue passed');
