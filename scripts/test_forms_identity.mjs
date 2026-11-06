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
const triggers = [{ getHandlerFunction: () => 'processVerifiedFormResponses_' }];
ctx.ScriptApp = { getOAuthToken: () => 'private-test-token', getProjectTriggers: () => triggers };

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
assert.equal(ctx.prepareTrainerForm_({ sessionId: 'SESSION', caseId: 'CASE-T' }).formUrl, savedTrainer.form_url);
assert.equal(ctx.prepareParticipantForm_({ sessionId: 'SESSION', caseId: 'CASE-P' }).formUrl, savedParticipant.form_url);
assert.equal(trainerSheet.rows.length, 2, 'trainer retry keeps one Form row');
assert.equal(participantSheet.rows.length, 2, 'participant retry keeps one Form row');
assert.equal(ctx.prepareTrainerForm_({ sessionId: 'SESSION', caseId: 'CASE-T' }).reused, true);
assert.equal(ctx.prepareParticipantForm_({ sessionId: 'SESSION', caseId: 'CASE-P' }).reused, true);
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
assert.equal(ctx.formsIdentityGate_({ ...trainerForm, verified_by: owner }, owner).allowed, false, 'historical manual row must fail when current setting changed');
state.set('FORM-TRAINER', 'VERIFIED');
assert.equal(ctx.formsIdentityGate_({ ...trainerForm, verified_by: owner }, owner).allowed, true, 'historical manual row requires current REST verification');
restFailure = true;
assert.equal(ctx.formsReadyForLink_({ ...trainerForm, verified_by: owner }, owner), false, 'REST outage hides historical manual links too');
console.log('Pass: Forms REST VERIFIED write/read-back, both response roles, wrong accounts, changed setting, retries, historical rows, and REST failure.');

