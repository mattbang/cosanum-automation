import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture = JSON.parse(fs.readFileSync('fixtures/synthetic_demo.json', 'utf8'));
fixture.People.forEach((row, index) => { row[4] = 'PER-0' + (index + 1); });
const owner = fixture.People.find(row => row[0] === 'MATT')[1];
const properties = new Map();
let effective = owner, active = owner, now = Date.parse('2026-11-06T12:00:00Z');
let locked = false, calls = 0;
const events = [];
const store = {
  getProperty: key => properties.get(key) ?? null,
  getProperties: () => Object.fromEntries(properties),
  setProperty(key, value) { assert(locked); properties.set(key, value); },
  deleteProperty(key) { assert(locked); properties.delete(key); }
};
class Clock extends Date { static now() { return now; } }
const context = vm.createContext({
  Date: Clock, Set, String, Number, Object, JSON, Array, Math,
  Utilities: { getUuid: () => crypto.randomUUID(), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()] },
  Session: { getEffectiveUser: () => ({ getEmail: () => effective }), getActiveUser: () => ({ getEmail: () => active }) },
  PropertiesService: { getUserProperties: () => store },
  LockService: { getUserLock: () => ({ waitLock() { assert(!locked); locked = true; events.push('lock'); },
    releaseLock() { assert(locked); events.push('release'); locked = false; } }) },
  Drive: { About: { get: () => ({ user: { displayName: 'Demo Owner', emailAddress: owner } }) } }
});
const files = fs.readdirSync('apps-script').filter(name => name.endsWith('.gs'));
const publicNames = [];
for (const file of files) {
  const source = fs.readFileSync('apps-script/' + file, 'utf8');
  for (const match of source.matchAll(/^function\s+(\w+)\s*\(/gm)) if (!match[1].endsWith('_')) publicNames.push(match[1]);
  vm.runInContext(source, context, { filename: file });
}
assert.deepEqual(publicNames.sort(), ['beginAppSession', 'dispatchAppRequest', 'doGet', 'endAppSession',
  'onParticipantFormSubmit', 'onTrainerFormSubmit', 'restoreAppSession', 'saveAppPreferences'].sort(),
  'business, maintenance and clock methods must not be browser-callable entrypoints');
context.getPrivateFixture_ = () => fixture;
context.getCatalogue_ = () => { assert(locked, 'the authorization lock covers the whole operation'); events.push('business'); calls++; return { marker: 'synthetic' }; };
const browserA = crypto.randomUUID(), browserB = crypto.randomUUID();
const logoutId = crypto.randomUUID();
const end = (token, browserId = browserA, intent = crypto.randomUUID()) => context.endAppSession({ token, browserId, logoutId: intent });
const begin = browserId => context.beginAppSession({ browserId });
const dispatch = (token, method = 'getCatalogue', args = []) => context.dispatchAppRequest({ token, method, args });
const first = begin(browserA);
assert.equal(first.profile.email, owner);
assert.equal(first.profile.initials, 'DO');
assert.equal(first.profile.role, 'Process & Quality');
assert.match(first.token, /^[a-f0-9]{64}$/);
assert.equal(Date.parse(first.expiresAt), now + 8 * 60 * 60 * 1000);
assert(!JSON.stringify(Object.fromEntries(properties)).includes(first.token), 'only token hashes are stored server-side');
assert.throws(() => dispatch(undefined), /APP_SESSION_REQUIRED/);
assert.throws(() => dispatch('0'.repeat(64)), /APP_SESSION_REQUIRED/);
assert.equal(calls, 0);
assert.equal(context.restoreAppSession({ token: first.token }).profile.email, owner);
assert.equal(dispatch(first.token).marker, 'synthetic');
assert.deepEqual(events.slice(-3), ['lock', 'business', 'release']);
for (const method of ['constructor', '__proto__', 'setupDemo', 'resetDemoFixture_', 'beginAppSession']) {
  assert.throws(() => dispatch(first.token, method), /nicht verfügbar/);
}
assert.throws(() => dispatch(first.token, 'getCatalogue', [{}, {}, {}]), /nicht verfügbar/);
const beforePreferences = new Map(properties);
assert.throws(() => context.saveAppPreferences({ token: first.token, preferences: { density: 'compact', motion: 'system', role: 'admin' } }), /gültige/);
assert.deepEqual(properties, beforePreferences, 'invalid preferences never write settings');
context.saveAppPreferences({ token: first.token, preferences: { density: 'compact', motion: 'reduce' } });
assert.equal(context.restoreAppSession({ token: first.token }).preferences.density, 'compact');
active = 'wrong@example.test';
assert.throws(() => dispatch(first.token), /APP_ACCESS_DENIED/);
assert.throws(() => begin(browserA), /APP_ACCESS_DENIED/);
active = owner; effective = 'wrong@example.test';
assert.throws(() => context.restoreAppSession({ token: first.token }), /APP_ACCESS_DENIED/);
effective = owner;
const sibling = begin(browserA), elsewhere = begin(browserB);
const callsBeforeLogout = calls;
assert.equal(end(first.token, browserA, logoutId).signedOut, true);
assert.throws(() => dispatch(first.token), /APP_SESSION_REQUIRED/);
assert.throws(() => dispatch(sibling.token), /APP_SESSION_REQUIRED/, 'sibling-tab sessions are revoked on the server');
assert.equal(calls, callsBeforeLogout, 'replayed requests cannot reach business code');
assert.equal(dispatch(elsewhere.token).marker, 'synthetic', 'other browser sessions are independent');
assert.equal(end(first.token, browserA, logoutId).signedOut, true, 'logout retry is idempotent');
now += 8 * 60 * 60 * 1000;
assert.throws(() => context.restoreAppSession({ token: elsewhere.token }), /APP_SESSION_REQUIRED/);
assert.throws(() => dispatch(elsewhere.token), /APP_SESSION_REQUIRED/);
const valid = begin(browserA);
context.getCatalogue_ = () => { assert(locked); throw new Error('Synthetic service failure'); };
assert.throws(() => dispatch(valid.token), /Synthetic service failure/);
assert.equal(locked, false, 'failed operations release the session lock');
end(valid.token);
assert.throws(() => begin('invalid-browser'), /sichere App-Sitzung/);
const sessions = Array.from({ length: 17 }, () => begin(browserA));
assert.throws(() => context.restoreAppSession({ token: sessions[0].token }), /APP_SESSION_REQUIRED/, 'old sessions are bounded');
assert.equal(context.restoreAppSession({ token: sessions.at(-1).token }).profile.email, owner);
// An expired/evicted initiating token can still revoke this verified owner's browser family.
const old = begin(browserA);
now += 60 * 60 * 1000;
const newer = begin(browserA);
now += 7 * 60 * 60 * 1000;
assert.throws(() => context.restoreAppSession({ token: old.token }), /APP_SESSION_REQUIRED/);
const expiredLogout = crypto.randomUUID();
assert.equal(end(old.token, browserA, expiredLogout).signedOut, true);
assert.throws(() => dispatch(newer.token), /APP_SESSION_REQUIRED/);
const intentionalLogin = begin(browserA);
end(old.token, browserA, expiredLogout);
assert.equal(context.restoreAppSession({ token: intentionalLogin.token }).profile.email, owner, 'retrying old logout never revokes a later explicit login');
// Simulate logout finishing while an earlier login is fetching its Google profile.
const normalAbout = context.Drive.About.get;
context.Drive.About.get = () => { end(intentionalLogin.token); return normalAbout(); };
assert.throws(() => begin(browserA), /APP_SESSION_REQUIRED/, 'an earlier login cannot finish after family revocation');
context.Drive.About.get = normalAbout;
assert.equal(begin(browserA).profile.email, owner, 'a fresh explicit login starts in the new generation');
assert.throws(() => context.endAppSession({ token: 'forged', browserId: 'bad', logoutId: 'bad' }), /APP_SESSION_REQUIRED/);
for (const handler of ['onTrainerFormSubmit', 'onParticipantFormSubmit']) {
  assert.throws(() => context[handler]({ source: { id: 'forged' }, response: { id: 'forged' } }), /Google-Formularereignis/);
}
console.log('Pass: verified owner sessions, expiry, token hashes, explicit method allowlist, family revocation, locked dispatch, preferences and private entrypoints.');
