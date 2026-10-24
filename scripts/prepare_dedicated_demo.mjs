import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const target = resolve(root, 'data/dedicated-demo');
const stage = resolve(target, 'apps-script');
const authStage = resolve(target, 'auth-scopes');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--script-id' || !/^[A-Za-z0-9_-]{20,}$/.test(args[1]))) {
  throw new Error('Usage: node scripts/prepare_dedicated_demo.mjs [--script-id <new dedicated script ID>]');
}
const scriptId = args.length ? args[1] : '';
const sourceChanges = execFileSync('git', ['status', '--porcelain', '--', 'apps-script'], { cwd: root, encoding: 'utf8' });
if (sourceChanges.trim()) throw new Error('Review and commit Apps Script source before preparing a cutover snapshot.');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const oldFixture = JSON.parse(readFileSync(resolve(root, 'data/demo_fixture.json'), 'utf8'));
const fixture = structuredClone(oldFixture);
const owner = fixture.People.find(row => row[0] === 'MATT');
if (!owner || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner[1]) || fixture.People.length !== 4 ||
    fixture.Topics.length !== 5 || fixture.Skills.length !== 20) {
  throw new Error('The original synthetic fixture differs from the reviewed baseline.');
}
const oldOwnerEmail = owner[1].toLowerCase();
const configPath = resolve(target, 'target_config.json');
const existingConfig = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const dedicatedOwnerEmail = (process.env.COSANUM_DEMO_OWNER_EMAIL || existingConfig.expectedOwner || '').trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dedicatedOwnerEmail) || dedicatedOwnerEmail === oldOwnerEmail) {
  throw new Error('Set COSANUM_DEMO_OWNER_EMAIL to a distinct dedicated account before preparing the target.');
}
owner[1] = dedicatedOwnerEmail;
owner[2] = 'Process & Quality / Gruppentrainer / CCS';
if (fixture.People.some(row => String(row[1]).toLowerCase() === oldOwnerEmail)) {
  throw new Error('Personal owner account remains in the dedicated fixture.');
}

const oldTarget = JSON.parse(readFileSync(resolve(root, '.clasp.json'), 'utf8'));
if (scriptId && scriptId === oldTarget.scriptId) {
  throw new Error('Refusing to use the old-owner script ID as the dedicated target.');
}
const newTargetPath = resolve(target, '.clasp.json');
if (existsSync(newTargetPath)) {
  const newTarget = JSON.parse(readFileSync(newTargetPath, 'utf8'));
  if (newTarget.scriptId === oldTarget.scriptId) throw new Error('Dedicated clasp target points to the old-owner script.');
  if (scriptId && newTarget.scriptId !== scriptId) throw new Error('Refusing to replace a different dedicated script target.');
}

mkdirSync(stage, { recursive: true });
mkdirSync(authStage, { recursive: true });
copyFileSync(resolve(root, '.claspignore'), resolve(target, '.claspignore'));
const trackedScripts = execFileSync('git', ['ls-files', 'apps-script'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').map(path => path.slice('apps-script/'.length));
for (const name of trackedScripts) {
  if (!/\.(?:gs|html|json)$/.test(name) || name === 'PrivateFixture.gs') continue;
  copyFileSync(resolve(root, 'apps-script', name), resolve(stage, name));
}
writeFileSync(resolve(target, 'demo_fixture.json'), JSON.stringify(fixture, null, 2) + '\n', { mode: 0o600 });
writeFileSync(resolve(stage, 'PrivateFixture.gs'),
  '// Generated from the dedicated ignored synthetic fixture. Keep this file out of Git.\n' +
  'function getPrivateFixture_() {\n  return ' + JSON.stringify(fixture, null, 2) + ';\n}\n',
  { mode: 0o600 });
writeFileSync(resolve(authStage, 'appsscript.json'), JSON.stringify({ oauthScopes: [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/userinfo.email'
] }, null, 2) + '\n', { mode: 0o600 });
if (scriptId) {
  writeFileSync(newTargetPath, JSON.stringify({ scriptId, rootDir: 'apps-script' }, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(resolve(target, '.clasp-auth.json'),
    JSON.stringify({ scriptId, rootDir: 'auth-scopes' }, null, 2) + '\n', { mode: 0o600 });
}
writeFileSync(resolve(target, 'target_config.json'), JSON.stringify({
  expectedOwner: dedicatedOwnerEmail,
  cloudProjectNumber: '128866053942',
  sourceCommit,
  claspProjectFile: 'data/dedicated-demo/.clasp.json',
  claspAuthFile: 'data/dedicated-demo/.clasprc.json',
  archiveAuthFile: 'data/dedicated-demo/archive_oauth.json'
}, null, 2) + '\n', { mode: 0o600 });
console.log('Prepared isolated dedicated-account fixture and Apps Script staging tree under ignored data/dedicated-demo/.');
if (scriptId) console.log('Configured separate dedicated push and narrow-auth clasp targets.');
console.log('No Google account, script, Drive file, or credential was changed.');
