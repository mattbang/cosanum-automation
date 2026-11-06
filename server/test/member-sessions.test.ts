import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import { GoogleMemberTokenVerifier } from '../src/members/google-identity.ts';
import { createMemberHandler } from '../src/members/http.ts';
import { PostgresMemberSessionStore } from '../src/members/postgres-sessions.ts';
import { LocalSyntheticMemberSessionStore, MemberSessions, memberHash, type MemberSessionStore } from '../src/members/sessions.ts';
import { MemberError, type MemberClaims, type MemberSource, type MemberTaskRef } from '../src/members/types.ts';

const clientId = '123456-member-test.apps.googleusercontent.com';
const denied = (error: unknown) => error instanceof MemberError && [401, 403].includes(error.status);
const claims = (nonce: string, subject = 'subject-one'): MemberClaims => ({
  issuer: 'https://accounts.google.com', subject, email: 'member@gmail.com', emailVerified: true, nonce,
});
function fixture(store: MemberSessionStore = new LocalSyntheticMemberSessionStore()) {
  let revoked = false;
  let hold: (() => Promise<void>) | undefined;
  const profile = { personKey: 'PERSON1', displayName: 'Synthetic Member', email: 'member@gmail.com', initials: 'SM', roles: ['assigned_participant' as const] };
  const source: MemberSource = {
    async profile() { if (hold) await hold(); if (revoked) throw new MemberError(403, 'Inactive'); return profile; },
    async tasks() { if (hold) await hold(); if (revoked) throw new MemberError(403, 'Inactive'); return { profile, tasks: [], checkedAt: new Date().toISOString() }; },
    async open() { if (hold) await hold(); if (revoked) throw new MemberError(403, 'Inactive'); return { url: 'https://docs.google.com/forms/d/e/form-one/viewform', checkedAt: new Date().toISOString() }; },
  };
  const sessions = new MemberSessions(store, { async verify(value) { return JSON.parse(value) as MemberClaims; } }, source);
  return { sessions, profile, revoke() { revoked = true; }, allow() { revoked = false; }, hold(operation: () => Promise<void>) { hold = operation; } };
}
async function login(sessions: MemberSessions, browser?: string) {
  const challenge = await sessions.challenge(browser);
  const result = await sessions.login(JSON.stringify(claims(challenge.nonce)), challenge.browserId, challenge.challengeId);
  return { ...result, browser: challenge.browserId, challenge };
}

test('Google verification delegates signature and audience to the official verifier and rejects invalid claims', async () => {
  const now = 1_800_000_000;
  let payload = { iss: 'https://accounts.google.com', sub: 'google-subject', email: 'Member@Gmail.com', email_verified: true,
    aud: clientId, iat: now - 10, exp: now + 3600, nonce: 'a'.repeat(43) };
  let invalidSignature = false;
  const calls: Array<{ idToken: string; audience: string }> = [];
  const verifier = new GoogleMemberTokenVerifier(clientId, {
    async verifyIdToken(options) { calls.push(options); if (invalidSignature) throw new Error('Invalid signature'); return { getPayload: () => payload }; },
  }, () => new Date(now * 1000));
  assert.equal((await verifier.verify('synthetic-credential'))?.email, 'member@gmail.com');
  assert.deepEqual(calls[0], { idToken: 'synthetic-credential', audience: clientId });
  const good = { ...payload };
  for (const patch of [{ iss: 'https://attacker.test' }, { aud: 'another-client' }, { email_verified: false }, { exp: now }, { iat: now + 120 }, { sub: '' }, { nonce: '' }, { email: 'bad address' }, { azp: 'another-client' }]) {
    payload = { ...good, ...patch }; assert.equal(await verifier.verify('synthetic-credential'), null);
  }
  payload = good; invalidSignature = true;
  assert.equal(await verifier.verify('unsigned.or.forged'), null);
});

