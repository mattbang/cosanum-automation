#!/usr/bin/env node
/** Local-only plan and evidence checks for Increment 16. No Google API calls. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const privateRuns = resolve(root, 'data/demo-replays');
const privateRecordings = resolve(root, 'data/demo-recordings');
const requiredTopics = ['TC_R030', 'TC_R027', 'TC_R033', 'TC_R052', 'TC_R077'];
const scenarios = [
  { key: 'group_success', topicId: 'TC_R033', mode: 'group', personKeys: ['WOHNUNG', 'SUMNER'], targetLevel: 1, seedAdjustments: [{ personKey: 'SUMNER', topicId: 'TC_R033', from: '–', to: 0, reason: 'Synthetic group eligibility only' }], result: 'Separate verified records, one notice after both complete', checks: ['audited_seed_correction', 'one_group_event', 'verified_forms_per_person', 'two_distinct_proofs', 'two_verified_archives', 'one_final_notice', 'idempotent_replay'] },
  { key: 'individual_progression', topicId: 'TC_R030', mode: 'individual', personKeys: ['WOHNUNG'], targetLevel: 1, result: 'Theory then practice; level 0 to 1 exactly once', checks: ['eligible_level4_trainer', 'theory_before_practice', 'verified_forms_both_phases', 'verified_archive', 'level_once'] },
  { key: 'matrix_block_correction', topicId: 'TC_R077', mode: 'individual', personKeys: ['WOHNUNG'], targetLevel: 1, seedAdjustments: [{ personKey: 'WOHNUNG', topicId: 'TC_R077', from: '', to: 0, reason: 'Synthetic blank-cell correction after displaying eligibility block' }], result: 'Skipped level blocked; manual demo Sheet correction audited before retry', checks: ['skip_blocked', 'manual_demo_correction', 'conflict_does_not_overwrite'] },
  { key: 'group_decline_no_rsvp', topicId: 'TC_R027', mode: 'group', personKeys: ['WOHNUNG', 'SUMNER'], targetLevel: 2, seedAdjustments: [{ personKey: 'SUMNER', topicId: 'TC_R027', from: 0, to: 1, reason: 'Synthetic group eligibility only' }], result: 'One decline and one unanswered flag without cancelling group event', checks: ['audited_seed_correction', 'decline_per_person', 'unanswered_prior_business_day', 'group_event_retained'] },
  { key: 'missing_acknowledgement', topicId: 'TC_R052', mode: 'group', personKeys: ['SUMNER'], targetLevel: 1, result: 'Day +2 and +5 once each; remains open without completion notice', checks: ['trainer_pass', 'day2_once', 'day5_once', 'open_case', 'no_completion'] },
  { key: 'archive_failure_retry', topicId: 'TC_R052', mode: 'group', personKeys: ['SUMNER'], targetLevel: 1, result: 'Archive error blocks skill and notice; retry yields one verified receipt', checks: ['archive_error', 'no_skill_or_notice_before_retry', 'one_verified_receipt_after_retry'] }
];
const requiredOutboundTypes = {
  group_success: ['calendar', 'email'],
  individual_progression: ['calendar', 'email'],
  matrix_block_correction: [],
  group_decline_no_rsvp: ['calendar'],
  missing_acknowledgement: ['calendar', 'email'],
  archive_failure_retry: ['calendar', 'email']
};

function within(parent, path) {
  const rel = relative(parent, resolve(path));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !rel.startsWith(sep));
}

export function validateFixture(fixture) {
  if (!fixture || !Array.isArray(fixture.Topics) || !Array.isArray(fixture.People) || !Array.isArray(fixture.Skills)) throw Error('Fixture has no Topics, People, or Skills.');
  if (fixture.Topics.length !== 5 || fixture.People.length !== 4 || fixture.Skills.length !== 20) throw Error('Expected five topics, four people, and twenty skills.');
  if (fixture.Topics.some((row, i) => row[0] !== requiredTopics[i] || row[9] !== '[DEMO]')) throw Error('Topic catalog is not the reviewed demo fixture.');
  const people = new Map(fixture.People.map(row => [row[0], row]));
  if (people.size !== 4 || ['MATT', 'MARIE', 'WOHNUNG', 'SUMNER'].some(key => !people.has(key))) throw Error('Demo person keys differ.');
  const addresses = fixture.People.map(row => String(row[1] || '').trim().toLowerCase());
  if (new Set(addresses).size !== 4 || addresses.some(email => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) throw Error('Test addresses must be four distinct valid addresses.');
  if (fixture.People.some(row => row[3] !== '[DEMO]')) throw Error('A person is not marked demo.');
  const skillKeys = new Set();
  for (const row of fixture.Skills) {
    if (!people.has(row[0]) || !requiredTopics.includes(row[1]) || row[4] !== '[DEMO]') throw Error('A skill is outside the demo fixture.');
    const key = row[0] + ':' + row[1];
    if (skillKeys.has(key)) throw Error('Duplicate skill: ' + key);
    skillKeys.add(key);
  }
  return { allowlist: addresses, people };
}

export function makeRunRecord(fixture, { runId = `RUN-${randomUUID().toUpperCase()}`, sourceCommit = null } = {}) {
  if (!/^RUN-[A-F0-9-]{36}$/.test(runId)) throw Error('Invalid run ID.');
  const { allowlist } = validateFixture(fixture);
  return {
    schemaVersion: 1, runId, createdAtUtc: new Date().toISOString(), sourceCommit,
    marker: '[DEMO]', fixtureVersion: 'five-topic-v1',
    fixtureSha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'), timeZone: 'Europe/Zurich',
    boundary: { demoSheetId: null, productionSheetId: null, productionMatrixUntouchedEvidence: null, ownerChecked: false },
    allowlist, deploymentId: null, deploymentVersion: null,
    reset: { mode: 'fresh_ids_preserve_existing', previousEvidenceSnapshot: null, connectedSeedApplied: false, note: 'Never call resetDemoFixture on the evidence-bearing Sheet. Use new request IDs; snapshot before any future reset.' },
    scenarios: scenarios.map(item => ({
      ...item, seedAdjustments: (item.seedAdjustments || []).map(row => ({ ...row, applied: false, evidence: null })),
      checks: item.checks.map(key => ({ key, result: null, evidence: null })),
      scenarioRunId: `${runId}-${item.key.toUpperCase().replaceAll('_', '-')}`,
      requestId: null, sessionIds: [], caseIds: [], status: 'not_run',
      observedAtUtc: null, evidence: [], defects: [], outbound: [], noOutboundEvidence: null, archivePairs: []
    })),
    measurements: {
      taskDefinition: 'Select the same training and participants, find a mutually free slot, and prepare the invitation.',
      actionDefinition: 'Count one intentional human click, entry, selection, or confirmation as one action; do not count automatic API calls.',
      manual: { startedAtUtc: null, endedAtUtc: null, elapsedSeconds: null, humanActions: null, evidence: null },
      prototype: { startedAtUtc: null, endedAtUtc: null, elapsedSeconds: null, humanActions: null, evidence: null }
    },
    recording: { requestId: null, relativePath: null, playbackVerifiedAtUtc: null, completeAndReadable: null, note: null },
    gate: { connectedReplayVerified: false, reviewedBy: null, reviewedAtUtc: null }
  };
}

export function assessRunRecord(record, { fixture = null, hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex') } = {}) {
  const violations = [], pending = [];
  if (record.marker !== '[DEMO]' || !/^RUN-[A-F0-9-]{36}$/.test(record.runId || '')) violations.push('Invalid demo run marker or ID.');
  const allowlist = new Set((record.allowlist || []).map(value => String(value).toLowerCase()));
  if (allowlist.size !== 4) violations.push('Expected four unique test addresses.');
  if (fixture) {
    const reviewed = validateFixture(fixture);
    if (record.fixtureSha256 !== createHash('sha256').update(JSON.stringify(fixture)).digest('hex')) violations.push('Fixture changed since run preparation.');
    if (reviewed.allowlist.some(email => !allowlist.has(email))) violations.push('Run allowlist differs from private fixture.');
  } else pending.push('Private fixture was not supplied for independent allowlist comparison.');
  const boundary = record.boundary || {};
  if (boundary.demoSheetId && boundary.productionSheetId && boundary.demoSheetId === boundary.productionSheetId) violations.push('Demo and production Sheet IDs are identical.');
  if (!boundary.demoSheetId || !boundary.ownerChecked || !boundary.productionMatrixUntouchedEvidence) pending.push('Demo Sheet owner and untouched production matrix have not been verified.');
  if (!record.reset?.connectedSeedApplied) pending.push('Fresh-ID connected seed has not been checked.');
  if (!record.deploymentId) pending.push('Deployment ID is missing.');
  if (!/^[a-f0-9]{40}$/i.test(record.sourceCommit || '') || !Number.isInteger(record.deploymentVersion) || record.deploymentVersion < 1) {
    pending.push('Reviewed source commit and numbered deployment version are missing.');
  }
  const scenarioKeys = new Set();
  for (const item of record.scenarios || []) {
    scenarioKeys.add(item.key);
    if (!item.scenarioRunId?.startsWith(record.runId + '-')) violations.push(`${item.key}: scenario ID is outside this run.`);
    if (!['not_run', 'pass', 'fail', 'blocked'].includes(item.status)) violations.push(`${item.key}: invalid status.`);
    if (item.status !== 'pass' || !item.requestId || !item.observedAtUtc || !(item.evidence || []).length) pending.push(`${item.key}: connected result/evidence incomplete.`);
    const expected = scenarios.find(row => row.key === item.key);
    if (expected) {
      const actualChecks = new Map((item.checks || []).map(check => [check.key, check]));
      if (actualChecks.size !== expected.checks.length || expected.checks.some(key => !actualChecks.has(key))) violations.push(`${item.key}: required checks missing or duplicated.`);
      if (item.status === 'pass' && expected.checks.some(key => actualChecks.get(key)?.result !== 'pass' || !actualChecks.get(key)?.evidence)) pending.push(`${item.key}: required check evidence incomplete.`);
      if (item.status === 'pass' && expected.seedAdjustments?.some((row, i) => !item.seedAdjustments?.[i]?.applied || !item.seedAdjustments[i].evidence)) pending.push(`${item.key}: synthetic correction audit evidence incomplete.`);
      const minArchives = item.key === 'group_success' ? 2 : ['individual_progression', 'archive_failure_retry'].includes(item.key) ? 1 : 0;
      if (item.status === 'pass' && (item.archivePairs || []).length < minArchives) pending.push(`${item.key}: required archive pairs incomplete.`);
      if (item.status === 'pass' && minArchives) {
        const pairs = item.archivePairs || [];
        const unique = field => new Set(pairs.map(pair => pair[field])).size === pairs.length;
        if (pairs.some(pair => !pair.personKey || !item.personKeys.includes(pair.personKey) || !pair.caseId || !item.caseIds?.includes(pair.caseId) || !pair.proofId || !pair.drivePdfId) ||
            !unique('personKey') || !unique('caseId') || !unique('proofId') || !unique('drivePdfId')) {
          pending.push(`${item.key}: distinct participant, case, proof, and Drive PDF identities are incomplete.`);
        }
      }
    }
    for (const outbound of item.outbound || []) {
      const recipients = outbound.recipients || [];
      if (!Array.isArray(recipients) || !recipients.length || recipients.some(email => !allowlist.has(String(email).toLowerCase()))) violations.push(`${item.key}: outbound recipients are missing or outside the test allowlist.`);
      if (outbound.type !== 'email' && outbound.type !== 'calendar') violations.push(`${item.key}: unknown outbound type.`);
      if (!outbound.evidence) pending.push(`${item.key}: outbound recipient evidence is missing.`);
    }
    if (item.status === 'pass') {
      const required = requiredOutboundTypes[item.key] || [];
      for (const type of required) {
        if (!(item.outbound || []).some(row => row.type === type && Array.isArray(row.recipients) && row.recipients.length && row.evidence)) {
          pending.push(`${item.key}: required ${type} outbound evidence is missing.`);
        }
      }
      if (!required.length && !(item.outbound || []).length &&
          (!item.noOutboundEvidence?.reason || !item.noOutboundEvidence?.evidence)) {
        pending.push(`${item.key}: explicit evidence of no outbound recipients is missing.`);
      }
    }
    for (const pair of item.archivePairs || []) {
      if (!pair.localPdfPath || !pair.drivePdfSha256 || !pair.localPdfSha256) { pending.push(`${item.key}: archive pair incomplete.`); continue; }
      const localPath = resolve(root, pair.localPdfPath);
      if (!within(resolve(root, 'archive'), localPath) && !within(resolve(root, 'data'), localPath)) { violations.push(`${item.key}: archive path is outside private evidence directories.`); continue; }
      if (!existsSync(localPath)) { pending.push(`${item.key}: local PDF missing.`); continue; }
      const digest = hashFile(localPath);
      if (digest !== pair.drivePdfSha256 || digest !== pair.localPdfSha256) violations.push(`${item.key}: Drive and local PDF hashes differ.`);
    }
  }
  if (scenarioKeys.size !== scenarios.length || scenarios.some(item => !scenarioKeys.has(item.key))) violations.push('The six required scenarios are not all present.');
  for (const label of ['manual', 'prototype']) {
    const measure = record.measurements?.[label];
    if (!measure || !Number.isFinite(measure.elapsedSeconds) || measure.elapsedSeconds < 0 || !Number.isInteger(measure.humanActions) || measure.humanActions < 0 || !measure.evidence) pending.push(`${label}: observed time/actions/evidence incomplete.`);
  }
  const recording = record.recording || {};
  if (recording.relativePath) {
    const path = resolve(root, recording.relativePath);
    if (!within(privateRecordings, path)) violations.push('Recording must stay in ignored data/demo-recordings/.');
    else if (!existsSync(path)) pending.push('Recording file is missing.');
  }
  if (!recording.relativePath || !recording.requestId || !recording.playbackVerifiedAtUtc || recording.completeAndReadable !== true) pending.push('Full happy-path recording and playback verification incomplete.');
  const happyPath = (record.scenarios || []).find(item => item.key === 'group_success');
  if (recording.requestId && (happyPath?.status !== 'pass' || recording.requestId !== happyPath.requestId)) pending.push('Recording must match the passed group-success request.');
  if (!record.gate?.connectedReplayVerified) pending.push('Connected replay gate is not approved.');
  return { ready: violations.length === 0 && pending.length === 0, violations, pending };
}

function usage() {
  throw Error('Usage: node scripts/demo_replay.mjs prepare [--fixture <ignored fixture>] [--write] | verify <private run-record.json> [--fixture <ignored fixture>]');
}

function main(args) {
  const [command, ...rest] = args;
  if (command === 'prepare') {
    let fixturePath = resolve(root, 'data/dedicated-demo/demo_fixture.json');
    let write = false;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--fixture' && rest[i + 1]) fixturePath = resolve(rest[++i]);
      else if (rest[i] === '--write') write = true;
      else usage();
    }
    if (!within(resolve(root, 'data'), fixturePath)) throw Error('Use an ignored fixture under data/.');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const record = makeRunRecord(fixture, { sourceCommit });
    if (!write) { console.log(`Dry run: ${record.runId}; six scenarios validated. No files or Google assets changed. Use --write for a private record.`); return; }
    const dir = resolve(privateRuns, record.runId);
    if (!within(privateRuns, dir) || existsSync(dir)) throw Error('Run directory already exists.');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(dir, 'run-record.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`Private run record created: ${relative(root, dir)}. No Google assets changed.`);
    return;
  }
  if (command === 'verify' && rest.length >= 1) {
    const path = resolve(rest[0]);
    if (!within(privateRuns, path) || !path.endsWith('run-record.json')) throw Error('Verify a private run record under data/demo-replays/.');
    let fixturePath = resolve(root, 'data/dedicated-demo/demo_fixture.json');
    if (rest.length > 1) {
      if (rest.length !== 3 || rest[1] !== '--fixture') usage();
      fixturePath = resolve(rest[2]);
    }
    if (!within(resolve(root, 'data'), fixturePath)) throw Error('Use an ignored fixture under data/.');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const result = assessRunRecord(JSON.parse(readFileSync(path, 'utf8')), { fixture });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
    return;
  }
  usage();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
