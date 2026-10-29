import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('docs/demo-tour/index.html', 'utf8');
const script = fs.readFileSync('docs/demo-tour/simulator.js', 'utf8');
const tour = html.match(/\/\/ TOUR_PURE_START[^\n]*\n([\s\S]*?)\/\/ TOUR_PURE_END/);
const simulator = script.match(/\/\/ SIM_PURE_START[^\n]*\n([\s\S]*?)\/\/ SIM_PURE_END/);
assert.ok(tour && simulator, 'pure model sections are present');
assert.match(html, /src="\.\/simulator\.js"/);
assert.match(html, /id="simulator"/);
assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|sendBeacon|google\.script\.run|MailApp|CalendarApp|DriveApp|SpreadsheetApp/);
assert.doesNotMatch(html + script, /mattbangle@gmail\.com|cosanum\.training\.demo@gmail\.com|\/macros\/s\//);

const ctx = vm.createContext({ URL, URLSearchParams });
vm.runInContext(tour[1] + '\n' + simulator[1], ctx);
const create = vm.runInContext('simCreate', ctx);
const apply = vm.runInContext('simApply', ctx);
const personStatus = vm.runInContext('simPersonStatus', ctx);
const overall = vm.runInContext('simOverall', ctx);
const input = { topicId: 'TC_R052', mode: 'group', trainer: 'pq',
  participants: ['ma1', 'ma2'], slot: { day: 0, hour: 13 }, slotText: 'Mo 26.10.2026 · 13:00–14:00' };

assert.throws(() => create({ ...input, trainer: 'hcm4' }, 'A-0001'), /schulende Rolle/);
assert.throws(() => create({ ...input, topicId: 'TC_R030' }, 'A-0001'), /Demothema/);
assert.throws(() => create({ ...input, mode: 'individual' }, 'A-0001'), /Schulungsmodus/);
assert.throws(() => create({ ...input, slot: { day: 0, hour: 9 } }, 'A-0001'), /freien Termin/);
let run = create(input, 'A-0001');
assert.throws(() => apply(run, { type: 'rsvp', personKey: 'ma1', value: 'accepted' }), /Zuerst den Termin/);
run = apply(run, { type: 'book' });
run = apply(run, { type: 'rsvp', personKey: 'ma1', value: 'accepted' });
assert.throws(() => apply(run, { type: 'assess', personKey: 'ma2', value: 'passed' }), /Trainerbericht/);
run = apply(run, { type: 'assess', personKey: 'ma1', value: 'passed' });
assert.throws(() => apply(run, { type: 'proof', personKey: 'ma1' }), /Bestätigung/);
run = apply(run, { type: 'acknowledge', personKey: 'ma1' });
run = apply(run, { type: 'proof', personKey: 'ma1' });
assert.throws(() => apply(run, { type: 'skill', personKey: 'ma1' }), /Archive/);
run = apply(run, { type: 'archive', personKey: 'ma1' });
run = apply(run, { type: 'skill', personKey: 'ma1' });
assert.equal(personStatus(run.people[0], run.booked), 'Abgeschlossen · Skillstufe 0 → 1');
assert.equal(overall(run), 'In Bearbeitung', 'the other person remains open');
assert.throws(() => apply(run, { type: 'skill', personKey: 'ma1' }), /Archive/);
run = apply(run, { type: 'rsvp', personKey: 'ma2', value: 'declined' });
assert.equal(overall(run), 'Klärung erforderlich');
assert.equal(run.people[0].skill, true, 'one person stays complete despite the other exception');

let single = create({ ...input, participants: ['ma1'], trainer: 'hcm4' }, 'A-0002');
for (const action of [
  { type: 'book' }, { type: 'rsvp', personKey: 'ma1', value: 'accepted' },
  { type: 'assess', personKey: 'ma1', value: 'passed' },
  { type: 'acknowledge', personKey: 'ma1' }, { type: 'proof', personKey: 'ma1' },
  { type: 'archive', personKey: 'ma1' }, { type: 'skill', personKey: 'ma1' }
]) single = apply(single, action);
assert.equal(overall(single), 'Abgeschlossen');
console.log('Public synthetic case gates and isolation checks passed');
