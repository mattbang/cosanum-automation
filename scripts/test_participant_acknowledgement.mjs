import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({Date, Set, Object, Array, Number, String});
for (const file of ['FormsIdentity.gs', 'ParticipantAcknowledgement.gs']) vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), ctx);

const end = '2026-10-22T09:00:00Z';
const review = '2026-10-22T09:20:00Z';
const sent = '2026-10-22T10:00:00Z';
const context = {
  session: {session_id:'SES-THEORY',request_id:'REQ-ONE',phase:'theory',end_utc:end},
  request: {request_id:'REQ-ONE'}, personCase: {case_id:'CASE-ONE'},
  person: {person_key:'SUMNER',email:'participant@example.com',display_alias:'Sam Test'},
  trainer: {display_alias:'Daniel Test'}, topic: {display_name:'Hochregallager'},
  owner: {email:'owner@example.com'}
};
const formRow = {session_id:'SES-THEORY',case_id:'CASE-ONE',request_id:'REQ-ONE',
  person_key:'SUMNER',participant_email:'participant@example.com',form_id:'FORM-ONE',
  form_url:'https://docs.google.com/forms/d/e/example/viewform',demo_marker:'[DEMO]',
  verified_at:review,verified_by:'owner@example.com'};
const pass = {session_id:'SES-THEORY',case_id:'CASE-ONE',disposition:'accepted',
  attendance:'attended',assessment:'passed',submitted_at:'2026-10-22T09:10:00Z',demo_marker:'[DEMO]'};
const tables = {TrainerAssessments:[],Sessions:[],SessionCases:[],ParticipantForms:[formRow],ParticipantAcknowledgements:[]};
assert.equal(ctx.participantAcknowledgementGate_(tables,context).allowed,false);
tables.TrainerAssessments=[pass];
const gate=ctx.participantAcknowledgementGate_(tables,context);
assert.equal(gate.allowed,true);
assert.equal(gate.releasedAt,pass.submitted_at);
assert.throws(()=>ctx.assertParticipantFormAssignment_({...formRow,request_id:'REQ-OTHER'},context),/stimmen nicht überein/);
assert.throws(()=>ctx.assertParticipantFormAssignment_({...formRow,participant_email:'wrong@example.com'},context),/stimmen nicht überein/);

const practiceContext={...context,session:{...context.session,session_id:'SES-PRACTICE',phase:'practice',theory_session_id:'SES-THEORY'}};
tables.TrainerAssessments.push({...pass,session_id:'SES-PRACTICE',submitted_at:'2026-10-22T12:30:00Z'});
assert.equal(ctx.participantAcknowledgementGate_(tables,practiceContext).allowed,false,'practice requires linked theory');
tables.Sessions=[{session_id:'SES-THEORY',request_id:'REQ-ONE',phase:'theory',demo_marker:'[DEMO]'}];
tables.SessionCases=[{session_id:'SES-THEORY',case_id:'CASE-ONE',demo_marker:'[DEMO]'}];
assert.equal(ctx.participantAcknowledgementGate_(tables,practiceContext).allowed,true);
tables.TrainerAssessments[0]={...pass,assessment:'needs_follow_up'};
assert.equal(ctx.participantAcknowledgementGate_(tables,practiceContext).allowed,false,'failed theory blocks practice');
tables.TrainerAssessments[0]=pass;

