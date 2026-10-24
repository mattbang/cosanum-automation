import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const privateRoot = resolve(root, 'data/team-test');
mkdirSync(privateRoot, { recursive: true });
const dir = mkdtempSync(join(privateRoot, 'preflight-'));
const stageName = `a-${randomUUID().slice(0, 8)}`;
const stageRoot = join(privateRoot, `stage-${stageName}-${execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()}`);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const scopes = JSON.parse(readFileSync(resolve(root, 'apps-script/appsscript.json'), 'utf8')).oauthScopes;
const schema = runInNewContext(readFileSync(resolve(root, 'apps-script/Schema.gs'), 'utf8') + '\nDEMO_SCHEMA');
const protectedRelease = {
  kind: 'protected-release-v1',
  assetIds: ['release-script-id', 'release-cloud-number', 'release-sheet-id', 'release-folder-id', 'release-calendar-id'],
  accountEmails: ['owner@example.test', 'trainer@example.test', 'one@example.test', 'two@example.test']
};
const write = (name, value) => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
};
const target = prefix => {
  const testAccounts = ['owner', 'trainer', 'one', 'two'].map(role => `${prefix}-${role}@example.test`);
  const peopleKeys = ['MATT', 'TRAINER', 'ONE', 'TWO'];
  const topicIds = ['TC_R030', 'TC_R027', 'TC_R033', 'TC_R052', 'TC_R077'];
  const Topics = topicIds.map((id, index) => {
    const row = Array(schema.sheets.Topics.length).fill('');
    row[0] = id; row[9] = '[DEMO]'; row[10] = index < 2 ? '' : 1;
    return row;
  });
  const People = peopleKeys.map((key, index) => {
    const row = Array(schema.sheets.People.length).fill('');
    row[0] = key; row[1] = testAccounts[index]; row[3] = '[DEMO]';
    row[4] = `PER-0${index + 1}`; row[5] = `Fictional ${key}`;
    return row;
  });
  const Skills = peopleKeys.flatMap(key => topicIds.map(id => {
    const row = Array(schema.sheets.Skills.length).fill('');
    row[0] = key; row[1] = id; row[2] = 0; row[4] = '[DEMO]';
    return row;
  }));
  const fixtureFile = write(`${prefix}-fixture.json`, { Topics, People, Skills });
  return {
    kind: 'contributor-test-v1', sourceCommit: head,
    ownerEmail: testAccounts[0], testAccounts, fixtureFile,
    assetIds: Object.fromEntries(['scriptId', 'cloudProjectNumber', 'spreadsheetId', 'driveFolderId', 'calendarId']
      .map(key => [key, `${prefix}-${key}`])),
    reviewedScopes: scopes
  };
};
const run = (a, b, c) => spawnSync(process.execPath,
  ['scripts/check_team_test_target.mjs', '--target', a, '--protected', b, ...(c ? ['--peer', c] : [])],
  { cwd: root, encoding: 'utf8' });

try {
  const releasePath = write('protected.json', protectedRelease);
  const a = target('a');
  const aPath = write(`${stageName}.json`, a);
  const b = target('b');
  const bPath = write('b.json', b);
  const passed = run(aPath, releasePath, bPath);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /PASS contributor target inventory/);
  assert.doesNotMatch(passed.stdout, /example\.test|a-scriptId|release-script-id/);
  const staged = spawnSync(process.execPath,
    ['scripts/stage_team_test_target.mjs', '--target', aPath, '--protected', releasePath, '--peer', bPath],
    { cwd: root, encoding: 'utf8' });
  assert.equal(staged.status, 0, staged.stderr);
  assert.doesNotMatch(staged.stdout, /example\.test|a-scriptId|release-script-id/);
  assert.equal(JSON.parse(readFileSync(join(stageRoot, '.clasp.json'), 'utf8')).scriptId, a.assetIds.scriptId);
  assert.match(readFileSync(join(stageRoot, 'apps-script/PrivateFixture.gs'), 'utf8'), /a-owner@example\.test/);
  assert.match(readFileSync(join(stageRoot, 'apps-script/Setup.gs'), 'utf8'), /function setupDemo/);
  const repeatedStage = spawnSync(process.execPath,
    ['scripts/stage_team_test_target.mjs', '--target', aPath, '--protected', releasePath, '--peer', bPath],
    { cwd: root, encoding: 'utf8' });
  assert.match(repeatedStage.stderr, /Staging tree already exists/);

  b.assetIds.scriptId = a.assetIds.scriptId;
  assert.match(run(aPath, releasePath, write('b-overlap.json', b)).stderr, /target and peer inventories overlap/);
  a.assetIds.scriptId = protectedRelease.assetIds[0];
  assert.match(run(write('a-release-overlap.json', a), releasePath).stderr, /overlaps the protected release/);
  a.assetIds.scriptId = 'a-scriptId';
  a.reviewedScopes = scopes.slice(1);
  assert.match(run(write('a-scope-drift.json', a), releasePath).stderr, /reviewedScopes must match/);
  a.reviewedScopes = scopes;
  a.testAccounts[1] = 'other@example.test';
  assert.match(run(write('a-fixture-drift.json', a), releasePath).stderr, /fixture accounts or owner do not match/);
  a.testAccounts[1] = 'a-trainer@example.test';
  a.fixtureFile = write('incomplete-fixture.json', { People: JSON.parse(readFileSync(a.fixtureFile, 'utf8')).People });
  assert.match(run(write('a-incomplete.json', a), releasePath).stderr, /fixture does not satisfy setupDemo validation/);
  assert.match(run(resolve(root, 'apps-script/appsscript.json'), releasePath).stderr, /inside ignored data\/team-test/);
  console.log('PASS contributor target preflight: isolation, complete fixture, scope drift, private path, and redacted output');
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(stageRoot, { recursive: true, force: true });
}
