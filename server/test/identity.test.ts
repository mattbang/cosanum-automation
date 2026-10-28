import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresIdentityProvider } from '../src/identity.ts';

test('identity provider trusts only verified claims that match an active registered identity', async () => {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const db = {
    async query(sql: string, values?: readonly unknown[]) {
      calls.push({ sql, values });
      return { rows: [{ actor_key: 'PERSON-1', role: 'assigned_participant', email_normalized: 'person@example.test', email_verified: true, active: true }], rowCount: 1 };
    },
  } as never;
  const provider = new PostgresIdentityProvider(db, { async verify(token) {
    return token === 'verified' ? { issuer: 'https://issuer.example.test', subject: 'subject-1', email: ' Person@Example.Test ', emailVerified: true } :
      token === 'unverified' ? { issuer: 'https://issuer.example.test', subject: 'subject-1', email: 'person@example.test', emailVerified: false } : null;
  } });
  assert.equal(await provider.authenticate('unverified'), null);
  assert.equal(calls.length, 0);
  assert.deepEqual(await provider.authenticate('verified'), {
    actorKey: 'PERSON-1', role: 'assigned_participant', verifiedEmail: 'person@example.test', issuer: 'https://issuer.example.test', subject: 'subject-1',
  });
  assert.deepEqual(calls[0]!.values, ['https://issuer.example.test', 'subject-1', 'person@example.test']);
});

test('inactive identity registry rows are denied even when token claims are verified', async () => {
  const db = { async query() { return { rows: [{ actor_key: 'PERSON-1', role: 'assigned_participant', email_normalized: 'person@example.test', email_verified: true, active: false }], rowCount: 1 }; } } as never;
  const provider = new PostgresIdentityProvider(db, { async verify() { return { issuer: 'iss', subject: 'sub', email: 'person@example.test', emailVerified: true }; } });
  assert.equal(await provider.authenticate('verified'), null);
});
