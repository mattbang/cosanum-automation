import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('apps-script/Index.html', 'utf8');
const pure = html.match(/\/\/ HUB_OVERVIEW_PURE_START[^\n]*\n([\s\S]*?)\/\/ HUB_OVERVIEW_PURE_END/);
assert.ok(pure, 'owner overview is testable without Google services');
const ui = vm.createContext({ Map });
vm.runInContext(pure[1], ui);
const phase = { sessionId: 'SES-GROUP', phase: 'theory', startUtc: '2026-10-30T09:00:00Z', eventUrl: 'https://calendar.google.com/event' };
const requests = [
  { requestId: 'REQ-GROUP', topicName: 'Demo A', createdAt: '2026-10-30T08:00:00Z', state: 'open',
    cases: [
      { personAlias: 'A', state: 'open', currentTask: { action: 'reschedule', actorKey: 'MATT', state: 'suggested' }, phases: [phase] },
      { personAlias: 'B', state: 'waiting', currentTask: { action: 'trainer_assessment', actorKey: 'TRAINER', state: 'suggested' }, phases: [phase] }
    ] },
  { requestId: 'REQ-WAITING', topicName: 'Demo B', createdAt: '2026-10-29T08:00:00Z', state: 'waiting',
    cases: [{ personAlias: 'C', state: 'waiting', currentTask: { action: 'participant_acknowledgement', actorKey: 'C', state: 'suggested' }, phases: [] }] },
  { requestId: 'REQ-DONE', topicName: 'Demo C', createdAt: '2026-10-28T08:00:00Z', state: 'complete',
    cases: [{ personAlias: 'D', state: 'complete', currentTask: { action: 'complete', actorKey: 'D', state: 'complete' }, phases: [] }] }
];
const before = JSON.stringify(requests);
const overview = ui.overviewModel(requests);
assert.equal(overview.counts.owner, 1, 'a group request counts once for Process & Quality');
assert.equal(overview.counts.open, 1);
assert.equal(overview.counts.waiting, 1);
assert.equal(overview.counts.complete, 1);
assert.deepEqual(Array.from(overview.queue, row => row.requestId), ['REQ-GROUP', 'REQ-WAITING']);
const bookings = ui.bookedSessionModel(requests);
assert.equal(bookings.length, 1, 'one group event is shown once');
assert.deepEqual(Array.from(bookings[0].people), ['A', 'B']);
assert.equal(JSON.stringify(requests), before, 'the overview never changes persisted rows');

const catalogue = fs.readFileSync('apps-script/Catalogue.gs', 'utf8');
const code = fs.readFileSync('apps-script/Code.gs', 'utf8');
const ids = ['TC_R030', 'TC_R027', 'TC_R033', 'TC_R052', 'TC_R077'];
const tables = {
  Topics: ids.map((id, index) => ({ topic_id: id, display_name: `Topic ${index}`, source_material: `Source ${index}`,
    theory_required: true, practice_required: index % 2 === 0, theory_minutes: 60, practice_minutes: 180,
    progression_rule: index < 2 ? '0→1→2→3' : '', configured_target_level: index < 2 ? '' : 1 })),
  People: ['A', 'B', 'C', 'D'].map(key => ({ person_key: key, display_alias: key, demo_role: 'Demo' })),
  Skills: []
};
for (const person of tables.People) for (const topic of tables.Topics) {
  tables.Skills.push({ person_key: person.person_key, topic_id: topic.topic_id,
    skill_level: person.person_key === 'A' && topic.topic_id === 'TC_R030' ? '–' : 1, demo_marker: '[DEMO]' });
}
let ownerChecks = 0;
const server = vm.createContext({
  readDemoTables_: () => tables,
  auditOwner_: () => { ownerChecks++; },
  findDemoSpreadsheet_: () => ({ getUrl: () => 'https://docs.google.com/spreadsheets/d/demo/edit' })
});
vm.runInContext(catalogue + '\n' + code, server);
const tablesBefore = JSON.stringify(tables);
const resources = server.getOwnerResourceOverview();
assert.equal(ownerChecks, 1, 'resource data requires the owner gate');
assert.equal(resources.topics.length, 5);
assert.equal(resources.matrix.length, 4);
assert.equal(resources.matrix[0].levels[0].level, '–', 'not applicable is preserved');
assert.equal(resources.topics[0].sourceMaterial, 'Source 0');
assert.equal(JSON.stringify(tables), tablesBefore, 'resource read does not change the Sheet model');
const removed = tables.Skills.pop();
assert.throws(() => server.getOwnerResourceOverview(), /fehlt oder ist doppelt/);
tables.Skills.push(removed);
tables.Skills.push({ ...tables.Skills[0] });
assert.throws(() => server.getOwnerResourceOverview(), /fehlt oder ist doppelt/);
server.auditOwner_ = () => { throw new Error('Owner required'); };
assert.throws(() => server.getOwnerResourceOverview(), /Owner required/);
console.log('Owner overview and resource projection checks passed');
