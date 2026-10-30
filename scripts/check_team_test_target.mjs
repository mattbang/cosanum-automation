#!/usr/bin/env node
// Read-only preflight for a private contributor sandbox inventory.
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const privateRoot = resolve(root, 'data/team-test');
const args = process.argv.slice(2);
if (![4, 6].includes(args.length) || args[0] !== '--target' || args[2] !== '--protected' ||
    (args.length === 6 && args[4] !== '--peer')) {
  throw new Error('Usage: node scripts/check_team_test_target.mjs --target data/team-test/<target>.json --protected data/team-test/<release>.json [--peer data/team-test/<other>.json]');
}

function readPrivateJson(path, label) {
  const full = resolve(root, path);
  if (!full.startsWith(privateRoot + sep) || !full.endsWith('.json')) {
    throw new Error(`${label} must be a JSON file inside ignored data/team-test/.`);
  }
  try { return JSON.parse(readFileSync(full, 'utf8')); }
  catch { throw new Error(`${label} could not be read as JSON.`); }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is missing.`);
  return value.trim();
}

function email(value, label) {
  const normalized = requiredString(value, label).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error(`${label} must be an email address.`);
  return normalized;
}

const protectedRelease = readPrivateJson(args[3], 'Protected release inventory');
if (protectedRelease.kind !== 'protected-release-v1') throw new Error('Protected inventory kind must be protected-release-v1.');

const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const scriptChanges = execFileSync('git', ['status', '--porcelain', '--', 'apps-script', '.claspignore'], { cwd: root, encoding: 'utf8' });
if (scriptChanges.trim()) throw new Error('Commit Apps Script source and .claspignore before approving a target inventory.');

const assetKeys = ['scriptId', 'cloudProjectNumber', 'spreadsheetId', 'driveFolderId', 'calendarId'];
if (!Array.isArray(protectedRelease.assetIds) || protectedRelease.assetIds.length < assetKeys.length) {
  throw new Error('Protected release inventory must list its five asset IDs.');
}
const protectedIds = new Set(protectedRelease.assetIds.map((value, index) => requiredString(value, `Protected asset ${index + 1}`).toLowerCase()));
if (!Array.isArray(protectedRelease.accountEmails) || !protectedRelease.accountEmails.length) {
  throw new Error('Protected release accounts are missing.');
}
const protectedAccounts = new Set(protectedRelease.accountEmails.map((value, index) => email(value, `Protected account ${index + 1}`)));
const sourceScopes = JSON.parse(readFileSync(resolve(root, 'apps-script/appsscript.json'), 'utf8')).oauthScopes;

function checkTarget(inventory, label) {
  if (inventory.kind !== 'contributor-test-v1') throw new Error(`${label} kind must be contributor-test-v1.`);
  if (inventory.sourceCommit !== head) throw new Error(`${label} sourceCommit must equal this checkout HEAD.`);
  if (!inventory.assetIds || typeof inventory.assetIds !== 'object') throw new Error(`${label} assetIds are missing.`);
  const ids = assetKeys.map(key => requiredString(inventory.assetIds[key], `${label} ${key}`).toLowerCase());
  if (new Set(ids).size !== ids.length) throw new Error(`${label} asset IDs must be distinct.`);
  if (!Array.isArray(inventory.testAccounts) || inventory.testAccounts.length !== 4) {
    throw new Error(`${label} must list exactly four synthetic test accounts.`);
  }
  const accounts = inventory.testAccounts.map((value, index) => email(value, `${label} test account ${index + 1}`));
  if (new Set(accounts).size !== accounts.length) throw new Error(`${label} test accounts must be distinct.`);
  if (!accounts.includes(email(inventory.ownerEmail, `${label} ownerEmail`))) {
    throw new Error(`${label} ownerEmail must be one of the four test accounts.`);
  }
  const fixture = readPrivateJson(requiredString(inventory.fixtureFile, `${label} fixtureFile`), `${label} fixture`);
  if (!Array.isArray(fixture.People) || fixture.People.length !== 4 ||
      fixture.People.some(row => !Array.isArray(row) || row.length < 2)) {
    throw new Error(`${label} fixture must contain four People rows.`);
  }
  const fixtureAccounts = fixture.People.map((row, index) => email(row[1], `${label} fixture account ${index + 1}`));
  if (new Set(fixtureAccounts).size !== 4 ||
      fixtureAccounts.some(account => !accounts.includes(account)) ||
      fixture.People.filter(row => row[0] === 'MATT').length !== 1 ||
      email(fixture.People.find(row => row[0] === 'MATT')[1], `${label} fixture owner`) !== email(inventory.ownerEmail, `${label} ownerEmail`)) {
    throw new Error(`${label} fixture accounts or owner do not match its inventory.`);
  }
  try {
    const source = readFileSync(resolve(root, 'apps-script/Schema.gs'), 'utf8') + '\n' +
      readFileSync(resolve(root, 'apps-script/Setup.gs'), 'utf8') + '\nvalidateFixture_(fixture);';
    runInNewContext(source, { fixture }, { timeout: 1000 });
  } catch {
    throw new Error(`${label} fixture does not satisfy setupDemo validation.`);
  }
  if (!Array.isArray(inventory.reviewedScopes) || inventory.reviewedScopes.length !== sourceScopes.length ||
      new Set(inventory.reviewedScopes).size !== sourceScopes.length ||
      inventory.reviewedScopes.some(scope => !sourceScopes.includes(scope))) {
    throw new Error(`${label} reviewedScopes must match apps-script/appsscript.json exactly.`);
  }
  if (ids.some(id => protectedIds.has(id) || protectedAccounts.has(id)) ||
      accounts.some(account => protectedAccounts.has(account) || protectedIds.has(account))) {
    throw new Error(`${label} overlaps the protected release inventory.`);
  }
  return { ids, accounts };
}

const target = checkTarget(readPrivateJson(args[1], 'Target inventory'), 'Target');
if (args.length === 6) {
  const peer = checkTarget(readPrivateJson(args[5], 'Peer inventory'), 'Peer');
  const targetValues = new Set([...target.ids, ...target.accounts]);
  if ([...peer.ids, ...peer.accounts].some(value => targetValues.has(value))) {
    throw new Error('Contributor target and peer inventories overlap.');
  }
}

console.log('PASS contributor target inventory: source, asset separation, account separation, and reviewed scopes.');
console.log('No Google permissions, sharing settings, or live assets were checked or changed.');