const titles=ctx.PARTICIPANT_QUESTIONS;
function response(id,{email='participant@example.com',at=sent,affirmation=[ctx.PARTICIPANT_AFFIRMATION],name='Sam Test'}={}){
  return {getId:()=>id,getTimestamp:()=>new Date(at),getRespondentEmail:()=>email,
    getItemResponses:()=>[[titles.participation,affirmation],[titles.name,name]].map(([title,value])=>({getItem:()=>({getTitle:()=>title}),getResponse:()=>value}))};
}
function decide(r,existing=[],f=formRow,g=gate){return ctx.participantAcknowledgementDecision_(context,f,r,existing,g)}
const good=decide(response('R-ONE'));
assert.equal(good.disposition,'accepted');
assert.equal(good.affirmative,true);
assert.equal(good.typedName,'Sam Test');
assert.equal(good.respondentEmail,'participant@example.com');
assert.equal(good.submittedAt,new Date(sent).toISOString());
assert.equal(decide(response('R-WRONG',{email:'other@example.com'})).disposition,'rejected');
assert.match(decide(response('R-WRONG',{email:'other@example.com'})).reason,/Falsches Google-Konto/);
assert.match(decide(response('R-EARLY',{at:'2026-10-22T09:15:00Z'})).reason,/vor der manuellen Prüfung/);
assert.match(decide(response('R-BEFORE-END',{at:'2026-10-22T08:59:00Z'}),[],{...formRow,verified_at:'2026-10-22T08:00:00Z'}).reason,/vor dem Ende/);
assert.match(decide(response('R-BEFORE-PASS',{at:'2026-10-22T09:05:00Z'}),[],{...formRow,verified_at:'2026-10-22T09:00:00Z'}).reason,/vor der Trainerfreigabe/);
assert.equal(decide(response('R-NO',{affirmation:[]})).disposition,'rejected');
assert.equal(decide(response('R-NAME',{name:' '})).disposition,'rejected');
assert.equal(decide(response('R-GATE'),[],formRow,{allowed:false,reason:'Trainerfreigabe fehlt.'}).disposition,'rejected');
assert.equal(decide(response('R-ONE'),[{response_id:'R-ONE',disposition:'accepted'}]).disposition,'duplicate');
assert.equal(decide(response('R-TWO'),[{response_id:'R-ONE',disposition:'accepted'}]).disposition,'rejected');
assert.match(decide(response('R-TWO'),[{response_id:'R-ONE',disposition:'accepted'}]).reason,/bereits eine gültige/);

const header=['response_id','form_id','request_id','session_id','case_id','person_key','respondent_email','submitted_at','typed_name','affirmative','disposition','reason','demo_marker'];
ctx.DEMO_SCHEMA={sheets:{ParticipantAcknowledgements:header}};
ctx.assertHeaders_=(actual,expected)=>assert.deepEqual(actual,expected);
ctx.SpreadsheetApp={flush:()=>{}};
const rows=[header];
const sheet={getDataRange:()=>({getValues:()=>rows}),appendRow:row=>rows.push(row)};
assert.equal(ctx.saveParticipantAttempt_(good,sheet).saved,true);
assert.equal(ctx.saveParticipantAttempt_(good,sheet).saved,false);
assert.equal(rows.length,2,'replay must not append a second row');
assert.equal(rows[1][10],'accepted');

tables.ParticipantAcknowledgements=[];
ctx.readDemoTables_=()=>({
  ...tables,
  Sessions:[{session_id:'SES-THEORY',status:'invited',demo_marker:'[DEMO]'}],
  SessionCases:[{session_id:'SES-THEORY',case_id:'CASE-ONE',demo_marker:'[DEMO]'}]
});
ctx.trainerCaseContext_=()=>context;
assert.equal(ctx.participantAcknowledgementQueue_()[0].status,'awaiting_acknowledgement');
tables.ParticipantAcknowledgements=[{session_id:'SES-THEORY',case_id:'CASE-ONE',disposition:'accepted',
  respondent_email:'participant@example.com',submitted_at:sent,response_id:'R-ONE',typed_name:'Sam Test',demo_marker:'[DEMO]'}];
assert.equal(ctx.participantAcknowledgementQueue_()[0].status,'acknowledged');

const savedRows=[ctx.DEMO_SCHEMA.sheets.ParticipantForms ||
  ['session_id','case_id','request_id','person_key','participant_email','form_id','form_url','created_at','demo_marker','verified_at','verified_by'],
  ['SES-THEORY','CASE-ONE','REQ-ONE','SUMNER','participant@example.com','FORM-ONE',formRow.form_url,
    review,'[DEMO]','','']];
