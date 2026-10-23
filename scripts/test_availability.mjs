import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture = JSON.parse(fs.readFileSync('data/demo_fixture.json', 'utf8'));
const headers = {
  People: ['person_key','email','demo_role','demo_marker','persona_id','display_alias'],
  ParticipantCases: ['case_id','request_id','person_key','current_level','target_level','status','created_at','demo_marker'],
  Sessions: ['session_id','request_id','phase','phase_order','mode','trainer_key','duration_minutes','theory_session_id','status','created_at','demo_marker'],
  SessionCases: ['session_id','case_id','request_id','person_key','demo_marker']
};
const objects = (name, rows) => rows.map(row => Object.fromEntries(headers[name].map((header, index) => [header, row[index] ?? ''])));
const request = 'REQ-TEST';
const tables = {
  People: objects('People', fixture.People),
  ParticipantCases: objects('ParticipantCases', [
    ['CASE-W',request,'WOHNUNG',0,1,'draft','','[DEMO]'],
    ['CASE-S',request,'SUMNER',0,1,'draft','','[DEMO]']
  ]),
  Sessions: objects('Sessions', [
    ['SES-T',request,'theory',1,'group','MATT',60,'','planned','','[DEMO]'],
    ['SES-P',request,'practice',2,'individual','MARIE',180,'SES-T','planned','','[DEMO]']
  ]),
  SessionCases: objects('SessionCases', [
    ['SES-T','CASE-W',request,'WOHNUNG','[DEMO]'],
    ['SES-T','CASE-S',request,'SUMNER','[DEMO]'],
    ['SES-P','CASE-W',request,'WOHNUNG','[DEMO]']
  ])
};
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
const calls = [];
const context = vm.createContext({
  Date, Set, Number, JSON, String,
  Utilities: { formatDate, parseDate },
  Calendar: { Freebusy: { query: body => {
    calls.push(body);
    return { calendars: Object.fromEntries(body.items.map(item => [item.id, { busy: [] }])) };
  } } }
});
for (const file of ['CalendarGateway.gs','Availability.gs']) {
  vm.runInContext(fs.readFileSync('apps-script/' + file, 'utf8'), context);
}

const now = new Date('2026-03-27T08:00:00Z');
const emails = tables.People.map(p => p.email);
const allFree = ids => ({ calendars: Object.fromEntries(ids.map(id => [id, { busy: [] }])) });
const gateway = ids => allFree(ids);
const theory = context.slotProposalModel_('SES-T', tables, now, gateway);
assert.deepEqual(Array.from(theory.calendars.map(c => c.key)), ['MATT','WOHNUNG','SUMNER']);
assert.equal(theory.calendars.every(c => c.ok), true);
assert.equal(theory.proposals.length, 3);
assert(theory.proposals.every(s => s.timeZone === zone && new Date(s.endUtc)-new Date(s.startUtc) === 60*60000));
assert(new Set(theory.proposals.map(s => s.localDate)).size >= 2);
assert(new Set(theory.proposals.map(s => s.period)).size === 2);
assert(theory.proposals.some(s => s.startLocal.startsWith('2026-03-30') && s.startLocal.endsWith('+02:00')));

const practice = context.slotProposalModel_('SES-P', tables, now, gateway);
assert.deepEqual(Array.from(practice.calendars.map(c => c.key)), ['MARIE','WOHNUNG']);
assert.equal(practice.proposals.length, 3);
assert(practice.proposals.every(s => new Date(s.endUtc)-new Date(s.startUtc) === 180*60000));
assert(practice.proposals.every(s => Number(s.endLocal.slice(11,13)) <= 17));
assert(practice.proposals.every(s => s.startLocal.endsWith('+01:00') || s.startLocal.endsWith('+02:00')));

const busyStart = theory.proposals[0].startUtc;
const busyEnd = theory.proposals[0].endUtc;
const withBusy = ids => ({ calendars: Object.fromEntries(ids.map(id => [id, {
  busy: id === tables.People.find(p => p.person_key === 'WOHNUNG').email ? [{start:busyStart,end:busyEnd}] : []
}])) });
const afterBusy = context.slotProposalModel_('SES-T', tables, now, withBusy);
assert(!afterBusy.proposals.some(s => new Date(s.startUtc) < new Date(busyEnd) && new Date(s.endUtc) > new Date(busyStart)));

const zeroLength = ids => ({ calendars: Object.fromEntries(ids.map(id => [id, {
  busy: [{start:busyStart,end:busyStart}]
}])) });
const afterZeroLength = context.slotProposalModel_('SES-P', tables, now, zeroLength);
assert.equal(afterZeroLength.calendars.every(c => c.ok && c.busy.length === 0), true);
assert.equal(afterZeroLength.proposals.length, 3);

const backward = ids => ({ calendars: Object.fromEntries(ids.map(id => [id, {
  busy: [{start:busyEnd,end:busyStart}]
}])) });
assert.equal(context.slotProposalModel_('SES-T', tables, now, backward).proposals.length, 0);

const badEmail = tables.People.find(p => p.person_key === 'SUMNER').email;
const accessError = ids => ({ calendars: Object.fromEntries(ids.map(id => [id, id === badEmail ?
  { errors: [{ reason:'notFound' }], busy:[] } : { busy:[] }])) });
const blocked = context.slotProposalModel_('SES-T', tables, now, accessError);
assert.equal(blocked.proposals.length, 0);
assert.equal(blocked.calendars.find(c => c.key === 'SUMNER').error, 'notFound');
assert.match(blocked.reason, /keine Termine/);
assert.equal(context.validatedCalendars_(tables.People, allFree(emails)).length, 4);
assert.equal(context.validatedCalendars_(tables.People, { calendars: {} }).every(c => !c.ok), true);
assert.equal(context.slotProposalModel_('SES-T', tables, now, () => ({ globalError:'HTTP 403', calendars:{} })).proposals.length, 0);
assert.throws(() => context.requiredPeopleForSession_('SES-UNKNOWN', tables), /nicht eindeutig/);

const liveShape = context.queryCalendarFreeBusy_(emails, now.toISOString(), new Date(now.getTime()+86400000).toISOString());
assert.equal(context.validatedCalendars_(tables.People, liveShape).every(c => c.ok), true);
assert.equal(calls.length, 1);
assert.equal(calls[0].timeZone, zone);
assert.equal(calls[0].items.length, 4);
console.log('Pass: four-calendar free/busy shape, Zurich DST, 60/180-minute windows, varied dates/periods, busy exclusion, and fail-closed calendar errors.');
