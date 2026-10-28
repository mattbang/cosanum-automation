import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SqlPool } from '../src/database.ts';
import { HostedParticipantLinks, ParticipantLinkError } from '../src/participant-links.ts';

function fakePool(options: { expiresAt?: Date; revokedAt?: Date | null; assignmentActive?: boolean; claimedIssuer?: string | null; claimedSubject?: string | null } = {}) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const connection = {
    async query(sql: string, values?: readonly unknown[]) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT a.assignment_id')) return { rows: [{ assignment_id: '7' }], rowCount: 1 } as never;
      if (sql.startsWith('SELECT l.link_id')) return { rows: [{
        link_id: 'link-1', case_id: 'CASE-1', assignment_id: '7', email_normalized: 'person@example.test',
        expires_at: options.expiresAt ?? new Date(Date.now() + 60_000), revoked_at: options.revokedAt ?? null,
        claimed_issuer: options.claimedIssuer ?? null, claimed_subject: options.claimedSubject ?? null,
        actor_key: 'PERSON-1', assignment_active: options.assignmentActive ?? true,
      }], rowCount: 1 } as never;
      if (sql.startsWith('SELECT actor_key, role, email_normalized, active')) return { rows: [], rowCount: 0 } as never;
      return { rows: [], rowCount: sql.startsWith('INSERT') || sql.startsWith('UPDATE') ? 1 : 0 } as never;
    },
    release() {},
  };
  const pool = { async connect() { return connection; }, async query() { return { rows: [], rowCount: 0 } as never; }, async end() {} } as unknown as SqlPool;
  return { pool, calls };
}

test('issues high-entropy participant link and stores only its SHA-256 hash', async () => {
  const db = fakePool();
  const links = new HostedParticipantLinks(db.pool);
  const expiresAt = new Date(Date.now() + 60_000);
  const result = await links.issue({
    caseId: 'CASE-1', assignmentId: 7, email: ' Person@Example.Test ', expiresAt,
    createdBy: { actorKey: 'OWNER-1', role: 'process_quality', verifiedEmail: 'owner@example.test' },
  });
  assert.equal(result.token.length, 43);
  const insert = db.calls.find(call => call.sql.startsWith('INSERT INTO hosted_participant_links'))!;
  assert.ok(Buffer.isBuffer(insert.values?.[2]));
  assert.notEqual((insert.values?.[2] as Buffer).toString('base64url'), result.token);
  assert.equal(insert.values?.[3], 'person@example.test');
  assert.ok(db.calls.some(call => call.sql.includes('participant_link.issue')));
});

test('claims require the assigned verified email and bind identity to that participant', async () => {
  const db = fakePool();
  const links = new HostedParticipantLinks(db.pool);
  await assert.rejects(links.claim('synthetic-link-token', {
    issuer: 'https://issuer.example.test', subject: 'sub-wrong', email: 'other@example.test', emailVerified: true,
  }), (error: unknown) => error instanceof ParticipantLinkError && error.status === 403);
  assert.equal(db.calls.some(call => call.sql.startsWith('UPDATE hosted_participant_links')), false);

  const identity = await links.claim('synthetic-link-token', {
    issuer: 'https://issuer.example.test', subject: 'sub-1', email: 'Person@Example.Test', emailVerified: true,
  });
  assert.deepEqual(identity, { actorKey: 'PERSON-1', role: 'assigned_participant', verifiedEmail: 'person@example.test' });
  assert.ok(db.calls.some(call => call.sql.includes('UPDATE workflow_assignments')));
  assert.ok(db.calls.some(call => call.sql.startsWith('INSERT INTO verified_identities')));
  assert.ok(db.calls.some(call => call.sql.includes('participant_link.claim')));
});

test('only Process & Quality can issue participant links', async () => {
  const db = fakePool();
  const links = new HostedParticipantLinks(db.pool);
  await assert.rejects(links.issue({
    caseId: 'CASE-1', assignmentId: 7, email: 'person@example.test', expiresAt: new Date(Date.now() + 60_000),
    createdBy: { actorKey: 'PERSON-1', role: 'assigned_participant', verifiedEmail: 'person@example.test' },
  }), (error: unknown) => error instanceof ParticipantLinkError && error.status === 403);
  assert.equal(db.calls.length, 0);
});

test('expired, revoked, or differently bound links fail closed', async () => {
  const claims = { issuer: 'https://issuer.example.test', subject: 'sub-1', email: 'person@example.test', emailVerified: true };
  for (const options of [
    { expiresAt: new Date(Date.now() - 1000) },
    { revokedAt: new Date() },
    { assignmentActive: false },
    { claimedIssuer: 'https://issuer.example.test', claimedSubject: 'another-subject' },
  ]) {
    const links = new HostedParticipantLinks(fakePool(options).pool);
    await assert.rejects(links.claim('synthetic-link-token', claims),
      (error: unknown) => error instanceof ParticipantLinkError && (error.status === 401 || error.status === 403));
  }
});