tables.ParticipantForms=[{...formRow,verified_at:'',verified_by:''}];
ctx.readDemoTables_=()=>tables;
ctx.trainerCaseContext_=()=>context;
ctx.verifyTrainerCalendar_=()=>{};
ctx.calendarBookingGet_=()=>({});
ctx.Session={getEffectiveUser:()=>({getEmail:()=> 'owner@example.com'})};
ctx.LockService={getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})};
ctx.FormApp={openById:()=>({collectsEmail:()=>true})};
ctx.ScriptApp={getProjectTriggers:()=>[{
  getHandlerFunction:()=> 'onParticipantFormSubmit',getTriggerSourceId:()=> 'FORM-ONE'
}]};
ctx.findDemoSpreadsheet_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>savedRows}),
  getRange:(row,col,count,width)=>({setValues:values=>{
    assert.deepEqual([row,col,count,width],[2,10,1,2]);
    savedRows[1][9]=values[0][0];savedRows[1][10]=values[0][1];
  }})})});
const pendingPreparation=ctx.prepareParticipantForm({sessionId:'SES-THEORY',caseId:'CASE-ONE'});
assert.equal(pendingPreparation.reused,true);
assert.equal(pendingPreparation.formUrl,'','pending Form must not expose responder link');
assert.equal(pendingPreparation.needsVerifiedReview,true);
assert.throws(()=>ctx.confirmParticipantVerifiedEmail({sessionId:'SES-THEORY',caseId:'CASE-ONE'}),/prüfen und bestätigen/);
assert.equal(ctx.confirmParticipantVerifiedEmail({sessionId:'SES-THEORY',caseId:'CASE-ONE',confirmation:true}).verifiedBy,'owner@example.com');
assert.equal(savedRows[1][10],'owner@example.com');
tables.ParticipantForms=[formRow];
const reviewedPreparation=ctx.prepareParticipantForm({sessionId:'SES-THEORY',caseId:'CASE-ONE'});
assert.equal(reviewedPreparation.reused,true);
assert.equal(reviewedPreparation.formUrl,formRow.form_url);
assert.equal(ctx.participantAcknowledgementDecision_(context,{...formRow,verified_at:'',verified_by:''},response('R-PENDING'),[],gate).disposition,'rejected');
ctx.Session={getEffectiveUser:()=>({getEmail:()=> 'other@example.com'})};
assert.throws(()=>ctx.confirmParticipantVerifiedEmail({sessionId:'SES-THEORY',caseId:'CASE-ONE',confirmation:true}),/Nur Process & Quality/);

const replay = vm.createContext({ Date, Object, Array, Number, String, RegExp, Error, Set });
vm.runInContext(fs.readFileSync('apps-script/ParticipantAcknowledgement.gs', 'utf8'), replay);
const replayed = [];
replay.trainerCaseContext_ = () => context;
replay.assertParticipantFormAssignment_ = () => {};
replay.FormApp = { openById: id => {
  assert.equal(id, 'FORM-ONE');
  return { getResponses: () => [response('RAW-1'), response('RAW-2')] };
} };
replay.processParticipantResponseLocked_ = (id, raw) => { replayed.push([id, raw.getId()]); return { saved: true }; };
assert.equal(replay.reconcileParticipantResponsesLocked_(tables, formRow).length, 2);
assert.deepEqual(replayed, [['FORM-ONE', 'RAW-1'], ['FORM-ONE', 'RAW-2']]);
replay.FormApp = { openById: () => { throw Error('Forms unavailable'); } };
assert.throws(() => replay.reconcileParticipantResponsesLocked_(tables, formRow), /Forms unavailable/);

console.log('Pass: phase gates, assigned account, owner review, trainer timing, affirmative answer, typed name, duplicate replay, and open/accepted queue.');
