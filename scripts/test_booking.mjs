import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture = JSON.parse(fs.readFileSync('fixtures/synthetic_demo.json', 'utf8'));
const headers = {
  Topics: ['topic_id','display_name','source_material','theory_required','practice_required','theory_minutes','practice_minutes','group_suitability','progression_rule','demo_marker','configured_target_level'],
  People: ['person_key','email','demo_role','demo_marker','persona_id','display_alias'],
  Requests: ['request_id','action_id','topic_id','target_level','status','created_at','demo_marker','mode'],
  ParticipantCases: ['case_id','request_id','person_key','current_level','target_level','status','created_at','demo_marker'],
  Sessions: ['session_id','request_id','phase','phase_order','mode','trainer_key','duration_minutes','theory_session_id','status','created_at','demo_marker','calendar_event_id','start_utc','end_utc','calendar_event_url'],
  SessionCases: ['session_id','case_id','request_id','person_key','demo_marker']
};
const objects = (name, rows) => rows.map(row => Object.fromEntries(headers[name].map((header, index) => [header, row[index] ?? ''])));
const requestId = 'REQ-BOOK-TEST';
const makeTables = () => ({
  Topics: objects('Topics', fixture.Topics), People: objects('People', fixture.People),
  Requests: objects('Requests', [[requestId,'','TC_R030',1,'draft','','[DEMO]','group']]),
  ParticipantCases: objects('ParticipantCases', [['CASE-W',requestId,'WOHNUNG',0,1,'draft','','[DEMO]']]),
  Sessions: objects('Sessions', [
    ['SES-T',requestId,'theory',1,'group','MATT',60,'','planned','','[DEMO]','','','',''],
    ['SES-P',requestId,'practice',2,'individual','MARIE',180,'SES-T','planned','','[DEMO]','','','','']
  ]),
  SessionCases: objects('SessionCases', [
    ['SES-T','CASE-W',requestId,'WOHNUNG','[DEMO]'], ['SES-P','CASE-W',requestId,'WOHNUNG','[DEMO]']
  ])
});
const zone = 'Europe/Zurich';
const dateParts = (date, timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
}).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
const formatDate = (date, timeZone, pattern) => {
  const p = dateParts(date, timeZone);
  if (pattern === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
  if (pattern === "yyyy-MM-dd'T'HH:mm:ssXXX") {
    const localAsUtc = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    const offset = Math.round((localAsUtc-date.getTime())/60000);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}`;
  }
  throw new Error('Unexpected format ' + pattern);
};
const parseDate = (input, timeZone) => {
  const [y,m,d,h,minute] = input.match(/\d+/g).map(Number);
  const target = Date.UTC(y,m-1,d,h,minute);
  const guess = new Date(target);
  const p = dateParts(guess, timeZone);
  const localAsUtc = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
  return new Date(target - (localAsUtc-target));
};
const utilities = {
  formatDate, parseDate,
  DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()]
};
const context = vm.createContext({ Date, Set, Number, JSON, String, Utilities: utilities });
for (const file of ['Availability.gs','Booking.gs']) vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), context);
const now = new Date('2026-10-23T10:00:00Z');
const freeReply = ids => ({ calendars: Object.fromEntries(ids.map(id => [id, {busy:[]}])) });
const candidate = (tables, id) => context.slotProposalModel_(id, tables, now, freeReply).proposals[0];
const selected = (id, slot) => ({sessionId:id,startUtc:slot.startUtc,endUtc:slot.endUtc});
const makeServices = tables => {
  const events = new Map();
  let inserts = 0;
  let failSave = false;
  let failInsertResponse = false;
  let freeBusy = freeReply;
  return {
    events, get inserts() {return inserts;}, set failSave(value) {failSave=value;}, set failInsertResponse(value) {failInsertResponse=value;},
    set freeBusy(value) {freeBusy=value;},
    services: {
      readTables: () => tables, now: () => now, freeBusy: (...args) => freeBusy(...args),
      getEvent: id => events.get(id) || null,
      insertEvent: body => {
        inserts++;
        if (events.has(body.id)) throw new Error('409 duplicate');
        const event = {...body, status:'confirmed', htmlLink:'https://calendar.google.com/calendar/event?eid=synthetic', organizer:{email:fixture.People[0][1]}};
        events.set(body.id,event);
        if (failInsertResponse) throw new Error('timeout after insert');
        return event;
      },
      saveReceipt: (session, receipt) => {
        if (failSave) throw new Error('Sheet temporarily unavailable');
        Object.assign(session, {status:'invited',calendar_event_id:receipt.eventId,start_utc:receipt.startUtc,end_utc:receipt.endUtc,calendar_event_url:receipt.eventUrl});
      }
    }
  };
};

const tables = makeTables();
const gateway = makeServices(tables);
const theory = candidate(tables,'SES-T');
const practice = candidate(tables,'SES-P');
assert.throws(() => context.bookSessionCore_(selected('SES-P',practice),gateway.services), /Zuerst muss/);
assert.equal(gateway.inserts,0);
const first = context.bookSessionCore_(selected('SES-T',theory),gateway.services);
assert.equal(first.reused,false);
assert.equal(gateway.inserts,1);
assert.equal(tables.Sessions[0].status,'invited');
assert.equal(first.startUtc,theory.startUtc);
assert.equal(first.endUtc,theory.endUtc);
const savedEvent = gateway.events.get(first.eventId);
assert.equal(savedEvent.summary,`[DEMO] Schulung: ${fixture.Topics[0][1]} · Theorie`);
assert.equal(savedEvent.guestsCanSeeOtherGuests,false);
assert.equal(savedEvent.start.timeZone,zone);
assert.equal(savedEvent.start.dateTime,theory.startLocal);
assert.deepEqual(Array.from(savedEvent.attendees.map(a=>a.email)).sort(),fixture.People.filter(p=>['MATT','WOHNUNG'].includes(p[0])).map(p=>p[1]).sort());
assert(!savedEvent.description.includes('CASE-W'));
assert.equal(context.bookSessionCore_(selected('SES-T',theory),gateway.services).reused,true);
assert.equal(gateway.inserts,1);
assert.throws(() => context.bookSessionCore_(selected('SES-T',{...theory,startUtc:new Date(Date.parse(theory.startUtc)+3600000).toISOString()}),gateway.services),/anderen Termin/);
assert.equal(gateway.inserts,1);
assert.throws(() => context.bookSessionCore_(selected('SES-P',practice),gateway.services),/nach dem Theorietermin|überschneidet/);
const laterPractice = context.slotProposalModel_('SES-P',tables,now,freeReply).proposals.find(s=>Date.parse(s.startUtc)>=Date.parse(theory.endUtc));
assert(laterPractice);
assert.equal(context.bookSessionCore_(selected('SES-P',laterPractice),gateway.services).reused,false);
assert.equal(gateway.inserts,2);
assert.equal(tables.Sessions[1].status,'invited');

const blockedTables = makeTables();
const blockedGateway = makeServices(blockedTables);
const blockedSlot = candidate(blockedTables,'SES-T');
blockedGateway.freeBusy = ids => ({calendars:Object.fromEntries(ids.map(id=>[id,id===fixture.People[0][1]?{errors:[{reason:'forbidden'}]}:{busy:[]}]))});
assert.throws(()=>context.bookSessionCore_(selected('SES-T',blockedSlot),blockedGateway.services),/Kalenderzugriff fehlt/);
assert.equal(blockedGateway.inserts,0);
blockedGateway.freeBusy = ids => ({calendars:Object.fromEntries(ids.map(id=>[id,{busy:[{start:blockedSlot.startUtc,end:blockedSlot.endUtc}]}]))});
assert.throws(()=>context.bookSessionCore_(selected('SES-T',blockedSlot),blockedGateway.services),/nicht mehr frei/);
assert.equal(blockedGateway.inserts,0);

const interruptedTables = makeTables();
const interruptedGateway = makeServices(interruptedTables);
const interruptedSlot = candidate(interruptedTables,'SES-T');
interruptedGateway.failSave = true;
assert.throws(()=>context.bookSessionCore_(selected('SES-T',interruptedSlot),interruptedGateway.services),/Sheet temporarily unavailable/);
assert.equal(interruptedGateway.inserts,1);
assert.equal(interruptedTables.Sessions[0].status,'planned');
interruptedGateway.failSave = false;
assert.equal(context.bookSessionCore_(selected('SES-T',interruptedSlot),interruptedGateway.services).reused,true);
assert.equal(interruptedGateway.inserts,1);
assert.equal(interruptedTables.Sessions[0].status,'invited');

const timeoutTables = makeTables();
const timeoutGateway = makeServices(timeoutTables);
timeoutGateway.failInsertResponse = true;
assert.equal(context.bookSessionCore_(selected('SES-T',candidate(timeoutTables,'SES-T')),timeoutGateway.services).reused,false);
assert.equal(timeoutGateway.inserts,1);

const collisionTables = makeTables();
const collisionGateway = makeServices(collisionTables);
const collisionSlot = candidate(collisionTables,'SES-T');
collisionGateway.events.set(context.bookingEventId_('SES-T'),{id:context.bookingEventId_('SES-T'),status:'confirmed',start:{dateTime:collisionSlot.startLocal},end:{dateTime:collisionSlot.endLocal}});
assert.throws(()=>context.bookSessionCore_(selected('SES-T',collisionSlot),collisionGateway.services),/gehört nicht/);
assert.equal(collisionGateway.inserts,0);
console.log('Pass: one Calendar invitation, exact Zurich time and guests, safe retries, theory/practice order, conflicts, access failure, and interrupted-write recovery.');
