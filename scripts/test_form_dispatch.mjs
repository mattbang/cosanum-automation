import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const headers = ['send_key','purpose','template_version','request_id','case_id','session_id','recipient_email','due_at_utc','attempted_at_utc','sent_at_utc','state','error_summary','demo_marker'];
const end = '2026-10-24T12:00:00Z';
function setup() {
  const owner = 'owner@example.test', trainer = 'trainer@example.test', person = 'participant@example.test';
  const session = { session_id: 'SES-1', request_id: 'REQ-1', status: 'invited', phase: 'theory',
    start_utc: '2026-10-24T11:00:00Z', end_utc: end, demo_marker: '[DEMO]' };
  const context = { session, personCase: { case_id: 'CASE-1' }, person: { person_key: 'P', email: person, display_alias: 'Alex' },
    trainer: { person_key: 'T', email: trainer, display_alias: 'Daniel' }, owner: { email: owner },
    request: { request_id: 'REQ-1' }, topic: { display_name: 'Lagerregal' } };
  const trainerForm = { form_id: 'TF-1', form_url: 'https://docs.google.com/forms/d/e/trainer/viewform',
    session_id: 'SES-1', case_id: 'CASE-1', person_key: 'P', trainer_key: 'T', trainer_email: trainer,
    verified_at: end, demo_marker: '[DEMO]' };
  const participantForm = { form_id: 'PF-1', form_url: 'https://docs.google.com/forms/d/e/participant/viewform',
    session_id: 'SES-1', case_id: 'CASE-1', verified_at: end, demo_marker: '[DEMO]' };
  const ledger = { rows: [headers], getDataRange() { return { getValues: () => this.rows.map(row => [...row]) }; },
    appendRow(row) { this.rows.push([...row]); }, getRange(r,c) { return { setValues: values => values[0].forEach((v,i) => { this.rows[r-1][c-1+i] = v; }) }; } };
  const tables = { Sessions: [session], SessionCases: [{ session_id: 'SES-1', case_id: 'CASE-1', demo_marker: '[DEMO]' }],
    TrainerAssessments: [], ParticipantAcknowledgements: [], TrainerForms: [trainerForm], ParticipantForms: [participantForm] };
  const sent = [];
  const ctx = vm.createContext({ Date, Object, Array, Number, String, RegExp, Error, Set });
  for (const name of ['NotificationTemplates.gs', 'FollowUp.gs', 'FormDispatch.gs'])
    vm.runInContext(fs.readFileSync('apps-script/' + name, 'utf8'), ctx);
  ctx.DEMO_SCHEMA = { sheets: { MessageLedger: headers } };
  ctx.SLOT_TIME_ZONE = 'Europe/Zurich';
  ctx.Utilities = { formatDate: () => '24.10.2026' };
  ctx.trainerCaseContext_ = () => context;
  ctx.trainerFormRow_ = () => trainerForm;
  ctx.participantFormRow_ = () => participantForm;
  ctx.participantAcknowledgementGate_ = () => ({ allowed: tables.TrainerAssessments.some(row => row.disposition === 'accepted' && row.attendance === 'attended' && row.assessment === 'passed') });
  ctx.assertParticipantFormAssignment_ = () => {};
  ctx.formsReadyForLink_ = form => !!form.verified_at;
  ctx.getPrivateFixture_ = () => ({ Topics: new Array(5), Skills: new Array(20), People: [
    ['MATT', owner, '', '[DEMO]'], ['T', trainer, '', '[DEMO]'], ['P', person, '', '[DEMO]']] });
  ctx.validateFixture_ = () => {};
  ctx.Session = { getEffectiveUser: () => ({ getEmail: () => owner }) };
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  ctx.SpreadsheetApp = { flush() {} };
  ctx.assertHeaders_ = (actual, expected) => assert.deepEqual(actual, expected);
  ctx.readDemoTables_ = () => ({ ...tables, MessageLedger: ledger.rows.slice(1).map(row => Object.fromEntries(headers.map((key,i) => [key,row[i]]))) });
  ctx.findDemoSpreadsheet_ = () => ({ getSheetByName: () => ledger });
  const gateway = { sheet: ledger, remainingQuota: () => 100, verifyCalendar() {}, sendEmail: message => sent.push(message) };
  const prepare = ctx.formDispatchPrepareOne_;
  ctx.formDispatchPrepareOne_ = () => {};
  return { ctx, tables, session, context, trainerForm, participantForm, ledger, sent, gateway, prepare };
}

