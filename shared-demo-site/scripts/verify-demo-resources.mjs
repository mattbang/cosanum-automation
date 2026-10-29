#!/usr/bin/env node
/** Fail local monorepo builds if the Site's separately packaged data is stale. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(siteDir, '..', 'contracts', 'demo-resources', 'v1');
const packagedDir = join(siteDir, 'lib', 'demo-resources', 'v1');
const names = ['people.json', 'topics.json', 'skills.json', 'materials.json'];
const hasCanonical = existsSync(join(sourceDir, 'people.json'));

for (const name of names) {
  const packaged = join(packagedDir, name);
  if (!existsSync(packaged)) throw new Error(`Missing packaged demo resource: ${name}`);
  JSON.parse(readFileSync(packaged, 'utf8'));
  if (hasCanonical && readFileSync(packaged, 'utf8') !== readFileSync(join(sourceDir, name), 'utf8')) {
    throw new Error(`Stale packaged demo resource: ${name}; run node contracts/demo-resources/v1/sync-site.mjs`);
  }
}
console.log(hasCanonical ? 'Packaged demo resources match canonical v1.' : 'Packaged demo resources are present; canonical source is outside this Site checkout.');
