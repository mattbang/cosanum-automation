import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HEADERS={
  Skills:['person_key','topic_id','skill_level','status_mark','demo_marker'],
  SkillUpdates:['idempotency_key','case_id','request_id','person_key','topic_id','previous_level','target_level','proof_id','proof_version','source_hash','archive_verified_at','applied_at','status','reason','demo_marker']
};
const HASH='a'.repeat(64),PDF_HASH='b'.repeat(64),DOCX_HASH='c'.repeat(64);
const CASE='CASE-ABCD-SUMNER',PROOF='PRF-ABCD-SUMNER';
function fixture(){return {
  People:[{person_key:'MATT',email:'owner@example.com',demo_marker:'[DEMO]'}],
  ParticipantCases:[{case_id:CASE,request_id:'REQ-ABCD',person_key:'SUMNER',current_level:0,target_level:1,demo_marker:'[DEMO]'}],
  Requests:[{request_id:'REQ-ABCD',topic_id:'TC_R052',target_level:1,demo_marker:'[DEMO]'}],
  Proofs:[{proof_id:PROOF,proof_version:1,request_id:'REQ-ABCD',case_id:CASE,person_key:'SUMNER',topic_id:'TC_R052',source_hash:HASH,created_at:'2026-10-22T12:00:00Z',doc_id:'doc-id',pdf_id:'pdf-id',status:'archived_verified',demo_marker:'[DEMO]'}],
  ArchiveReceipts:[{proof_id:PROOF,proof_version:1,case_id:CASE,request_id:'REQ-ABCD',person_key:'SUMNER',topic_id:'TC_R052',source_hash:HASH,doc_id:'doc-id',pdf_id:'pdf-id',drive_pdf_sha256:PDF_HASH,local_pdf_sha256:PDF_HASH,local_docx_sha256:DOCX_HASH,local_pdf_path:'/archive/proof.pdf',local_docx_path:'/archive/proof.docx',manifest_path:'/archive/manifest.json',verified_at:'2026-10-23T12:00:00Z',status:'verified',demo_marker:'[DEMO]'}],
  SkillUpdates:[]
}}
function makeSheet(rows){return {
  rows,getDataRange(){return {getValues:()=>this.rows.map(row=>row.slice())}},
  getRange(n,c,count=1,width=1){return {
    getValue:()=>this.rows[n-1][c-1],setValue:v=>{this.rows[n-1][c-1]=v},
    setValues:values=>{assert.equal(values.length,count);for(let i=0;i<count;i++)for(let j=0;j<width;j++)this.rows[n-1+i][c-1+j]=values[i][j]}
  }},appendRow(row){this.rows.push(row.slice())}
}}
function setup(){
  const ctx=vm.createContext({Date,Set,Object,Array,Number,String});
  vm.runInContext(fs.readFileSync('apps-script/SkillUpdate.gs','utf8'),ctx);
  const tables=fixture();
  const skills=makeSheet([HEADERS.Skills,['SUMNER','TC_R052',0,'S','[DEMO]']]);
  const updates=makeSheet([HEADERS.SkillUpdates]);
  ctx.DEMO_SCHEMA={sheets:HEADERS};
  ctx.PROOF_VERSION=1;
  ctx.proofUnique_=(rows,predicate,label)=>{const found=rows.filter(predicate);if(found.length!==1)throw Error(label+' fehlt oder ist nicht eindeutig.');return found[0]};
  ctx.proofIso_=(value)=>new Date(value).toISOString();
  ctx.proofEmail_=(email)=>String(email||'').trim().toLowerCase();
  ctx.proofSourceModel_=()=>({proofId:PROOF,previousLevel:'0',targetLevel:'1'});
  ctx.proofHash_=()=>HASH;
  ctx.assertHeaders_=(actual,expected)=>assert.deepEqual(actual,expected);
  ctx.readDemoTables_=()=>({...tables,Skills:skills.rows.slice(1).map(row=>({person_key:row[0],topic_id:row[1],skill_level:row[2],demo_marker:row[4]})),SkillUpdates:updates.rows.slice(1).map(row=>Object.fromEntries(HEADERS.SkillUpdates.map((key,i)=>[key,row[i]])))});
  ctx.findDemoSpreadsheet_=()=>({getSheetByName:name=>({Skills:skills,SkillUpdates:updates})[name]});
  ctx.Session={getEffectiveUser:()=>({getEmail:()=> 'owner@example.com'})};
  ctx.LockService={getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})};
  ctx.SpreadsheetApp={flush:()=>{}};
  return {ctx,tables,skills,updates};
}