// Trigger migration preserves existing bindings unless the shared poller is created successfully.
{
  const rows = prefix => Array.from({length:30}, (_,i) => ({form_id:prefix+i,demo_marker:'[DEMO]'}));
  const tables = {TrainerForms:rows('TF-'), ParticipantForms:rows('PF-')};
  const trigger = (handler,id) => ({getHandlerFunction:()=>handler,getTriggerSourceId:()=>id});
  function schedulerFixture(count, failCreate = false) {
    const scheduler = vm.createContext({Date, Object, Array, Number, String});
    for (const file of ['FormsIdentity.gs', 'TrainerAssessment.gs', 'ParticipantAcknowledgement.gs'])
      vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), scheduler);
    const unrelated = trigger('onTrainerFormSubmit','NOT-IN-DEMO');
    const triggers = [...Array.from({length:count-16},(_,i)=>trigger('daily-'+i,'')),unrelated,
      ...Array.from({length:15},(_,i)=>trigger('onTrainerFormSubmit','TF-'+i))];
    const effects = [];
    scheduler.readDemoTables_ = () => tables;
    scheduler.ScriptApp = {
      getProjectTriggers:()=>triggers,
      deleteTrigger:item=>{effects.push('delete');triggers.splice(triggers.indexOf(item),1);},
      newTrigger:handler=>({timeBased:()=>({everyMinutes:minutes=>({create:()=>{
        effects.push('create');assert.equal(minutes,5);assert(triggers.length<20);
        if(failCreate)throw Error('synthetic creation failure');
        const created=trigger(handler,'');triggers.push(created);return created;
      }})})})
    };
    return {scheduler,triggers,effects,unrelated};
  }
  const full = schedulerFixture(20);
  const fullBefore = [...full.triggers];
  assert.throws(()=>full.scheduler.ensureTrainerFormTrigger_('TF-0'), /Trigger.*[Kk]apazität|[Kk]apazität.*Trigger/);
  assert.deepEqual(full.triggers,fullBefore,'full capacity preserves every existing binding');
  assert.deepEqual(full.effects,[],'full capacity neither creates nor deletes triggers');
  const failed = schedulerFixture(19,true);
  const failedBefore = [...failed.triggers];
  assert.throws(()=>failed.scheduler.ensureParticipantFormTrigger_('PF-0'), /synthetic creation failure/);
  assert.deepEqual(failed.triggers,failedBefore,'creation failure preserves every existing binding');
  assert.deepEqual(failed.effects,['create'],'legacy bindings are not deleted before successful creation');
  const {scheduler,triggers,effects,unrelated} = schedulerFixture(19);
  scheduler.ensureTrainerFormTrigger_('TF-0');
  for (let i=0;i<30;i++) {scheduler.ensureTrainerFormTrigger_('TF-'+i); scheduler.ensureParticipantFormTrigger_('PF-'+i);}
  assert.equal(effects.filter(effect=>effect==='create').length,1);
  assert.equal(effects[0],'create','replacement is created before any legacy binding is retired');
  assert.equal(effects.filter(effect=>effect==='delete').length,15);
  assert.equal(triggers.length,5);assert(triggers.includes(unrelated));
  const before = JSON.stringify(triggers.map(item=>[item.getHandlerFunction(),item.getTriggerSourceId()]));
  assert.equal(scheduler.formsResponseTriggerReady_('TF-25','onTrainerFormSubmit'),true);
  assert.equal(JSON.stringify(triggers.map(item=>[item.getHandlerFunction(),item.getTriggerSourceId()])),before);
  const processed=[],opened=[],attempted=[];
  tables.TrainerAssessments=[]; tables.ParticipantAcknowledgements=[];
  let locked=false, released=0, reads=0, overlapped=false;
  scheduler.LockService={getScriptLock:()=>({
    tryLock:()=>{if(locked)return false;locked=true;return true;},
    releaseLock:()=>{assert(locked);locked=false;released++;}
  })};
  scheduler.readDemoTables_=()=>{assert(locked,'poller must lock before its first Sheet read');reads++;return tables;};
  const rawResponse=id=>({getId:()=>id});
  scheduler.FormApp={openById:id=>{
    assert(locked);opened.push(id);
    if(!overlapped){
      overlapped=true;
      const beforeReads=reads;
      assert.equal(scheduler.processVerifiedFormResponses_().busy,true,'overlapping run must yield');
      assert.equal(reads,beforeReads,'overlap must not read the Sheet');
      assert(locked,'overlapping run must not release the active run lock');
    }
    if(id==='TF-0')throw Error('private Form failure for TF-0');
    const ids=id==='TF-1'?['private rejected response','RESPONSE']:id==='PF-29'?['RESPONSE','RESPONSE']:['RESPONSE'];
    return {getResponses:()=>ids.map(rawResponse)};
  }};
  scheduler.processTrainerResponse_=scheduler.processParticipantResponse_=()=>{throw Error('must not reacquire/release the outer lock');};
  function accept(id,response,ledger){
    assert(locked);attempted.push(response.getId());
    if(response.getId()==='private rejected response')throw Error('private response source text');
    processed.push(id);ledger.push({form_id:id,response_id:response.getId()});return {saved:true};
  }
  scheduler.processTrainerResponseLocked_=(id,response)=>accept(id,response,tables.TrainerAssessments);
  scheduler.processParticipantResponseLocked_=(id,response)=>accept(id,response,tables.ParticipantAcknowledgements);
  assert.throws(()=>scheduler.processVerifiedFormResponses_(),error=>{
    assert.equal(error.message,'Formular-Antwortabgleich fehlgeschlagen: 2 Fehler; 59 Antworten gespeichert.');
    return true;
  });
  assert.equal(opened.length,60);assert.equal(attempted.length,60);assert.equal(processed.length,59);
  assert(processed.includes('TF-1'),'one failed response must not starve later responses in the same Form');
  assert(processed.includes('PF-29'),'an unreadable trainer Form must not starve later participant Forms');
  assert.equal(tables.ParticipantAcknowledgements.length,30,'repeated raw responses within one sweep must be skipped');
  assert.equal(locked,false);assert.equal(released,1);
  assert.throws(()=>scheduler.processVerifiedFormResponses_(),error=>{
    assert.equal(error.message,'Formular-Antwortabgleich fehlgeschlagen: 2 Fehler; 0 Antworten gespeichert.');
    return true;
  });
  assert.equal(processed.length,59,'recorded response IDs must bypass repeated processing');
  assert.equal(attempted.length,61,'a failed response remains retryable');
  assert.equal(locked,false);assert.equal(released,2);

  opened.length=0;
  scheduler.FormApp={openById:id=>{assert(locked);opened.push(id);throw Error('private unavailable Form '+id);}};
  assert.throws(()=>scheduler.processVerifiedFormResponses_(),error=>{
    assert.equal(error.message,'Formular-Antwortabgleich fehlgeschlagen: 60 Fehler; 0 Antworten gespeichert.');
    return true;
  });
  assert.equal(opened.length,60,'an all-Forms outage attempts every registered Form before reporting failure');
  assert.equal(locked,false);assert.equal(released,3);

  scheduler.FormApp={openById:id=>({getResponses:()=>[rawResponse('RESPONSE')]})};
  assert.deepEqual(JSON.parse(JSON.stringify(scheduler.processVerifiedFormResponses_())),{processed:1,saved:1,skipped:59,errors:[]},
    'response keys include Form IDs and successful replay counts remain visible');
  assert.equal(locked,false);assert.equal(released,4);
  tables.TrainerAssessments=[]; tables.ParticipantAcknowledgements=[];
  scheduler.processTrainerResponseLocked_=(id,response)=>{const result=accept(id,response,tables.TrainerAssessments);result.saved=id!=='TF-0';return result;};
  assert.deepEqual(JSON.parse(JSON.stringify(scheduler.processVerifiedFormResponses_())),{processed:60,saved:59,skipped:0,errors:[]},
    'successful fresh runs retain processed and saved counts');
  assert.equal(locked,false);assert.equal(released,5);

  let tableReads=0;
  tables.TrainerAssessments=[]; tables.ParticipantAcknowledgements=[];
  scheduler.readDemoTables_=()=>{assert(locked);if(++tableReads===1)throw Error('private workbook source text');return tables;};
  assert.throws(()=>scheduler.processVerifiedFormResponses_(),error=>{
    assert.equal(error.message,'Formular-Antwortabgleich fehlgeschlagen: 1 Fehler; 30 Antworten gespeichert.');
    return true;
  });
  assert.equal(tableReads,2,'a failed registry read does not prevent attempting the later registry');
  assert.equal(locked,false);assert.equal(released,6);
  scheduler.readDemoTables_=()=>{assert(locked);throw Error('private Sheet source text');};
  assert.throws(()=>scheduler.processVerifiedFormResponses_(),error=>{
    assert.equal(error.message,'Formular-Antwortabgleich fehlgeschlagen: 2 Fehler; 0 Antworten gespeichert.');
    return true;
  });
  assert.equal(locked,false,'failed initial reads must release the lock');assert.equal(released,7);
}
restFailure=false;
state.set('FORM-TRAINER','VERIFIED');state.set('FORM-PARTICIPANT','VERIFIED');
const beforeReplay=JSON.stringify([trainerSheet.rows,participantSheet.rows]);
assert.equal(ctx.prepareTrainerForm_({sessionId:'SESSION',caseId:'CASE-T',requireExistingFormId:'FORM-TRAINER'}).reused,true);
assert.equal(ctx.prepareParticipantForm_({sessionId:'SESSION',caseId:'CASE-P',requireExistingFormId:'FORM-PARTICIPANT'}).reused,true);
assert.equal(JSON.stringify([trainerSheet.rows,participantSheet.rows]),beforeReplay,'shared-trigger replay must not write');
console.log('Pass: preserved triggers on capacity/create failures, shared-poller migration, complete response attempts, sanitized failures and successful replay.');

