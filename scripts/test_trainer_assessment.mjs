import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({
  Date, Set, Object, Array, Number, String,
  bookingEventId_: id => `event-${id}`,
  verifiedRsvpEvent_: (session, event) => {
    if (!event || event.id !== session.calendar_event_id) throw new Error('Kalenderbeleg fehlt');
    return event;
  }
});
for (const file of ['FormsIdentity.gs', 'TrainerAssessment.gs']) vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), ctx);
const now = '2026-10-23T12:00:00Z';
const session = {session_id:'SES-TRAINER',request_id:'REQ-TRAINER',phase:'theory',mode:'group',
  trainer_key:'MATT',status:'invited',calendar_event_id:'event-SES-TRAINER',
  start_utc:'2026-10-22T08:00:00Z',end_utc:'2026-10-22T09:00:00Z',demo_marker:'[DEMO]'};
const people = [
  {person_key:'MATT',email:'trainer@example.com',display_alias:'Daniel Test',demo_marker:'[DEMO]'},
  {person_key:'WOHNUNG',email:'one@example.com',display_alias:'Alex Test',demo_marker:'[DEMO]'},
  {person_key:'SUMNER',email:'two@example.com',display_alias:'Sam Test',demo_marker:'[DEMO]'}
];
const cases = ['WOHNUNG','SUMNER'].map(key=>({case_id:`CASE-${key}`,request_id:'REQ-TRAINER',person_key:key,demo_marker:'[DEMO]'}));
const tables = {
  Sessions:[session], People:people, ParticipantCases:cases,
  SessionCases:cases.map(c=>({session_id:session.session_id,case_id:c.case_id,request_id:c.request_id,person_key:c.person_key,demo_marker:'[DEMO]'})),
  Requests:[{request_id:'REQ-TRAINER',topic_id:'TC_R052',demo_marker:'[DEMO]'}],
  Topics:[{topic_id:'TC_R052',display_name:'Hochregallager',demo_marker:'[DEMO]'}],
  TrainerForms:[], TrainerAssessments:[]
};
const event = {id:session.calendar_event_id,attendees:people.map(p=>({email:p.email,responseStatus:'needsAction'}))};
const formRow = {form_id:'FORM-ONE',session_id:session.session_id,case_id:cases[0].case_id,
  person_key:'WOHNUNG',trainer_key:'MATT',trainer_email:'trainer@example.com',
  verified_at:'2026-10-22T09:05:00Z',verified_by:'trainer@example.com',demo_marker:'[DEMO]'};
tables.TrainerForms.push(formRow);
const context = ctx.trainerCaseContext_(tables,session.session_id,cases[0].case_id);
assert.equal(context.trainer.email,'trainer@example.com');
assert.equal(ctx.verifyTrainerCalendar_(context,()=>event),event);
assert.throws(()=>ctx.trainerCaseContext_(tables,session.session_id,'CASE-OTHER'),/Zuordnung/);

const titles = ctx.TRAINER_QUESTIONS;
function response(id, {email='trainer@example.com',at=now,attendance='Ja, anwesend',assessment='Bestanden',note='',attestation=['Ja']}={}) {
  const values = [[titles.attendance,attendance],[titles.assessment,assessment],[titles.note,note],[titles.attestation,attestation]];
  return {getId:()=>id,getTimestamp:()=>new Date(at),getRespondentEmail:()=>email,
    getItemResponses:()=>values.map(([title,value])=>({getItem:()=>({getTitle:()=>title}),getResponse:()=>value}))};
}
function decide(r,prior=[]){return ctx.trainerAssessmentDecision_(context,formRow,r,prior,()=>event)}
const pass = decide(response('R-1'));
assert.equal(pass.disposition,'accepted');
assert.equal(pass.attendance,'attended');
assert.equal(pass.assessment,'passed');
assert.equal(pass.submittedAt,new Date(now).toISOString());
assert.equal(decide(response('R-2',{email:'one@example.com'})).disposition,'rejected');
assert.match(decide(response('R-2',{email:'one@example.com'})).reason,/Falsches Google-Konto/);
assert.equal(decide(response('R-3',{at:'2026-10-22T08:30:00Z'})).disposition,'rejected');
assert.match(decide(response('R-3A',{at:'2026-10-22T09:03:00Z'})).reason,/vor der manuellen Prüfung/);
assert.equal(decide(response('R-4',{attendance:'Nein, abwesend',assessment:'Bestanden',note:'Fehlte'})).disposition,'rejected');
assert.equal(decide(response('R-5',{attendance:'Nein, abwesend',assessment:'Nicht beurteilt'})).disposition,'rejected');
const absent = decide(response('R-6',{attendance:'Nein, abwesend',assessment:'Nicht beurteilt',note:'Ersatztermin planen.'}));
assert.equal(absent.disposition,'accepted');
assert.equal(decide(response('R-7',{assessment:'Nachschulung nötig',note:'Übung wiederholen.'})).disposition,'accepted');
assert.equal(decide(response('R-8',{assessment:'Nicht beurteilt',note:'Prüfung nachholen.'})).disposition,'accepted');
assert.equal(decide(response('R-9',{attestation:[]})).disposition,'rejected');
const savedPass={response_id:pass.responseId,disposition:'accepted'};
assert.equal(decide(response('R-10'),[savedPass]).disposition,'rejected');
assert.equal(decide(response('R-1'),[savedPass]).disposition,'duplicate');
assert.equal(ctx.trainerAssessmentDecision_(context,formRow,response('R-11'),[],()=>null).disposition,'rejected');
assert.equal(event.attendees[1].responseStatus,'needsAction','RSVP remains unrelated to attendance');