test('member login requires one-use nonce, stores hashes and restores only the same browser family', async () => {
  const store = new LocalSyntheticMemberSessionStore(), { sessions } = fixture(store);
  const pending = await sessions.challenge();
  await assert.rejects(sessions.login(JSON.stringify(claims('b'.repeat(43))), pending.browserId, pending.challengeId), denied);
  await assert.rejects(sessions.login(JSON.stringify(claims(pending.nonce)), pending.browserId, pending.challengeId), denied);
  const current = await login(sessions, pending.browserId);
  const saved = await store.read(memberHash(current.token));
  assert.ok(saved); assert.equal(saved.hash, memberHash(current.token)); assert.equal(saved.claims.nonce, undefined);
  assert.equal(JSON.stringify(saved).includes(current.token), false);
  assert.equal((await sessions.restore(current.token, current.browser)).profile.personKey, 'PERSON1');
  const other = await sessions.challenge();
  await assert.rejects(sessions.restore(current.token, other.browserId), denied);
  await assert.rejects(sessions.restore('a'.repeat(43), current.browser), denied);
});

test('logout revokes sibling tabs, rejects pending login and old retry cannot revoke a later login', async () => {
  const { sessions } = fixture();
  const first = await login(sessions), sibling = await login(sessions, first.browser);
  const pending = await sessions.challenge(first.browser);
  await sessions.logout(first.browser, first.view.generation);
  await assert.rejects(sessions.restore(first.token, first.browser), denied);
  await assert.rejects(sessions.restore(sibling.token, first.browser), denied);
  await assert.rejects(sessions.login(JSON.stringify(claims(pending.nonce)), first.browser, pending.challengeId), denied);
  const later = await login(sessions, first.browser);
  assert.equal(later.view.generation, first.view.generation + 1);
  await sessions.logout(first.browser, first.view.generation);
  assert.equal((await sessions.restore(later.token, first.browser)).generation, later.view.generation);
  await assert.rejects(sessions.logout(first.browser, later.view.generation + 1), /aktuell/);
});

test('expiry and current membership revocation invalidate sessions; source outage does not grant access', async () => {
  let now = new Date();
  const store = new LocalSyntheticMemberSessionStore(() => now);
  const source: MemberSource = { async profile() { return { personKey: 'P', displayName: 'P', email: 'member@gmail.com', initials: 'P', roles: ['assigned_participant'] }; }, async tasks() { throw new MemberError(503, 'Unavailable'); }, async open() { throw new MemberError(503, 'Unavailable'); } };
  const sessions = new MemberSessions(store, { async verify(value) { return JSON.parse(value); } }, source, () => now);
  const signedIn = await login(sessions);
  await assert.rejects(sessions.tasks(signedIn.token, signedIn.browser), (e: unknown) => e instanceof MemberError && e.status === 503);
  now = new Date(now.getTime() + 8 * 3600_000);
  await assert.rejects(sessions.restore(signedIn.token, signedIn.browser), denied);
  const active = fixture(), current = await login(active.sessions);
  active.revoke(); await assert.rejects(active.sessions.restore(current.token, current.browser), denied);
  active.allow(); await assert.rejects(active.sessions.restore(current.token, current.browser), denied);
});

test('logout during a Google source read prevents the delayed private response and form handoff', async () => {
  const active = fixture(), current = await login(active.sessions);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  active.hold(async () => { entered(); await gate; });
  const tasks = active.sessions.tasks(current.token, current.browser);
  await started; await active.sessions.logout(current.browser, current.view.generation); release();
  await assert.rejects(tasks, denied);
  await assert.rejects(active.sessions.open(current.token, current.browser, {} as MemberTaskRef), denied);
});

