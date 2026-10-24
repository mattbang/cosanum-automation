import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const owner = 'owner@example.test', trainer = 'trainer@example.test', participant = 'participant@example.test';
const state = new Map([['FORM-TRAINER', 'RESPONDER_INPUT'], ['FORM-PARTICIPANT', 'RESPONDER_INPUT']]);
const calls = [];
let restFailure = false, forceMismatch = false;
const ctx = vm.createContext({ Date, Set, Object, Array, Number, String, JSON, encodeURIComponent });
for (const file of ['FormsIdentity.gs', 'TrainerAssessment.gs', 'ParticipantAcknowledgement.gs']) {
  vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), ctx);
}
ctx.ScriptApp = { getOAuthToken: () => 'private-test-token', getProjectTriggers: () => [
  { getHandlerFunction: () => 'onTrainerFormSubmit', getTriggerSourceId: () => 'FORM-TRAINER' },
  { getHandlerFunction: () => 'onParticipantFormSubmit', getTriggerSourceId: () => 'FORM-PARTICIPANT' }
] };
ctx.UrlFetchApp = { fetch(url, options) {
  const endpoint = url.split('/').at(-1), isPost = endpoint.endsWith(':batchUpdate');
  const formId = decodeURIComponent(endpoint.replace(':batchUpdate', ''));
  calls.push({ formId, method: options.method, payload: options.payload });
  assert.equal(options.headers.Authorization, 'Bearer private-test-token');
  if (restFailure) return { getResponseCode: () => 503, getContentText: () => 'unavailable' };
  if (isPost) {
    const body = JSON.parse(options.payload);
    assert.equal(body.requests.length, 1);
    assert.equal(body.requests[0].updateSettings.settings.emailCollectionType, 'VERIFIED');
    assert.equal(body.requests[0].updateSettings.updateMask, 'emailCollectionType');
    if (!forceMismatch) state.set(formId, 'VERIFIED');
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ replies: [{}] }) };
  }
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ formId, settings: { emailCollectionType: state.get(formId) } }) };
} };
ctx.SpreadsheetApp = { flush() {} };
function sheet(formId, caseId) {
  const rows = [['session_id','case_id','','','','form_id','','','','verified_at','verified_by'],
    ['SESSION', caseId, '', '', '', formId, '', '', '', '', '']];
  return { rows, getDataRange: () => ({ getValues: () => rows }), getRange: (r, c) => ({ setValues: values => {
    assert.deepEqual([r, c], [2, 10]); rows[1][9] = values[0][0]; rows[1][10] = values[0][1];
  } }) };
}
function row(formId, caseId) { return { session_id: 'SESSION', case_id: caseId, form_id: formId, verified_at: '', verified_by: '' }; }

for (const [formId, caseId] of [['FORM-TRAINER','CASE-T'],['FORM-PARTICIPANT','CASE-P']]) {
  const saved = row(formId, caseId), target = sheet(formId, caseId);
  ctx.tryAutomatedFormVerification_(target, saved, owner);
  assert.match(saved.verified_by, /^forms-api:owner@example\.test$/);
  assert.ok(Number.isFinite(Date.parse(saved.verified_at)));
  assert.equal(ctx.formsReadyForLink_(saved, owner), true);
  assert.equal(target.rows[1][10], saved.verified_by);
  const posts = calls.filter(call => call.formId === formId && call.method === 'post').length;
  ctx.tryAutomatedFormVerification_(target, saved, owner);
  assert.equal(calls.filter(call => call.formId === formId && call.method === 'post').length, posts, 'retry must not mutate an already verified form');
}

const trainerForm = { ...row('FORM-TRAINER', 'CASE-T'), verified_at: '2026-10-22T09:05:00Z', verified_by: 'forms-api:' + owner };
const participantForm = { ...row('FORM-PARTICIPANT', 'CASE-P'), verified_at: '2026-10-22T09:05:00Z', verified_by: 'forms-api:' + owner };
const trainerContext = { owner: { email: owner }, trainer: { email: trainer }, person: { person_key: 'P' },
  session: { session_id: 'SESSION', end_utc: '2026-10-22T09:00:00Z' }, personCase: { case_id: 'CASE-T' } };
const participantContext = { owner: { email: owner }, person: { person_key: 'P', email: participant },
  session: { session_id: 'SESSION', end_utc: '2026-10-22T09:00:00Z' }, personCase: { case_id: 'CASE-P' }, request: { request_id: 'REQ' } };
ctx.verifyTrainerCalendar_ = () => {};
const savedTrainer = { ...row('FORM-TRAINER', 'CASE-T'), person_key: 'P', trainer_key: 'MATT', trainer_email: trainer,
  demo_marker: '[DEMO]', form_url: 'https://docs.google.com/forms/d/e/trainer/viewform' };
const savedParticipant = { ...row('FORM-PARTICIPANT', 'CASE-P'), request_id: 'REQ', person_key: 'P', participant_email: participant,
  demo_marker: '[DEMO]', form_url: 'https://docs.google.com/forms/d/e/participant/viewform' };
