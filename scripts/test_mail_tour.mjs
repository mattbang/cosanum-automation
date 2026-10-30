import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('mail-tour/Code.gs','utf8');
const formatDate=(date,zone,pattern)=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  if(pattern==='yyyy-MM-dd')return `${parts.year}-${parts.month}-${parts.day}`;
  if(pattern==='yyyyMMdd')return `${parts.year}${parts.month}${parts.day}`;
  if(pattern==='dd.MM.yyyy')return `${parts.day}.${parts.month}.${parts.year}`;
  throw Error('Unexpected format');
};
const context=vm.createContext({
  Date,JSON,Number,String,Set,Array,
  Utilities:{formatDate}
});
vm.runInContext(source,context);
const publicPage=fs.readFileSync('docs/demo-tour/index.html','utf8');
const senderPage=fs.readFileSync('mail-tour/Index.html','utf8');
const publicBusy=publicPage.match(/const BUSY=(\{[^;]+\});/);
const senderBusy=senderPage.match(/const BUSY=(\{[^;]+\});/);
assert.ok(publicBusy && senderBusy,'Both pages define a synthetic availability grid');
assert.equal(senderBusy[1],publicBusy[1],'Sender and published preview must show identical availability');
assert.equal(JSON.stringify(vm.runInNewContext('('+senderBusy[1]+')')),JSON.stringify(vm.runInNewContext('('+JSON.stringify(context.MAIL_TOUR_BUSY_)+')')));
new vm.Script(senderPage.match(/<script>([\s\S]*?)<\/script>/)[1]);
const now=new Date('2026-10-24T12:00:00Z');
const input={email:'Te.st+demo@Example.com',mode:'group',trainer:'pq',participants:['ma1','ma2'],day:0,hour:10};
function harness({quota=100,failAt=0}={}){
  const properties=new Map(),cache=new Map(),sent=[];
  let seq=0,locked=false;
  const services={
    now:()=>now,
    lock:{waitLock:()=>{assert.equal(locked,false);locked=true;},releaseLock:()=>{assert.equal(locked,true);locked=false;}},
    properties:{getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),getProperties:()=>Object.fromEntries(properties),deleteProperty:key=>properties.delete(key)},
    cache:{get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)},
    quota:()=>quota,
    send:message=>{if(failAt && sent.length+1===failAt)throw Error('Transport unknown');sent.push(message);},
    url:()=> 'https://script.google.com/macros/s/TEST_EXEC/exec',
    uuid:()=>String(++seq).padStart(32,'a'),
    digest:value=>crypto.createHash('sha256').update(value).digest('hex')
  };
  const request=(value=input)=>context.requestTourCore_(value,services);
  const token=()=>sent[0].body.match(/\?token=([a-f0-9]{64})/)[1];
  const confirm=value=>context.confirmTourCore_(value||token(),services);
  return {services,properties,cache,sent,request,confirm,token};
}

const flow=harness();
assert.equal(flow.request().ok,true);
assert.equal(flow.sent.length,1);
assert.match(flow.sent[0].subject,/bestätigen/);
assert.equal(flow.confirm().ok,true);
assert.equal(flow.sent.length,10);
assert.equal(flow.sent.slice(1).every(x=>x.to===input.email),true);
assert.equal(flow.sent.slice(1).every(x=>/^\[DEMO\]\[[^\]]+\]\[\d+\/9\]/.test(x.subject)),true);
assert.equal(flow.sent.some(x=>/forms\.google|calendar\.google|docs\.google|REQ-/.test(x.body)),false);
assert.throws(()=>flow.confirm(),/abgelaufen oder bereits benutzt/);
assert.throws(()=>flow.request(),/bereits/);
assert.equal([...flow.properties.values()].some(value=>String(value).includes(input.email)),false);

const single=harness();
assert.equal(single.request({...input,mode:'group',trainer:'hcm4',participants:['ma1'],hour:11}).ok,true);
assert.equal(single.confirm().ok,true);
assert.equal(single.sent.length,8);
assert.match(single.sent[3].subject,/HCM4/);

const three=harness();
assert.equal(three.request({...input,trainer:'lead',participants:['ma1','ma2','ma3'],day:2,hour:11}).ok,true);
assert.equal(three.confirm().ok,true);
assert.equal(three.sent.length,12);

for(const bad of [
  {...input,email:'a\nb@example.com'},
  {...input,mode:'individual'},
  {...input,trainer:'hcm4'},
  {...input,participants:['ma1','ma1']},
  {...input,day:0,hour:9},
  {...input,participants:['ma1','outsider']}
])assert.throws(()=>context.mailTourInput_(bad,now));

const cap=harness();
for(let i=0;i<5;i++)assert.equal(cap.request({...input,email:`visitor${i}@example.com`}).ok,true);
assert.throws(()=>cap.request({...input,email:'visitor5@example.com'}),/Zu viele/);
assert.equal(cap.sent.length,5);

const noQuota=harness({quota:9});
assert.throws(()=>noQuota.request(),/Kontingent/);
assert.equal(noQuota.sent.length,0);
const confirmQuota=harness();
confirmQuota.request();confirmQuota.services.quota=()=>8;
assert.throws(()=>confirmQuota.confirm(),/Kontingent/);
confirmQuota.services.quota=()=>100;
assert.equal(confirmQuota.confirm().ok,true);

const partial=harness({failAt:4});
assert.equal(partial.request().ok,true);
const partialResult=partial.confirm();
assert.equal(partialResult.ok,false);
assert.match(partialResult.message,/unklar/);
assert.equal(partial.sent.length,3);
assert.throws(()=>partial.confirm(),/abgelaufen oder bereits benutzt/);
assert.equal([...partial.properties.values()].some(value=>String(value).includes('sending_unknown')),true);

const expired=harness();
expired.request();expired.cache.clear();
assert.throws(()=>expired.confirm(),/abgelaufen/);
const cleanup=harness();
cleanup.properties.set('total.20260801','5');
cleanup.properties.set('address.20260801.oldhash','reserved');
cleanup.properties.set('receipt.oldhash',JSON.stringify({status:'unknown',day:'20260801'}));
cleanup.request();
assert.equal([...cleanup.properties.keys()].some(key=>key.includes('20260801')||key==='receipt.oldhash'),false);
console.log('mail tour: validation, confirmation, role labels, caps, quota, expiry and uncertain send passed');