{
  const {ctx,skills,updates}=setup();
  assert.equal(ctx.getSkillUpdateQueue()[0].state,'ready');
  const first=ctx.applyVerifiedSkillUpdate({caseId:CASE});
  assert.equal(first.status,'applied');assert.equal(first.reused,false);
  assert.equal(skills.rows[1][2],1);assert.equal(updates.rows.length,2);
  assert.equal(updates.rows[1][5],0);assert.equal(updates.rows[1][6],1);
  assert.equal(updates.rows[1][7],PROOF);assert.equal(updates.rows[1][12],'applied');
  assert.ok(updates.rows[1][11]);assert.equal(ctx.getSkillUpdateQueue()[0].state,'applied');
  const replay=ctx.applyVerifiedSkillUpdate({caseId:CASE});
  assert.equal(replay.reused,true);assert.equal(skills.rows[1][2],1);assert.equal(updates.rows.length,2);
  // A later separate completion must not cause an old replay to downgrade the matrix.
  skills.rows[1][2]=2;assert.equal(ctx.applyVerifiedSkillUpdate({caseId:CASE}).reused,true);
  assert.equal(skills.rows[1][2],2);
}
{
  const {ctx,skills,updates}=setup();
  const first=ctx.processVerifiedSkillUpdates();
  assert.equal(first.applied.length,1);assert.equal(first.errors.length,0);
  assert.equal(first.rows[0].state,'applied');assert.equal(skills.rows[1][2],1);
  const second=ctx.processVerifiedSkillUpdates();
  assert.equal(second.applied.length,0);assert.equal(updates.rows.length,2);
}
{
  const {ctx,skills,updates}=setup();
  skills.rows[1][2]=2;
  assert.equal(ctx.getSkillUpdateQueue()[0].state,'ready'); // UI source stub does not inspect the matrix.
  assert.throws(()=>ctx.applyVerifiedSkillUpdate({caseId:CASE}),/Skillkonflikt/);
  assert.equal(skills.rows[1][2],2);assert.equal(updates.rows.length,1);
}
{
  const {ctx,tables,skills,updates}=setup();
  tables.Proofs[0].status='pending_local_archive';
  assert.throws(()=>ctx.applyVerifiedSkillUpdate({caseId:CASE}),/Archive/);
  assert.equal(skills.rows[1][2],0);assert.equal(updates.rows.length,1);
}
{
  const {ctx,tables}=setup();tables.ArchiveReceipts[0].local_pdf_sha256='f'.repeat(64);
  assert.throws(()=>ctx.applyVerifiedSkillUpdate({caseId:CASE}),/Archivbeleg/);
}
{
  const {ctx,tables}=setup();tables.ParticipantCases[0].target_level=4;
  assert.throws(()=>ctx.applyVerifiedSkillUpdate({caseId:CASE}),/Stufe 4/);
}
{
  const {ctx,skills,updates}=setup();
  updates.rows.push(['SKILL-'+PROOF+'-v1',CASE,'REQ-ABCD','SUMNER','TC_R052',0,1,PROOF,1,HASH,'2026-10-23T12:00:00.000Z','','pending','','[DEMO]']);
  skills.rows[1][2]=1;
  const recovered=ctx.applyVerifiedSkillUpdate({caseId:CASE});
  assert.equal(recovered.status,'applied');assert.equal(updates.rows.length,2);
}
{
  const {ctx}=setup();ctx.proofSourceModel_=()=>{throw Error('Trainerbericht fehlt')};
  assert.throws(()=>ctx.applyVerifiedSkillUpdate({caseId:CASE}),/Trainerbericht/);
}
{
  const {ctx}=setup();let triggers=[];
  ctx.SLOT_TIME_ZONE='Europe/Zurich';
  ctx.ScriptApp={getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased:()=>({atHour:hour=>({everyDays:days=>({inTimezone:zone=>({create:()=>{assert.equal(handler,'processVerifiedSkillUpdates');assert.equal(hour,9);assert.equal(days,1);assert.equal(zone,'Europe/Zurich');triggers.push({getHandlerFunction:()=>handler})}})})})})})};
  assert.equal(ctx.installSkillDailyProcessor().reused,false);
  assert.equal(ctx.installSkillDailyProcessor().reused,true);
  assert.equal(triggers.length,1);
}
console.log('Pass: gated archive receipt, one synthetic skill write, idempotent replay, conflict, level-4 block, and interrupted recovery.');
