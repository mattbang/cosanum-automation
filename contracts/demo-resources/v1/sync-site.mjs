#!/usr/bin/env node
/** Copy the validated synthetic resources into the separately packaged Site. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const targetDir = join(sourceDir, '..', '..', '..', 'shared-demo-site', 'lib', 'demo-resources', 'v1');
const names = ['people.json', 'topics.json', 'skills.json', 'materials.json'];
const check = process.argv.includes('--check');

if (!check) mkdirSync(targetDir, { recursive: true });
for (const name of names) {
  const source = readFileSync(join(sourceDir, name), 'utf8');
  const target = join(targetDir, name);
  if (check) {
    let existing;
    try { existing = readFileSync(target, 'utf8'); } catch { existing = undefined; }
    if (existing !== source) {
      console.error(`${target} differs from canonical ${name}; run node contracts/demo-resources/v1/sync-site.mjs`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(target, source);
  }
}
if (!process.exitCode) console.log(check ? 'Site resource copies match v1 source.' : 'Synced v1 resources into shared-demo-site.');