test('PostgreSQL session state survives a new service instance and revocation remains authoritative', async () => {
  const engine = new PGlite(), pool = new pg.Pool({ ...createPgConfig(engine), max: 1 });
  try {
    await runMigrations(pool, ['004_member_sessions.sql']);
    const first = fixture(new PostgresMemberSessionStore(pool));
    const current = await login(first.sessions);
    const second = fixture(new PostgresMemberSessionStore(pool));
    assert.equal((await second.sessions.restore(current.token, current.browser)).profile.personKey, 'PERSON1');
    const rows = await pool.query('SELECT session_hash,claims FROM member_sessions');
    assert.equal(rows.rows[0].session_hash, memberHash(current.token));
    assert.equal(JSON.stringify(rows.rows[0]).includes(current.token), false);
    assert.equal(rows.rows[0].claims.nonce, undefined);
    await second.sessions.logout(current.browser, current.view.generation);
    await assert.rejects(first.sessions.restore(current.token, current.browser), denied);
    const later = await login(second.sessions, current.browser);
    await first.sessions.logout(current.browser, current.view.generation);
    assert.equal((await second.sessions.restore(later.token, current.browser)).generation, later.view.generation);
    assert.equal((await pool.query("SELECT to_regclass('workflow_cases') AS cases")).rows[0].cases, null);
  } finally { await pool.end(); await engine.close(); }
});

test('same-origin member HTTP keeps credentials in HttpOnly cookies and blocks pending logout and cross-origin mutations', async () => {
  const active = fixture();
  let handler: ReturnType<typeof createMemberHandler>;
  const server = createServer((request, response) => { void handler(request, response); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  handler = createMemberHandler({ origin, googleClientId: clientId, sessions: active.sessions });
  const jar = new Map<string, string>();
  async function call(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
    const response = await fetch(origin + path, { method, headers: {
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(method === 'POST' ? { Origin: origin, 'X-Member-Request': '1', 'Content-Type': 'application/json' } : {}), ...extra,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const cookie of response.headers.getSetCookie()) { const first = cookie.split(';')[0], index = first.indexOf('='); jar.set(first.slice(0, index), first.slice(index + 1)); }
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
  }
  try {
    const config = await call('/member/config');
    assert.equal(config.body.googleClientId, clientId); assert.equal(config.headers.get('access-control-allow-origin'), null);
    assert.equal((await call('/member/session')).status, 401);
    assert.equal((await call('/member/auth/challenge', 'POST', {}, { Origin: 'https://attacker.test' })).status, 403);
    assert.equal((await call('/member/auth/challenge', 'POST', {}, { 'X-Member-Request': '' })).status, 403);
    const challenge = await call('/member/auth/challenge', 'POST', {});
    assert.ok(challenge.headers.getSetCookie().every(c => c.includes('HttpOnly') && c.includes('SameSite=Strict')));
    const signedIn = await call('/member/session', 'POST', { credential: JSON.stringify(claims(challenge.body.nonce)) });
    assert.equal(signedIn.status, 200); assert.equal(signedIn.body.token, undefined);
    assert.ok(signedIn.headers.getSetCookie()[0].includes('HttpOnly'));
    assert.equal((await call('/member/tasks')).status, 200);
    const logoutId = randomUUID(), marker = `${signedIn.body.generation}.${logoutId}`;
    jar.set(config.body.logoutCookieName, marker);
    assert.equal((await call('/member/tasks')).status, 401);
    assert.equal((await call('/member/session', 'POST', { credential: 'replay' })).status, 401);
    const logout = await call('/member/logout', 'POST', { generation: signedIn.body.generation, logoutId });
    assert.equal(logout.body.signedOut, true); assert.deepEqual(logout.headers.getSetCookie(), []);
    jar.delete(config.body.logoutCookieName);
    assert.equal((await call('/member/session')).status, 401);
    assert.equal((await call('/member/session?credential=never-in-url')).status, 400);
    assert.equal((await call('//[')).status, 400);
    assert.equal((await call('//attacker.test/member/session')).status, 400);
    assert.equal((await call('/member/config')).status, 200);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.throws(() => createMemberHandler({ origin: 'https://members.example.test', googleClientId: clientId, sessions: active.sessions }), /persistent/);
});
