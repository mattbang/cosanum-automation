import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const ctx = vm.createContext({Date, Set, Object, Array, Number, String});
for (const file of ['FormsIdentity.gs', 'IndividualProof.gs']) vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),ctx);
ctx.ScriptApp={getOAuthToken:()=> 'test-token'};
ctx.UrlFetchApp={fetch:url=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({
  formId:decodeURIComponent(url.split('/').at(-1)),settings:{emailCollectionType:'VERIFIED'}
})})};
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

// Completed proof replay checks the real archive/update/source gate, without rewriting assets.
for(const file of ['SkillUpdate.gs','Audit.gs']) vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),ctx);
const completed=clone();
const proof=Object.fromEntries(headers.map((key,i)=>[key,ledger.row[i]]));
proof.status='archived_verified';
completed.Proofs=[proof];
const archivedAt=new Date(Date.parse(proof.created_at)+60000).toISOString();
completed.ArchiveReceipts=[{
  proof_id:proof.proof_id,proof_version:1,case_id:proof.case_id,request_id:proof.request_id,
  person_key:proof.person_key,topic_id:proof.topic_id,source_hash:proof.source_hash,doc_id:proof.doc_id,pdf_id:proof.pdf_id,
  status:'verified',demo_marker:'[DEMO]',drive_pdf_sha256:'b'.repeat(64),local_pdf_sha256:'b'.repeat(64),local_docx_sha256:'c'.repeat(64),
  local_pdf_path:'/archive/proof.pdf',local_docx_path:'/archive/proof.docx',manifest_path:'/archive/proof.json',verified_at:archivedAt
}];
completed.SkillUpdates=[{
  idempotency_key:'SKILL-'+proof.proof_id+'-v1',case_id:proof.case_id,request_id:proof.request_id,person_key:proof.person_key,
  topic_id:proof.topic_id,previous_level:0,target_level:1,proof_id:proof.proof_id,proof_version:1,source_hash:proof.source_hash,
  archive_verified_at:archivedAt,status:'applied',demo_marker:'[DEMO]',applied_at:archivedAt
}];
completed.Skills.find(row=>row.person_key==='SUMNER').skill_level=1;
ctx.readDemoTables_=()=>completed;
ctx.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
let actor='owner@example.com',lookups=0;
ctx.Session={getEffectiveUser:()=>({getEmail:()=>actor})};
ctx.findDemoSpreadsheet_=()=>{throw Error('completed proof must not open a writable ledger');};
ctx.proofMetadataLookup_=(row,hash)=>{assert.equal(row[0],proof.proof_id);assert.equal(hash,'b'.repeat(64));lookups++;};
const completedBefore=JSON.stringify(completed);
const retry=ctx.createIndividualProof({caseId:proof.case_id});
assert.equal(retry.reused,true);assert.equal(retry.proofId,proof.proof_id);assert.equal(retry.status,'archived_verified');
assert.equal(lookups,1);assert.equal(JSON.stringify(completed),completedBefore);
actor='wrong@example.com';assert.throws(()=>ctx.createIndividualProof({caseId:proof.case_id}),/Process & Quality/);
actor='owner@example.com';completed.ParticipantAcknowledgements[0].typed_name='changed';
assert.throws(()=>ctx.createIndividualProof({caseId:proof.case_id}),/Originalantwort/);
completed.ParticipantAcknowledgements[0].typed_name='Test Asserted Name';
proof.source_hash='f'.repeat(64);completed.ArchiveReceipts[0].source_hash=proof.source_hash;completed.SkillUpdates[0].source_hash=proof.source_hash;
assert.throws(()=>ctx.createIndividualProof({caseId:proof.case_id}),/Originalbelege/);