const trainerSheet = sheet('FORM-TRAINER', 'CASE-T'), participantSheet = sheet('FORM-PARTICIPANT', 'CASE-P');
const tables = { TrainerForms: [savedTrainer], ParticipantForms: [savedParticipant] };
ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
ctx.FormApp = { openById: () => ({}) };
ctx.calendarBookingGet_ = () => ({});
ctx.trainerCaseContext_ = (_tables, _sessionId, caseId) => caseId === 'CASE-T' ?
  { ...trainerContext, trainer: { ...trainerContext.trainer, person_key: 'MATT' } } : participantContext;
ctx.participantAcknowledgementGate_ = () => ({ allowed: true });
ctx.readDemoTables_ = () => tables;
ctx.findDemoSpreadsheet_ = () => ({ getSheetByName: name => name === 'TrainerForms' ? trainerSheet : participantSheet });
assert.equal(ctx.prepareTrainerForm({ sessionId: 'SESSION', caseId: 'CASE-T' }).formUrl, savedTrainer.form_url);
assert.equal(ctx.prepareParticipantForm({ sessionId: 'SESSION', caseId: 'CASE-P' }).formUrl, savedParticipant.form_url);
assert.equal(trainerSheet.rows.length, 2, 'trainer retry keeps one Form row');
assert.equal(participantSheet.rows.length, 2, 'participant retry keeps one Form row');
assert.equal(ctx.prepareTrainerForm({ sessionId: 'SESSION', caseId: 'CASE-T' }).reused, true);
assert.equal(ctx.prepareParticipantForm({ sessionId: 'SESSION', caseId: 'CASE-P' }).reused, true);
function response(email, isTrainer) {
  const items = isTrainer ? [
    [ctx.TRAINER_QUESTIONS.attendance, 'Ja, anwesend'], [ctx.TRAINER_QUESTIONS.assessment, 'Bestanden'],
    [ctx.TRAINER_QUESTIONS.note, ''], [ctx.TRAINER_QUESTIONS.attestation, ['Ja']]
  ] : [[ctx.PARTICIPANT_QUESTIONS.participation, [ctx.PARTICIPANT_AFFIRMATION]], [ctx.PARTICIPANT_QUESTIONS.name, 'Test Person']];
  return { getId: () => 'RESPONSE', getTimestamp: () => new Date('2026-10-22T10:00:00Z'), getRespondentEmail: () => email,
    getItemResponses: () => items.map(([title, value]) => ({ getItem: () => ({ getTitle: () => title }), getResponse: () => value })) };
}
assert.equal(ctx.trainerAssessmentDecision_(trainerContext, trainerForm, response(trainer, true), [], () => ({})).disposition, 'accepted');
assert.match(ctx.trainerAssessmentDecision_(trainerContext, trainerForm, response(participant, true), [], () => ({})).reason, /Falsches Google-Konto/);
assert.equal(ctx.participantAcknowledgementDecision_(participantContext, participantForm, response(participant, false), [], { allowed: true, releasedAt: '2026-10-22T09:10:00Z' }).disposition, 'accepted');
assert.match(ctx.participantAcknowledgementDecision_(participantContext, participantForm, response(trainer, false), [], { allowed: true, releasedAt: '2026-10-22T09:10:00Z' }).reason, /Falsches Google-Konto/);

state.set('FORM-TRAINER', 'RESPONDER_INPUT');
state.set('FORM-PARTICIPANT', 'RESPONDER_INPUT');
for (const [form, context, isTrainer] of [[trainerForm, trainerContext, true], [participantForm, participantContext, false]]) {
  assert.equal(ctx.formsReadyForLink_(form, owner), false, 'changed setting must hide the link');
  const decision = isTrainer ? ctx.trainerAssessmentDecision_(context, form, response(trainer, true), [], () => ({})) :
    ctx.participantAcknowledgementDecision_(context, form, response(participant, false), [], { allowed: true, releasedAt: '2026-10-22T09:10:00Z' });
  assert.equal(decision.disposition, 'rejected', 'changed setting must not accept a response');
}

const pending = row('FORM-TRAINER', 'CASE-NEW'), pendingSheet = sheet('FORM-TRAINER', 'CASE-NEW');
restFailure = true;
assert.equal(ctx.tryAutomatedFormVerification_(pendingSheet, pending, owner).verified_at, '', 'REST failure must leave manual fallback pending');
assert.equal(ctx.formsReadyForLink_(trainerForm, owner), false, 'REST failure must hide API-verified links');
assert.throws(() => ctx.trainerAssessmentDecision_(trainerContext, trainerForm, response(trainer, true), [], () => ({})), /Forms API GET fehlgeschlagen/);
restFailure = false;
forceMismatch = true;
assert.equal(ctx.tryAutomatedFormVerification_(pendingSheet, pending, owner).verified_at, '', 'read-back mismatch must not stamp the row');
forceMismatch = false;
assert.equal(ctx.formsIdentityGate_({ ...trainerForm, verified_by: owner }, owner).allowed, true, 'historical manual inspection remains available');
console.log('Pass: Forms REST VERIFIED write/read-back, both response roles, wrong accounts, changed setting, retries, manual fallback, and REST failure.');
