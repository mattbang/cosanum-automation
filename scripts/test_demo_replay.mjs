import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assessRunRecord, makeRunRecord, validateFixture } from './demo_replay.mjs';

const root = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(resolve(root, 'data/demo_fixture.json'), 'utf8'));
const original = JSON.stringify(fixture);
const { allowlist } = validateFixture(fixture);
assert.equal(allowlist.length, 4);
const record = makeRunRecord(fixture);
assert.equal(record.scenarios.length, 6);
assert.equal(record.scenarios.every(row => row.status === 'not_run' && row.requestId === null), true);
assert.equal(assessRunRecord(record, { fixture }).ready, false);
assert.match(assessRunRecord(record, { fixture }).pending.join(' '), /Reviewed source commit/);
const noMeasurements = structuredClone(record);
delete noMeasurements.measurements;
assert.match(assessRunRecord(noMeasurements, { fixture }).pending.join(' '), /manual: observed time/);
assert.match(assessRunRecord(noMeasurements, { fixture }).pending.join(' '), /prototype: observed time/);

const tampered = structuredClone(fixture);
tampered.People[0][3] = '';
assert.throws(() => validateFixture(tampered), /marked demo/);
tampered.People[0][3] = '[DEMO]';
tampered.People[1][1] = tampered.People[0][1];
assert.throws(() => validateFixture(tampered), /distinct/);
assert.equal(JSON.stringify(fixture), original);

const outside = structuredClone(record);
outside.scenarios[0].outbound.push({ type: 'calendar', recipients: ['unknown@example.test'] });
assert.match(assessRunRecord(outside).violations.join(' '), /outside the test allowlist/);
outside.scenarios[0].outbound = [{ type: 'email', recipients: [allowlist[0]] }];
outside.boundary.demoSheetId = 'same';
outside.boundary.productionSheetId = 'same';
assert.match(assessRunRecord(outside).violations.join(' '), /identical/);
const swapped = structuredClone(record);
swapped.allowlist[0] = 'different@example.test';
assert.match(assessRunRecord(swapped, { fixture }).violations.join(' '), /allowlist differs/);

const temp = mkdtempSync(resolve(root, 'data', 'demo-replay-test-'));
try {
  const pdf = resolve(temp, 'test.pdf');
  writeFileSync(pdf, 'synthetic pdf bytes');
  const digest = createHash('sha256').update(readFileSync(pdf)).digest('hex');
  const archived = structuredClone(record);
  archived.scenarios[0].archivePairs.push({ personKey: 'WOHNUNG', caseId: 'case-one', proofId: 'proof-one', drivePdfId: 'drive-one', localPdfPath: pdf, drivePdfSha256: digest, localPdfSha256: digest });
  assert.equal(assessRunRecord(archived).violations.length, 0);
  archived.scenarios[0].archivePairs[0].drivePdfSha256 = '0'.repeat(64);
  assert.match(assessRunRecord(archived).violations.join(' '), /hashes differ/);
} finally { rmSync(temp, { recursive: true, force: true }); }

const duplicateArchives = structuredClone(record);
duplicateArchives.scenarios[0].status = 'pass';
duplicateArchives.scenarios[0].caseIds = ['case-one', 'case-two'];
const samePair = { personKey: 'WOHNUNG', caseId: 'case-one', proofId: 'proof-one', drivePdfId: 'drive-one' };
duplicateArchives.scenarios[0].archivePairs = [samePair, { ...samePair }];
assert.match(assessRunRecord(duplicateArchives, { fixture }).pending.join(' '), /distinct participant, case, proof/);
const wrongRecording = structuredClone(record);
wrongRecording.recording.requestId = 'unrelated';
assert.match(assessRunRecord(wrongRecording, { fixture }).pending.join(' '), /Recording must match/);

// Every tracked source file in the public Apps Script tree must reach the staged push.
const ignoreLines = readFileSync(resolve(root, '.claspignore'), 'utf8').split('\n').map(line => line.trim());
const included = new Set(ignoreLines.filter(line => line.startsWith('!')).map(line => line.slice(1)));
const source = readdirSync(resolve(root, 'apps-script')).filter(name => /\.(gs|html|json)$/.test(name));
for (const name of source) assert(included.has(name), `${name} omitted from clasp push`);
assert(included.has('Index.html'));
assert(included.has('FormsIdentity.gs'));
assert(included.has('ProofMetadata.gs'));
assert(included.has('Feedback.gs'));
const tracked = execFileSync('git', ['ls-files', 'apps-script'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
assert(!tracked.includes('apps-script/PrivateFixture.gs'), 'PrivateFixture must not be tracked in public source');
assert(included.has('PrivateFixture.gs'), 'Private fixture must reach the private staged push');
console.log('Demo replay: fixture bounds, fresh records, allowlist, archive hashes, and clasp source coverage passed');
