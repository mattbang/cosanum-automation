import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('apps-script/Index.html','utf8');
function declaration(name) {
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} is available for view-only loading`);
  const next=html.indexOf('\nfunction ',start+1);
  let source=html.slice(start,next<0?html.indexOf('</script>',start):next);
  const lines=source.split('\n');
  while(lines.length && !lines.at(-1).trim().endsWith('}'))lines.pop();
  return lines.join('\n');
}
const elements=new Map(),created=[];
function element(tag='div') {
  const node={tag,children:[],listeners:{},dataset:{},classList:{toggle(){}},textContent:'',
    appendChild(child){this.children.push(child);return child;},
    replaceChildren(){this.children=[];},addEventListener(name,handler){this.listeners[name]=handler;}};
  created.push(node);return node;
}
const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
const calls=[];
let applyFails=false;
const rows=[{caseId:'CASE-A',requestId:'REQ-A',personKey:'A',previousLevel:0,targetLevel:1,state:'ready'},
  {caseId:'CASE-B',requestId:'REQ-B',personKey:'B',previousLevel:0,targetLevel:1,state:'ready'}];
function chain(success,failure) {
  return new Proxy({}, {get(_target,name){
    if(name==='withSuccessHandler')return callback=>chain(callback,failure);
    if(name==='withFailureHandler')return callback=>chain(success,callback);
    return (...args)=>{
      calls.push({name,args});
      if(name==='getRsvpStatus'){success?.({rows:[],errors:[],checkedAt:'test',persisted:false});return;}
      if(name==='getSkillUpdateQueue'){success?.(rows);return;}
      if(name==='applyVerifiedSkillUpdate'){
        if(applyFails)failure?.({message:'synthetic individual failure'});else success?.({});
        return;
      }
      throw Error(`Unexpected workflow call during view loading: ${String(name)}`);
    };
  }});
}
const context=vm.createContext({
  document:{getElementById:get,querySelector:()=>element(),createElement:element},
  google:{script:{run:chain()}},
  taskDefinitions:[{id:'rsvp',instruction:'Read invitations'},{id:'skill',instruction:'Read skill state'}],
  activeTask:'intake',switchView(){},renderStepper(){},hubRequest:()=>null,
  filterTaskRows:data=>data.filter(row=>row.requestId==='REQ-A'),
  renderRsvps(){},loadProofQueue(){},
});
for(const name of ['readRsvps','readSkillQueue','renderSkillQueue','setTask'])vm.runInContext(declaration(name),context);
context.setTask('rsvp');context.setTask('skill');
assert.deepEqual(calls.map(call=>call.name),['getRsvpStatus','getSkillUpdateQueue'],
  'opening views reads their data and never reconciles or applies it');

for(const failure of [false,true]) {
  calls.length=0;created.length=0;applyFails=failure;
  context.renderSkillQueue(rows);
  const button=created.find(node=>node.tag==='button' && node.textContent==='Skillstufe übernehmen');
  assert.ok(button,'the selected case has an individual action');
  button.listeners.click();
  assert.deepEqual(calls.map(call=>call.name),['applyVerifiedSkillUpdate','getSkillUpdateQueue'],
    'individual success and failure both refresh through a read, never through batch processing');
  assert.equal(calls[0].args[0].caseId,'CASE-A','the individual action stays bound to the selected case');
  if(failure)assert.match(get('skillStatus').textContent,/synthetic individual failure/,'readback preserves the original failure');
}
console.log('Read-only navigation and individual skill action boundaries passed.');
