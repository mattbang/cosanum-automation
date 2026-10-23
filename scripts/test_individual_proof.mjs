import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const ctx = vm.createContext({Date, Set, Object, Array, Number, String});
vm.runInContext(fs.readFileSync('apps-script/IndividualProof.gs','utf8'),ctx);
const start='2026-10-22T10:00:00Z', end='2026-10-22T11:00:00Z';
const trainerAt='2026-10-22T11:10:00.293Z', participantAt='2026-10-22T11:20:00.652Z';
const base={
  Topics:[{topic_id:'TC_R052',display_name:'Hochregallager',source_material:'211019_DH_AA_6.3 Hochregallager',theory_required:true,practice_required:false,demo_marker:'[DEMO]'}],
  People:[
    {person_key:'MATT',email:'owner@example.com',display_alias:'Daniel [DEMO]',demo_marker:'[DEMO]'},
    {person_key:'SUMNER',email:'one@example.com',display_alias:'Selina Keller [DEMO]',persona_id:'PER-04',demo_marker:'[DEMO]'},
    {person_key:'WOHNUNG',email:'two@example.com',display_alias:'Marius Weber [DEMO]',persona_id:'PER-03',demo_marker:'[DEMO]'}],
  Requests:[{request_id:'REQ-GROUP',topic_id:'TC_R052',target_level:1,demo_marker:'[DEMO]'}],
  Skills:['SUMNER','WOHNUNG'].map(person_key=>({person_key,topic_id:'TC_R052',skill_level:0,demo_marker:'[DEMO]'})),
  ParticipantCases:['SUMNER','WOHNUNG'].map(person_key=>({case_id:'CASE-'+person_key,request_id:'REQ-GROUP',person_key,current_level:0,target_level:1,demo_marker:'[DEMO]'})),
  Sessions:[{session_id:'SES-GROUP',request_id:'REQ-GROUP',phase:'theory',mode:'group',trainer_key:'MATT',status:'invited',start_utc:start,end_utc:end,calendar_event_id:'evt-group',calendar_event_url:'https://calendar.example/evt-group',demo_marker:'[DEMO]'}],
  SessionCases:['SUMNER','WOHNUNG'].map(person_key=>({session_id:'SES-GROUP',case_id:'CASE-'+person_key,request_id:'REQ-GROUP',person_key,demo_marker:'[DEMO]'})),
  TrainerForms:[],TrainerAssessments:[],ParticipantForms:[],ParticipantAcknowledgements:[],Proofs:[],SkillUpdates:[]
};
const responses=new Map();
for(const personKey of ['SUMNER','WOHNUNG']){
  const caseId='CASE-'+personKey, email=base.People.find(p=>p.person_key===personKey).email;
  const trainerForm='TF-'+personKey, participantForm='PF-'+personKey;
  const trainerId='TR-'+personKey, participantId='PA-'+personKey;
  base.TrainerForms.push({session_id:'SES-GROUP',case_id:caseId,person_key:personKey,trainer_key:'MATT',trainer_email:'owner@example.com',form_id:trainerForm,verified_at:end,verified_by:'owner@example.com',demo_marker:'[DEMO]'});
  base.TrainerAssessments.push({response_id:trainerId,form_id:trainerForm,session_id:'SES-GROUP',case_id:caseId,person_key:personKey,reporter_email:'owner@example.com',submitted_at:trainerAt,attendance:'attended',assessment:'passed',attestation:'yes',note:'',disposition:'accepted',demo_marker:'[DEMO]'});
  base.ParticipantForms.push({session_id:'SES-GROUP',case_id:caseId,request_id:'REQ-GROUP',person_key:personKey,participant_email:email,form_id:participantForm,verified_at:end,verified_by:'owner@example.com',demo_marker:'[DEMO]'});
  base.ParticipantAcknowledgements.push({response_id:participantId,form_id:participantForm,request_id:'REQ-GROUP',session_id:'SES-GROUP',case_id:caseId,person_key:personKey,respondent_email:email,submitted_at:participantAt,typed_name:'Test Asserted Name',affirmative:'yes',disposition:'accepted',demo_marker:'[DEMO]'});
  responses.set(trainerForm,[{getId:()=>trainerId,getTimestamp:()=>new Date(trainerAt),getRespondentEmail:()=> 'owner@example.com',answers:{attendance:'attended',assessment:'passed',attestation:true,note:''}}]);
  responses.set(participantForm,[{getId:()=>participantId,getTimestamp:()=>new Date(participantAt),getRespondentEmail:()=>email,answers:{affirmative:true,typedName:'Test Asserted Name'}}]);
}
ctx.FormApp={openById:id=>({getResponses:()=>responses.get(id)||[]})};
ctx.trainerAnswers_=response=>response.answers;
ctx.participantAnswers_=response=>response.answers;
ctx.eligibility_=()=>({allowed:true});
ctx.demoFlag_=value=>value===true;
ctx.trainerCaseContext_=(tables,sessionId,caseId)=>{
  const session=tables.Sessions.find(s=>s.session_id===sessionId),personCase=tables.ParticipantCases.find(c=>c.case_id===caseId);
  return {session,personCase,request:tables.Requests[0],topic:tables.Topics[0],
    person:tables.People.find(p=>p.person_key===personCase.person_key),trainer:tables.People[0],owner:tables.People[0]};
};
ctx.verifyTrainerCalendar_=()=>({htmlLink:'https://calendar.example/evt-group',location:'Lager'});
ctx.calendarBookingGet_=()=>({});
ctx.SLOT_TIME_ZONE='Europe/Zurich';
ctx.Utilities={DigestAlgorithm:{SHA_256:'SHA256'},Charset:{UTF_8:'UTF8'},
  computeDigest:(_,value)=>Array.from(crypto.createHash('sha256').update(value).digest()).map(b=>b>127?b-256:b),
  formatDate:(date,zone,format)=>{assert.equal(zone,'Europe/Zurich');return date.toISOString().slice(0,16).replace('T',' ');}};
