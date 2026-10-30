#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
import { readFileSync } from 'node:fs';

const root = resolve(import.meta.dirname, '..');
const jsOnly = process.argv.includes('--js-only');
if (process.argv.some(arg => arg.startsWith('--') && arg !== '--js-only')) {
  throw new Error('Usage: node scripts/check_local.mjs [--js-only]');
}
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error(`Node 24 is required; found ${process.version}. See .node-version.`);
}

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`${label} failed (exit ${result.status ?? 'signal'}).`);
  }
  console.log(`PASS ${label}`);
}

const scripts = readdirSync(resolve(root, 'scripts'));
for (const file of scripts.filter(name => /^test_.*\.mjs$/.test(name)).sort()) {
  run(file, process.execPath, [`scripts/${file}`]);
}
for (const file of readdirSync(resolve(root, 'apps-script')).filter(name => name.endsWith('.gs')).sort()) {
  new Script(readFileSync(resolve(root, 'apps-script', file), 'utf8'), { filename: file });
}
console.log('PASS Apps Script JavaScript syntax');

if (!jsOnly) {
  let python;
  for (const candidate of process.platform === 'win32'
    ? [['py', ['-3']], ['python', []]]
    : [['python3', []], ['python', []]]) {
    const probe = spawnSync(candidate[0], [...candidate[1], '-c', 'import sys; assert sys.version_info >= (3, 11)'],
      { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    if (!probe.error && probe.status === 0) { python = candidate; break; }
  }
  if (!python) throw new Error('Python 3.11 or newer is required for the archive tests.');
  run('archive helper tests', python[0], [...python[1], '-m', 'unittest', 'scripts.test_archive_proof']);
}
console.log(`All ${jsOnly ? 'JavaScript ' : ''}local checks passed.`);
