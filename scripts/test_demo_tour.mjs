import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const page = fs.readFileSync('docs/demo-tour/index.html', 'utf8');
const pure = page.match(/\/\/ TOUR_PURE_START[^\n]*\n([\s\S]*?)\/\/ TOUR_PURE_END/);
assert.ok(pure, 'the public tour exposes testable read-only URL logic');
const tour = vm.createContext({ URL, URLSearchParams });
vm.runInContext(pure[1], tour);
const feedbackUrl = 'https://docs.google.com/forms/d/e/FORM_EXAMPLE/viewform?entry.1=REQ-EXAMPLE-001';
const context = tour.tourContext('?request=REQ-EXAMPLE-001&scenario=group&feedback=' + encodeURIComponent(feedbackUrl));
assert.equal(context.request, 'REQ-EXAMPLE-001');
assert.equal(context.scenario, 'group');
assert.equal(context.feedback, feedbackUrl);
assert.equal(tour.tourFeedbackUrl('javascript:alert(1)'), '');
assert.equal(tour.tourFeedbackUrl('https://evil.example/forms/d/e/FORM/viewform'), '');
assert.equal(tour.tourContext('?request=CASE-PRIVATE&scenario=wrong').request, '');
assert.doesNotMatch(pure[1], /google\.script\.run|fetch\(|localStorage|sessionStorage|sendBeacon|XMLHttpRequest/);
assert.doesNotMatch(page, /gmail\.com|\/macros\/s\/|CASE-[A-Z0-9]|entry\.\d+=REQ-/,
  'public page contains no private account, case, or live form identifier');
assert.match(page, /Alle Antworten und Freigaben sind hier simuliert/);
assert.match(page, /Diese Seite sendet keine E-Mails/);
assert.match(page, /Gemeinsame freie Zeiten/);
assert.equal(tour.nextMonday(new Date('2026-10-24T12:00:00Z')).toISOString().slice(0, 10), '2026-10-26');
assert.deepEqual(Array.from(tour.commonSlots(['hcm4', 'ma1'], 0)), [11, 13, 16]);
assert.deepEqual(Array.from(tour.commonSlots(['hcm4', 'ma1', 'ma2'], 0)), [13]);
assert.match(fs.readFileSync('docs/index.html', 'utf8'), /demo-tour\//);

const files = { root: [], demo: [] };
const folders = Object.fromEntries(Object.keys(files).map(name => [name, {
  name,
  getFilesByName(title) {
    const list = files[name].filter(file => file.title === title);
    let index = 0;
    return { hasNext: () => index < list.length, next: () => list[index++] };
  }
}]));
let created = 0, failMove = true, activeForm;
function item(title, type) {
  return { title, type, getTitle() { return title; }, getType() { return type; },
    asTextItem() { return this; }, asListItem() { return this; }, asParagraphTextItem() { return this; },
    setTitle(value) { this.title = title = value; return this; }, setRequired() { return this; },
    setHelpText() { return this; }, setChoiceValues() { return this; },
    createResponse(value) { return { value }; } };
}
function form(id) {
  const items = [];
  return { id, items, responses: [], getId() { return id; }, getItems() { return items; },
    setDescription() { return this; }, setAllowResponseEdits() { return this; },
    setCollectEmail() { return this; }, setConfirmationMessage() { return this; },
    addTextItem() { const value = item('', 'TEXT'); items.push(value); return value; },
    addListItem() { const value = item('', 'LIST'); items.push(value); return value; },
    addParagraphTextItem() { const value = item('', 'PARAGRAPH_TEXT'); items.push(value); return value; },
    createResponse() { return { withItemResponse(response) { this.response = response; return this; },
      toPrefilledUrl() { return feedbackUrl; } }; },
    getResponses() { return this.responses; } };
}
const requestId = 'REQ-EXAMPLE-001';
const server = vm.createContext({
  Object, Date, MimeType: { GOOGLE_FORMS: 'form' },
  FormApp: { ItemType: { TEXT: 'TEXT', LIST: 'LIST', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' },
    create(title) { created++; activeForm = form('FORM_EXAMPLE'); const file = {
      title, getId: () => activeForm.id, getMimeType: () => 'form',
      moveTo(folder) {
        if (failMove) { failMove = false; throw Error('move interrupted'); }
        files.root = files.root.filter(value => value !== file);
        files[folder.name].push(file);
      }
    }; files.root.push(file); return activeForm; },
    openById(id) { assert.equal(id, activeForm.id); return activeForm; } },
  DriveApp: { getRootFolder: () => folders.root, getFileById: () => files.root[0] || files.demo[0] },
  findDemoFolder_: () => folders.demo,
  readDemoTables_: () => ({ Requests: [{ request_id: requestId, mode: 'group', demo_marker: '[DEMO]' }] }),
  auditOwner_: () => 'owner@example.test',
  proofUnique_: (rows, predicate, label) => { const found = rows.filter(predicate);
    if (found.length !== 1) throw Error(label + ' fehlt oder ist nicht eindeutig.'); return found[0]; },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
});
vm.runInContext(fs.readFileSync('apps-script/Feedback.gs', 'utf8'), server);
assert.throws(() => server.prepareDemoTourLink({ requestId }), /move interrupted/);
assert.equal(created, 1);
assert.equal(files.root.length, 1);
const first = server.prepareDemoTourLink({ requestId });
const second = server.prepareDemoTourLink({ requestId });
assert.equal(created, 1, 'retry and repeat reuse one Form');
assert.equal(files.root.length, 0);
assert.equal(files.demo.length, 1);
assert.equal(activeForm.items.length, 4, 'partial creation never duplicates questions');
assert.equal(first.url, second.url);
assert.match(first.url, /request=REQ-EXAMPLE-001/);
assert.equal(server.getDemoFeedbackForRequest({ requestId }).rows.length, 0);
function response(fields, time) { return { getTimestamp: () => new Date(time), getItemResponses: () => Object.entries(fields).map(([key, value]) => ({
  getItem: () => ({ getTitle: () => key }), getResponse: () => value })) }; }
activeForm.responses = [
  response({ 'Auftrags-ID': requestId, Rolle: 'Schulende Person', Schritt: 'Trainerbericht', Beobachtung: 'Beispieltext' }, '2026-10-24T11:00:00Z'),
  response({ 'Auftrags-ID': 'REQ-OTHER-001', Rolle: 'Teilnehmende Person', Schritt: 'Teilnahmebestätigung', Beobachtung: 'Andere Anfrage' }, '2026-10-24T12:00:00Z')
];
const rows = server.getDemoFeedbackForRequest({ requestId }).rows;
assert.equal(rows.length, 1);
assert.equal(rows[0].role, 'Schulende Person');
assert.equal(rows[0].step, 'Trainerbericht');
assert.equal(rows[0].submittedAt, '2026-10-24T11:00:00.000Z');
assert.throws(() => server.getDemoFeedbackForRequest({ requestId: 'REQ-OTHER-001' }), /nicht eindeutig/);
console.log('Public tour and owner-only feedback checks passed');
