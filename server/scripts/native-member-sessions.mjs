import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../src/database.ts';
import { assertMemberSessionSchema } from '../src/members/database.ts';
import { MemberSessions, memberHash } from '../src/members/sessions.ts';
import { PostgresMemberSessionStore } from '../src/members/postgres-sessions.ts';
import { MemberError } from '../src/members/types.ts';
import { assertEmptyNativeSchema, resolveNativePostgresTarget } from './native-postgres-guard.mjs';

const connectionString = process.env.TEST_DATABASE_URL;
const { host, schemaName, options } = resolveNativePostgresTarget(connectionString, process.env.TEST_DATABASE_SCHEMA);
const pool = new pg.Pool({ connectionString, host, options, max: 8, statement_timeout: 10_000 });
const denied = error => error instanceof MemberError && error.status === 401;
const profile = { personKey: 'PERSON-NATIVE', displayName: 'Synthetic Member', email: 'member@example.test', initials: 'SM', roles: ['assigned_participant'] };
const source = { async profile() { return profile; }, async tasks() { return { profile, tasks: [], checkedAt: new Date().toISOString() }; }, async open() { throw new Error('No external form action in native session checks'); } };
const verify = { async verify(value) { return JSON.parse(value); } };
const claim = nonce => JSON.stringify({ issuer: 'https://accounts.google.com', subject: 'synthetic-native', email: profile.email, emailVerified: true, nonce });
const login = async (service, browser) => {
  const challenge = await service.challenge(browser);
  const current = await service.login(claim(challenge.nonce), challenge.browserId, challenge.challengeId);
  return { ...current, browser: challenge.browserId };
};
let runtimePool;
try {
  await assertEmptyNativeSchema(pool, schemaName);
  await assertMemberSessionSchema(pool);
  await runMigrations(pool, ['004_member_sessions.sql']);
  await assertMemberSessionSchema(pool);
  const role = 'member_runtime_' + randomBytes(5).toString('hex');
  await pool.query(`CREATE ROLE ${role} NOLOGIN`);
  await pool.query(`GRANT USAGE ON SCHEMA ${schemaName} TO ${role}`);
  await pool.query(`GRANT SELECT,INSERT,UPDATE ON member_browser_families TO ${role}`);
  await pool.query(`GRANT SELECT,INSERT,DELETE ON member_auth_challenges,member_sessions TO ${role}`);
  await pool.query(`GRANT SELECT ON schema_migrations TO ${role}`);
  runtimePool = new pg.Pool({ connectionString, host, options, max: 6, statement_timeout: 10_000 });
  const runtime = {
    async connect() { const client = await runtimePool.connect(); await client.query(`SET ROLE ${role}`); return client; },
    async query(sql, values) { const client = await this.connect(); try { return await client.query(sql, values); } finally { client.release(); } },
    async end() {},
  };
  const store = new PostgresMemberSessionStore(runtime), service = new MemberSessions(store, verify, source);
  await assertMemberSessionSchema(runtime);
  const first = await login(service), sibling = await login(service, first.browser);
  assert.equal((await service.restore(first.token, first.browser)).profile.personKey, profile.personKey);
  await assert.rejects(runtime.query('SELECT * FROM workflow_cases'), /does not exist/);
  await assert.rejects(runtime.query('DELETE FROM schema_migrations'), /permission denied/);
  console.log('Member session database role: session operations pass; training case access denied');

  const nonce = await service.challenge(first.browser);
  const attempts = await Promise.allSettled([
    service.login(claim(nonce.nonce), first.browser, nonce.challengeId),
    service.login(claim(nonce.nonce), first.browser, nonce.challengeId),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected' && denied(result.reason)).length, 1);
  console.log('Concurrent Google challenge claims: exactly one session issued');

  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const slow = new MemberSessions(new PostgresMemberSessionStore(runtime), {
    async verify(value) { entered(); await gate; return JSON.parse(value); },
  }, source);
  const pending = await slow.challenge(first.browser);
  const inFlight = slow.login(claim(pending.nonce), first.browser, pending.challengeId);
  await started;
  await service.logout(first.browser, first.view.generation);
  release();
  await assert.rejects(inFlight, denied);
  await assert.rejects(service.restore(first.token, first.browser), denied);
  await assert.rejects(service.restore(sibling.token, first.browser), denied);
  console.log('Logout versus an earlier in-flight Google login: family revoked, delayed issuance rejected');

  const later = await login(service, first.browser);
  await service.logout(first.browser, first.view.generation);
  assert.equal((await service.restore(later.token, first.browser)).generation, later.view.generation);
  console.log('Older logout retry: later explicit login remains valid');

  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN');
    const blockingPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await blocker.query('SELECT generation FROM member_browser_families WHERE family_hash=$1 FOR UPDATE', [memberHash(first.browser)]);
    const revocation = service.logout(first.browser, later.view.generation);
    let waited = false;
    for (let i = 0; i < 100; i++) {
      const result = await pool.query('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [blockingPid]);
      if (result.rowCount) { waited = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waited, true, 'revocation must wait on the family row in a separate native backend');
    await blocker.query('COMMIT');
    await revocation;
    await assert.rejects(service.restore(later.token, first.browser), denied);
  } finally { await blocker.query('ROLLBACK').catch(() => {}); blocker.release(); }
  const another = await login(new MemberSessions(new PostgresMemberSessionStore(runtime), verify, source));
  assert.equal((await service.restore(another.token, another.browser)).profile.personKey, profile.personKey);
  assert.equal((await pool.query("SELECT to_regclass('workflow_cases') AS cases")).rows[0].cases, null);
  console.log('Native family lock and independent browser isolation: passed; no training cases written');
  console.log('Native member session checks: all passed');
} finally { await runtimePool?.end(); await pool.end(); }
