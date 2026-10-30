const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const source = path.resolve(__dirname, '../src/dashboardProjection.ts');
const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = new Module(source, module);
compiled.filename = source;
compiled.paths = Module._nodeModulePaths(path.dirname(source));
compiled._compile(js, source);
const { mapProcessQualityDashboard, zurichSessionLabel } = compiled.exports;
const fixture = require('./fixtures/process-quality-dashboard.json');

test('same request remains two session groups with source IDs and revisions', () => {
  const before = structuredClone(fixture);
  const result = mapProcessQualityDashboard(fixture);
  assert.deepEqual(result.unscheduledRequests.map(card => card.key), ['REQ-1:SES-1', 'REQ-1:SES-RETRY']);
  assert.deepEqual(result.unscheduledRequests.map(card => [card.requestRevision, card.sessionRevision]), [['4', '2'], ['4', '1']]);
  assert.deepEqual(result.unscheduledRequests.map(card => card.members[0].caseId), ['CASE-1', 'CASE-2']);
  assert.equal(result.upcomingSessions[0].requestRevision, undefined);
  assert.equal(result.upcomingSessions[0].sessionRevision, '3');
  assert.deepEqual(fixture, before);
});

test('names and topic are honest without a directory, and accept supplied labels', () => {
  const fallback = mapProcessQualityDashboard(fixture);
  assert.equal(fallback.unscheduledRequests[0].title, 'Thema TOPIC-1');
  assert.equal(fallback.unscheduledRequests[0].members[0].participantLabel, 'Person [person-a]');
  assert.equal(fallback.unscheduledRequests[0].trainerLabel, 'Trainer [trainer-a]');
  assert.equal(fallback.unscheduledRequests[0].requesterLabel, 'Angefragt von Example Requester · CCS');
  assert.equal(fallback.unscheduledRequests[0].deadlineLabel, 'Abschluss bis 28.10.2026');
  const named = mapProcessQualityDashboard(fixture, {
    participants: { 'person-a': 'Alex Example' }, trainers: { 'trainer-a': 'Taylor Example' }, topics: { 'TOPIC-1': 'Process Basics' },
  });
  assert.equal(named.unscheduledRequests[0].title, 'Process Basics');
  assert.equal(named.unscheduledRequests[0].members[0].participantLabel, 'Alex Example');
  assert.equal(named.unscheduledRequests[0].trainerLabel, 'Taylor Example');
});

test('each backend attention action remains distinct, including failed and missing trainer results', () => {
  const cards = mapProcessQualityDashboard(fixture).attentionCases;
  assert.deepEqual(cards.map(card => card.attentionAction), [
    'reschedule', 'reschedule', 'participant_acknowledgement', 'trainer_review', 'archive_review',
  ]);
  assert.match(cards[0].detailLabel, /abgesagt/);
  assert.match(cards[1].detailLabel, /nicht bestanden/);
  assert.match(cards[2].detailLabel, /Bestätigung/);
  assert.match(cards[3].detailLabel, /ohne gesichertes Ergebnis/);
  assert.equal(cards[4].actionLabel, 'Archiv prüfen');
  assert.deepEqual(cards.map(card => card.revision), ['2', '3', '4', '5', '6']);
});

test('UTC instants show Zurich daylight and standard time across the repeated hour', () => {
  const label = mapProcessQualityDashboard(fixture).upcomingSessions[0].timeLabel;
  assert.match(label, /02:30 MESZ/);
  assert.match(label, /02:30 MEZ/);
  assert.equal(zurichSessionLabel('2026-10-25T00:30:00'), 'Terminzeit nicht verfügbar');
});