// Run the real response handlers: scheduler stubs alone cannot catch a missing core handler.
{
  const live=vm.createContext({Date,Set,Object,Array,Number,String,JSON,encodeURIComponent});
  for(const file of ['FormsIdentity.gs','TrainerAssessment.gs','ParticipantAcknowledgement.gs'])
    vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),live);
  let locked=false, releases=0;
  live.LockService={getScriptLock:()=>({
    tryLock:()=>{if(locked)return false;locked=true;return true;},
    waitLock:()=>{assert.equal(locked,false,'real handler must not nest locks');locked=true;},
    releaseLock:()=>{assert(locked);locked=false;releases++;}
  })};
  const source={TrainerForms:[{...savedTrainer,...trainerForm}],ParticipantForms:[{...savedParticipant,...participantForm}],
    TrainerAssessments:[],ParticipantAcknowledgements:[]};
  live.readDemoTables_=()=>{assert(locked);return source;};
  live.trainerCaseContext_=(_tables,_sessionId,caseId)=>caseId==='CASE-T'
    ? {...trainerContext,trainer:{...trainerContext.trainer,person_key:'MATT'}} : participantContext;
  live.formsIdentityGate_=()=>({allowed:true});
  live.participantAcknowledgementGate_=()=>({allowed:true,releasedAt:'2026-10-22T09:10:00Z'});
  live.verifyTrainerCalendar_=()=>({});live.calendarBookingGet_=()=>({});
  live.FormApp={openById:id=>({getResponses:()=>[response(id==='FORM-TRAINER'?trainer:participant,id==='FORM-TRAINER')]})};
  live.findDemoSpreadsheet_=()=>({getSheetByName:name=>name});
  function save(decision,name){
    assert(locked);assert.equal(decision.disposition,'accepted');
    source[name].push({form_id:decision.formId,response_id:decision.responseId,
      session_id:decision.sessionId,case_id:decision.caseId,disposition:decision.disposition});
    return {saved:true,decision};
  }
  live.saveTrainerAttempt_=(decision,name)=>save(decision,name);
  live.saveParticipantAttempt_=(decision,name)=>save(decision,name);
  const run=live.processVerifiedFormResponses_();
  assert.deepEqual(Array.from(run.errors),[]);assert.equal(run.saved,2);
  assert.equal(source.TrainerAssessments.length,1);assert.equal(source.ParticipantAcknowledgements.length,1);
  const retry=live.processVerifiedFormResponses_();
  assert.equal(retry.saved,0);assert.equal(retry.skipped,2);assert.equal(releases,2);assert.equal(locked,false);
}