tables.TrainerAssessments=[{
  form_id:'FORM-ONE',session_id:session.session_id,case_id:cases[0].case_id,
  response_id:'R-1',attendance:'attended',assessment:'passed',note:'',reporter_email:'trainer@example.com',
  submitted_at:now,disposition:'accepted'
},{
  form_id:'FORM-TWO',session_id:session.session_id,case_id:cases[1].case_id,
  response_id:'R-6',attendance:'absent',assessment:'not_assessed',note:'Ersatztermin planen.',
  reporter_email:'trainer@example.com',submitted_at:now,disposition:'accepted'
}];
ctx.readDemoTables_=()=>tables;
const queue=ctx.trainerAssessmentQueue_();
assert.equal(queue.length,2);
assert.equal(queue[0].status,'awaiting_acknowledgement');
assert.equal(queue[1].status,'open');
assert.equal(queue[1].note,'Ersatztermin planen.');

const header=['response_id','form_id','session_id','case_id','person_key','reporter_email','submitted_at','attendance','assessment','note','attestation','disposition','reason','demo_marker'];
let sheetRows=[header];
ctx.DEMO_SCHEMA={sheets:{TrainerAssessments:header}};
ctx.assertHeaders_=(actual,expected)=>assert.deepEqual(actual,expected);
ctx.SpreadsheetApp={flush:()=>{}};
const sheet={getDataRange:()=>({getValues:()=>sheetRows}),appendRow:row=>sheetRows.push(row)};
assert.equal(ctx.saveTrainerAttempt_(pass,sheet).saved,true);
assert.equal(ctx.saveTrainerAttempt_(pass,sheet).saved,false);
assert.equal(sheetRows.length,2,'replay must not duplicate a response');
assert.equal(sheetRows[1][11],'accepted');
const pending={...formRow,verified_at:'',verified_by:''};
tables.TrainerForms=[pending];
const trainerFormHeader=['session_id','case_id','person_key','trainer_key','trainer_email','form_id','form_url','created_at','demo_marker','verified_at','verified_by'];
const pendingRow=[session.session_id,cases[0].case_id,'WOHNUNG','MATT','trainer@example.com','FORM-ONE','https://docs.google.com/forms/d/e/fake/viewform',now,'[DEMO]','',''];
const formRows=[trainerFormHeader,pendingRow];
ctx.Session={getEffectiveUser:()=>({getEmail:()=> 'trainer@example.com'})};
ctx.LockService={getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})};
ctx.calendarBookingGet_=()=>event;
ctx.FormApp={openById:()=>({collectsEmail:()=>true})};
ctx.findDemoSpreadsheet_=()=>({getSheetByName:()=>({
  getDataRange:()=>({getValues:()=>formRows}),
  getRange:(row,col,count,width)=>({setValues:values=>{
    assert.equal(row,2);assert.equal(col,10);assert.equal(count,1);assert.equal(width,2);
    formRows[1][9]=values[0][0];formRows[1][10]=values[0][1];
  }})
})});
assert.throws(()=>ctx.confirmTrainerVerifiedEmail({sessionId:session.session_id,caseId:cases[0].case_id}),/prüfen und bestätigen/);
const confirmed=ctx.confirmTrainerVerifiedEmail({sessionId:session.session_id,caseId:cases[0].case_id,confirmation:true});
assert.equal(confirmed.verifiedBy,'trainer@example.com');
assert.equal(formRows[1][10],'trainer@example.com');
assert.equal(ctx.trainerAssessmentDecision_(context,{...formRow,verified_at:'',verified_by:''},response('R-20'),[],()=>event).disposition,'rejected');
ctx.Session={getEffectiveUser:()=>({getEmail:()=> 'wrong@example.com'})};
assert.throws(()=>ctx.confirmTrainerVerifiedEmail({sessionId:session.session_id,caseId:cases[0].case_id,confirmation:true}),/Nur Process & Quality/);
console.log('Pass: assigned-trainer identity, post-session gate, per-person attendance/result, open cases, wrong-account and duplicate rejection, and RSVP separation.');
