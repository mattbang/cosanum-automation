import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture = JSON.parse(fs.readFileSync('fixtures/synthetic_demo.json', 'utf8'));
const people = fixture.People.map(row => ({person_key:row[0],email:row[1],demo_marker:row[3],display_alias:row[5]}));
const byKey = key => people.find(person => person.person_key === key);
const formatDate = (date, zone) => new Intl.DateTimeFormat('en-CA', {
  timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'
}).format(date);
const context = vm.createContext({
  Date, Set, String, Number, Object,
  Utilities: {
    formatDate, DigestAlgorithm:{SHA_256:'sha256'}, Charset:{UTF_8:'utf8'},
    computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()]
  },
  SpreadsheetApp: {flush() {}},
  SLOT_TIME_ZONE:'Europe/Zurich'
});
for (const file of ['Booking.gs','Rsvp.gs']) vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'), context);
const session = {
  session_id:'SES-RSVP-GROUP',request_id:'REQ-RSVP',phase:'theory',mode:'group',
  demo_marker:'[DEMO]',status:'invited',start_utc:'2026-10-26T08:00:00Z',end_utc:'2026-10-26T09:00:00Z',
  calendar_event_id:context.bookingEventId_('SES-RSVP-GROUP'),calendar_event_url:'https://calendar.google.com/calendar/event?eid=synthetic'
};
const cases = ['WOHNUNG','MARIE'].map((key,index)=>({case_id:'CASE-'+index,request_id:session.request_id,person_key:key,demo_marker:'[DEMO]'}));
const tables = {
  Sessions:[session], People:people, ParticipantCases:cases,
  SessionCases:cases.map(c=>({session_id:session.session_id,case_id:c.case_id,request_id:session.request_id,person_key:c.person_key,demo_marker:'[DEMO]'}))
};
const event = {
  id:session.calendar_event_id,status:'confirmed',start:{dateTime:'2026-10-26T09:00:00+01:00'},
  end:{dateTime:'2026-10-26T10:00:00+01:00'},
  extendedProperties:{private:{cosanumSessionId:session.session_id,cosanumRequestId:session.request_id,cosanumMarker:'DEMO'}},
  attendees:[
    {email:byKey('WOHNUNG').email,responseStatus:'declined'},
    {email:byKey('MARIE').email,responseStatus:'accepted'}
  ]
};
const eventBefore = JSON.stringify(event);
let gets = 0;
const getEvent = id => {gets++; assert.equal(id,session.calendar_event_id); return event;};
assert.equal(context.priorBusinessDate_(session.start_utc),'2026-10-23');
const before = context.rsvpSnapshotModel_(tables,getEvent,new Date('2026-10-22T12:00:00Z'));
assert.equal(before.rows[0].flag,'declined');
assert.equal(before.rows[1].flag,'');
const due = context.rsvpSnapshotModel_(tables,getEvent,new Date('2026-10-23T08:00:00Z'));
assert.equal(due.rows[0].flag,'declined');
assert.equal(due.rows[1].flag,'');
assert.equal(due.rows[0].caseId,cases[0].case_id);
assert.equal(due.rows[1].caseId,cases[1].case_id);
assert.equal(JSON.stringify(event),eventBefore,'read-only monitoring never changes the group event');
event.attendees[1].responseStatus='needsAction';
const unanswered = context.rsvpSnapshotModel_(tables,getEvent,new Date('2026-10-23T09:00:00Z'));
assert.equal(unanswered.rows[1].flag,'unanswered');
assert.equal(unanswered.rows[1].responseStatus,'needsAction');
assert.equal(unanswered.rows.length,2,'each participant retains an individual case');
assert.equal(context.rsvpFlag_('needsAction',session.start_utc,new Date('2026-10-22T12:00:00Z')),'');

const header = ['session_id','case_id','person_key','calendar_event_id','response_status','checked_at','flag','flagged_at','demo_marker'];
const state = [header];
const sheet = {
  getDataRange:()=>({getValues:()=>state.map(row=>row.slice())}),
  getLastRow:()=>state.length,
  getRange:(row,col,count,width)=>({setValues(values){
    assert.equal(count,1); assert.equal(col,1); assert.equal(width,9);
    state[row-1]=values[0].slice();
  }})
};
const spreadsheet = {getSheetByName:name=>name==='SessionRsvps'?sheet:null};
context.DEMO_SCHEMA={sheets:{SessionRsvps:header}};
context.assertHeaders_=(actual,expected)=>assert.deepEqual(actual,expected);
context.saveRsvpSnapshot_(unanswered,spreadsheet);
assert.equal(state.length,3);
const firstFlaggedAt = state[2][7];
context.saveRsvpSnapshot_(context.rsvpSnapshotModel_(tables,getEvent,new Date('2026-10-23T10:00:00Z')),spreadsheet);
assert.equal(state.length,3,'retry creates no duplicate RSVP row');
assert.equal(state[2][7],firstFlaggedAt,'retry preserves first flag time');
assert.equal(state[0].length,9);
assert.equal(session.status,'invited');
event.attendees[1].responseStatus='accepted';
context.saveRsvpSnapshot_(context.rsvpSnapshotModel_(tables,getEvent,new Date('2026-10-23T11:00:00Z')),spreadsheet);
assert.equal(state[2][6],'','accepted response clears unanswered flag');
assert.equal(state[2][7],'');

const bad = {...event,extendedProperties:{private:{}}};
const blocked = context.rsvpSnapshotModel_(tables,()=>bad,new Date('2026-10-23T12:00:00Z'));
assert.equal(blocked.rows.length,0);
assert.equal(blocked.errors.length,1);
assert.equal(state.length,3,'Calendar errors cannot fabricate a response');
assert.throws(()=>context.saveRsvpSnapshot_({...due,rows:[{...due.rows[0],eventId:'changed'}]},spreadsheet),/Widersprüchlicher/);
assert(gets>=4);
console.log('Pass: group decline retains other guests, prior-business-day no-reply flag, idempotent case snapshots, and failed Calendar reads do not invent RSVPs.');
