#!/usr/bin/env node
// Build an ignored clasp staging tree after the read-only target preflight.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (![4, 6].includes(args.length) || args[0] !== '--target' || args[2] !== '--protected' ||
    (args.length === 6 && args[4] !== '--peer')) {
  throw new Error('Usage: node scripts/stage_team_test_target.mjs --target data/team-test/<target>.json --protected data/team-test/<release>.json [--peer data/team-test/<other>.json]');
}
execFileSync(process.execPath, ['scripts/check_team_test_target.mjs', ...args], { cwd: root, stdio: 'pipe' });

const name = basename(args[1], '.json');
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Target inventory filename must use lowercase letters, numbers, and hyphens.');
const target = JSON.parse(readFileSync(resolve(root, args[1]), 'utf8'));
const fixture = JSON.parse(readFileSync(resolve(root, target.fixtureFile), 'utf8'));
const stageRoot = resolve(root, 'data/team-test', `stage-${name}-${target.sourceCommit.slice(0, 12)}`);
if (existsSync(stageRoot)) throw new Error('Staging tree already exists; inspect it before creating another.');
const sourceFiles = execFileSync('git', ['ls-files', 'apps-script'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(path => /\.(?:gs|html|json)$/.test(path) && path !== 'apps-script/PrivateFixture.gs');
if (!sourceFiles.length) throw new Error('No tracked Apps Script source files found.');

const scriptRoot = resolve(stageRoot, 'apps-script');
mkdirSync(scriptRoot, { recursive: true });
for (const file of sourceFiles) copyFileSync(resolve(root, file), resolve(scriptRoot, basename(file)));
copyFileSync(resolve(root, '.claspignore'), resolve(stageRoot, '.claspignore'));
writeFileSync(resolve(scriptRoot, 'PrivateFixture.gs'),
  '// Generated from an ignored contributor fixture. Keep this file out of Git.\n' +
  'function getPrivateFixture_() {\n  return ' + JSON.stringify(fixture, null, 2) + ';\n}\n',
  { mode: 0o600 });
writeFileSync(resolve(stageRoot, '.clasp.json'),
  JSON.stringify({ scriptId: target.assetIds.scriptId, rootDir: 'apps-script' }, null, 2) + '\n',
  { mode: 0o600 });
console.log('PASS ignored contributor staging tree prepared from the reviewed source commit.');
console.log('No Google script, deployment, asset, credential, or permission was changed.');