const before = new Date('2026-10-24T11:59:59Z'), after = new Date('2026-10-24T12:01:00Z');
{
  const { ctx, tables, sent, ledger, gateway } = setup();
  assert.equal(ctx.processFormRequestsCore_(before, gateway).results.length, 0);
  assert.equal(sent.length, 0);
  const first = ctx.processFormRequestsCore_(after, gateway);
  assert.equal(first.results[0].state, 'sent');
  assert.equal(first.results[0].key, 'trainer_report:CASE-1:SES-1');
  assert.equal(sent[0].to, 'trainer@example.test');
  assert.match(sent[0].body, /https:\/\/docs\.google\.com\/forms\/d\/e\/trainer/);
  ctx.processFormRequestsCore_(after, gateway);
  assert.equal(sent.length, 1);
  tables.TrainerAssessments.push({ session_id: 'SES-1', case_id: 'CASE-1', disposition: 'accepted', attendance: 'attended', assessment: 'passed', demo_marker: '[DEMO]' });
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results[0].key, 'ack_request:CASE-1:SES-1');
  assert.equal(sent[1].to, 'participant@example.test');
  assert.match(sent[1].body, /https:\/\/docs\.google\.com\/forms\/d\/e\/participant/);
  ctx.processFormRequestsCore_(after, gateway);
  assert.equal(sent.length, 2); assert.equal(ledger.rows.length, 3);
  tables.ParticipantAcknowledgements.push({ session_id: 'SES-1', case_id: 'CASE-1', disposition: 'accepted', demo_marker: '[DEMO]' });
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results.length, 0);
}
{
  const { ctx, tables, session, trainerForm, sent, gateway } = setup();
  trainerForm.verified_at = '';
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results.length, 0);
  trainerForm.verified_at = end;
  session.status = 'cancelled';
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results.length, 0);
  session.status = 'invited';
  tables.TrainerAssessments.push({ session_id: 'SES-1', case_id: 'CASE-1', disposition: 'accepted', attendance: 'absent', assessment: 'needs_follow_up', demo_marker: '[DEMO]' });
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results.length, 0);
  assert.equal(sent.length, 0);
}
{
  const { ctx, sent, ledger, gateway, context } = setup();
  context.trainer.email = 'outside@example.test';
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results[0].state, 'blocked');
  assert.equal(sent.length, 0); assert.equal(ledger.rows.length, 1);
}
{
  const { ctx, sent, ledger, gateway } = setup();
  gateway.remainingQuota = () => 0;
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results[0].state, 'pending_quota');
  assert.equal(sent.length, 0); assert.equal(ledger.rows.length, 1);
}
{
  const { ctx, sent, ledger, gateway } = setup();
  gateway.sendEmail = () => { throw Error('uncertain'); };
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results[0].state, 'unknown');
  gateway.sendEmail = message => sent.push(message);
  ctx.processFormRequestsCore_(after, gateway);
  assert.equal(sent.length, 0); assert.equal(ledger.rows.length, 2);
}
{
  const { ctx, sent, ledger, gateway } = setup();
  ledger.rows.push(['trainer_report:CASE-1:SES-1', 'trainer_assessment_request', 3, 'REQ-1', 'CASE-1', 'SES-1',
    'trainer@example.test', end, after.toISOString(), '', 'reserved', '', '[DEMO]']);
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results[0].state, 'unknown');
  assert.equal(ledger.rows[1][10], 'unknown'); assert.equal(sent.length, 0);
}
{
  const { ctx, tables, sent, gateway, prepare } = setup();
  ctx.formDispatchPrepareOne_ = prepare;
  const calls = [];
  ctx.prepareTrainerForm = () => { calls.push('trainer'); };
  ctx.prepareParticipantForm = () => { calls.push('participant'); };
  ctx.FormApp = { openById: id => ({ getResponses: () => id === 'TF-1' ? [{ id: 'raw trainer' }] : [{ id: 'raw participant' }] }) };
  ctx.processTrainerResponse_ = () => { tables.TrainerAssessments.push({ session_id: 'SES-1', case_id: 'CASE-1', disposition: 'accepted', attendance: 'attended', assessment: 'passed', demo_marker: '[DEMO]' }); };
  ctx.processParticipantResponse_ = () => { tables.ParticipantAcknowledgements.push({ session_id: 'SES-1', case_id: 'CASE-1', disposition: 'accepted', demo_marker: '[DEMO]' }); };
  assert.equal(ctx.processFormRequestsCore_(after, gateway).results.length, 0,
    'replayed raw responses suppress stale requests');
  assert.deepEqual(calls, ['trainer', 'participant'], 'both Forms are prepared before raw responses are replayed');
  assert.equal(sent.length, 0);
}
console.log('Form request dispatch: timing, verified links, allowlist, replay, quotas, and ambiguous delivery passed');