const first=ctx.proofSourceModel_(base,'CASE-SUMNER');
const second=ctx.proofSourceModel_(base,'CASE-WOHNUNG');
assert.notEqual(first.proofId,second.proofId,'two members of one group need distinct proofs');
assert.equal(first.phases.length,1);
assert.equal(first.materialVersion,'Nicht dokumentiert');
const rendered=ctx.proofText_(first,'2026-10-23T12:00:00Z');
for(const value of [first.proofId,'[DEMO]','Test Asserted Name','one@example.com','Selina Keller [DEMO]','TR-SUMNER','PA-SUMNER','Nicht dokumentiert']) assert.ok(rendered.includes(value));
assert.match(rendered,/Selbstauskunft, keine verifizierte Mitarbeiteridentität/);
assert.doesNotMatch(rendered,/Archiv geprüft|Skillstufe eingetragen/);

const clone=()=>structuredClone(base);
let data=clone();data.ParticipantAcknowledgements=data.ParticipantAcknowledgements.filter(r=>r.case_id!=='CASE-SUMNER');
assert.throws(()=>ctx.proofSourceModel_(data,'CASE-SUMNER'),/Bestätigung/);
data=clone();data.TrainerAssessments=data.TrainerAssessments.filter(r=>r.case_id!=='CASE-SUMNER');
assert.throws(()=>ctx.proofSourceModel_(data,'CASE-SUMNER'),/Trainerbericht/);
data=clone();data.ParticipantAcknowledgements[0].respondent_email='wrong@example.com';
assert.throws(()=>ctx.proofSourceModel_(data,'CASE-SUMNER'),/Kontozuordnung/);
data=clone();data.Sessions[0].calendar_event_url='https://calendar.example/wrong';
assert.throws(()=>ctx.proofSourceModel_(data,'CASE-SUMNER'),/Kalenderlink/);
data=clone();data.SessionCases.splice(0,1);
assert.throws(()=>ctx.proofSourceModel_(data,'CASE-SUMNER'),/Schulungsteile/);
data=clone();data.Skills[0].skill_level=1;
assert.throws(()=>ctx.proofSourceModel_(data,'CASE-SUMNER'),/Skillstand/);
data=clone();data.ParticipantAcknowledgements[0].typed_name='Altered';
assert.throws(()=>ctx.proofSourceModel_(data,'CASE-SUMNER'),/Originalantwort/);

const headers=['proof_id','proof_version','request_id','case_id','person_key','topic_id','source_hash','created_at','folder_id','doc_id','pdf_id','status','demo_marker'];
ctx.DEMO_SCHEMA={sheets:{Proofs:headers}};
ctx.assertHeaders_=(actual,expected)=>assert.deepEqual(actual,expected);
ctx.SpreadsheetApp={flush:()=>{}};
const rows=[headers];
const sheet={getDataRange:()=>({getValues:()=>rows}),appendRow:row=>rows.push(row),getLastRow:()=>rows.length,
  getRange:(number,column,count,width)=>({setValues:values=>{assert.equal(count,1);for(let i=0;i<width;i++)rows[number-1][column-1+i]=values[0][i];}})};
const key=ctx.proofHash_(first), ledger=ctx.proofLedgerRow_(sheet,first,key);
assert.equal(ledger.reused,false);
assert.equal(ctx.proofLedgerRow_(sheet,first,key).reused,true);
assert.equal(rows.length,2);
assert.throws(()=>ctx.proofLedgerRow_(sheet,first,'changed'),/Korrekturversion/);
ctx.proofSaveAssets_(sheet,ledger,'folder-id','doc-id','pdf-id','pending_local_archive');
assert.equal(rows[1][11],'pending_local_archive');
console.log('Pass: two-person group proofs, source gates, identity labels, content, and idempotent ledger.');
