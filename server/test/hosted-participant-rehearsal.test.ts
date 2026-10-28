import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import pg from 'pg';
import { createApiHandler } from '../src/app.ts';
import { runMigrations } from '../src/database.ts';
import { PostgresIdentityProvider, type VerifiedClaims } from '../src/identity.ts';
import { HostedParticipantLinks } from '../src/participant-links.ts';
import { ParticipantResponses } from '../src/participant-responses.ts';
import { PostgresWorkflowGateway } from '../src/postgres-gateway.ts';
import { PostgresWorkflowRepository } from '../src/postgres-workflows.ts';
import type { Identity } from '../src/service.ts';

const issuer = 'https://synthetic-issuer.invalid';
const owner: Identity = { actorKey: 'OWNER-REHEARSAL', role: 'process_quality', verifiedEmail: 'owner@example.test', issuer, subject: 'owner' };
const accounts: Record<string, VerifiedClaims> = {
  'fake-owner-token': { issuer, subject: 'owner', email: owner.verifiedEmail, emailVerified: true },
  'fake-person-1-token': { issuer, subject: 'person-1', email: 'one@example.test', emailVerified: true },
  'fake-person-2-token': { issuer, subject: 'person-2', email: 'two@example.test', emailVerified: true },
  'fake-wrong-account-token': { issuer, subject: 'wrong', email: 'wrong@example.test', emailVerified: true },
};

async function request(base: string, path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') && text ? JSON.parse(text) as Record<string, any> : {}, text };
}

test('synthetic hosted participant rehearsal uses same-origin HTTP, fake identities, and isolated PGlite state', async () => {
  const engine = new PGlite();
  const pool = new pg.Pool({ ...createPgConfig(engine), max: 1 });
  const receivedUrls: string[] = [];
  const server = createServer(async (req, res) => {
    receivedUrls.push(req.url ?? '');
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/' || path.startsWith('/participant-web/') || ['/app.js', '/core.js', '/config.js', '/styles.css'].includes(path)) {
      const rel = path === '/' ? 'index.html' : path.startsWith('/participant-web/') ? path.slice('/participant-web/'.length) : path.slice(1);
      try {
        const file = await readFile(resolve(join(import.meta.dirname, '../../participant-web', rel)));
        res.writeHead(200, { 'Content-Type': rel.endsWith('.js') ? 'text/javascript; charset=utf-8' : rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(file);
      } catch { res.writeHead(404); res.end(); }
      return;
    }
    await createApiHandler(apiDependencies)(req, res);
  });
  let apiDependencies: ReturnType<typeof dependenciesFor>;
  try {
    await runMigrations(pool);
    await pool.query(
      `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role)
       VALUES ($1, $2, $3, true, $4, $5)`, [owner.issuer, owner.subject, owner.verifiedEmail, owner.actorKey, owner.role],
    );
    const repository = new PostgresWorkflowRepository(pool);
    await repository.createRequest({
      id: 'REQ-REHEARSAL', requesterName: 'Synthetic rehearsal', sourceTeam: 'Test', reason: 'new_training', deadlineDate: '2026-11-20',
      sessions: [{ sessionId: 'SES-REHEARSAL' }],
      cases: [
        { caseId: 'CASE-ONE', sessionId: 'SES-REHEARSAL', participantKey: 'PERSON-ONE', participantEmail: 'one@example.test', trainerKey: 'TRAINER', ownerKey: owner.actorKey },
        { caseId: 'CASE-TWO', sessionId: 'SES-REHEARSAL', participantKey: 'PERSON-TWO', participantEmail: 'two@example.test', trainerKey: 'TRAINER', ownerKey: owner.actorKey },
      ],
    }, owner);
    apiDependencies = dependenciesFor(pool);
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    const page = await request(base, '/?case=CASE-ONE#link=fragment-is-not-sent');
    assert.equal(page.status, 200);
    assert.match(page.text, /participant-response/);
    assert.equal((await request(base, '/app.js')).status, 200);
    assert.ok(receivedUrls.every(url => !url.includes('fragment-is-not-sent')), 'the HTTP request never carries the fragment secret');
    const client = await readFile(resolve(join(import.meta.dirname, '../../participant-web/core.js')), 'utf8');
    const staticCheck = await readFile(resolve(join(import.meta.dirname, '../../participant-web/scripts/check-static.mjs')), 'utf8');
    assert.doesNotMatch(client, /\b(localStorage|sessionStorage|indexedDB)\b/);
    assert.match(client, /fragment\.get\('link'\)/);
    assert.match(staticCheck, /window\.history\.replaceState/);

    const issue = async (caseId: string, email: string) => {
      const assignment = await pool.query<{ assignment_id: string }>(
        "SELECT assignment_id FROM workflow_assignments WHERE case_id = $1 AND role = 'assigned_participant'", [caseId],
      );
      const result = await request(base, '/participant-links', { method: 'POST', token: 'fake-owner-token', body: {
        caseId, assignmentId: Number(assignment.rows[0]!.assignment_id), email, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } });
      assert.equal(result.status, 201);
      return result.body.token as string;
    };
    const tokenOne = await issue('CASE-ONE', 'one@example.test');
    const tokenTwo = await issue('CASE-TWO', 'two@example.test');
    const claim = async (token: string, bearer: string) => request(base, '/participant-links/claim', { method: 'POST', token: bearer, body: { linkToken: token } });
    assert.equal((await claim(tokenOne, 'fake-wrong-account-token')).status, 403, 'wrong account is rejected');
    assert.equal((await claim(tokenOne, 'fake-person-1-token')).status, 200);
    assert.equal((await claim(tokenTwo, 'fake-person-2-token')).status, 200);

    const expiredToken = await issue('CASE-ONE', 'one@example.test');
    const expiredHash = (await import('node:crypto')).createHash('sha256').update(expiredToken).digest();
    await pool.query('UPDATE hosted_participant_links SET expires_at = now() - interval \'1 second\' WHERE token_hash = $1', [expiredHash]);
    assert.equal((await claim(expiredToken, 'fake-person-1-token')).status, 401, 'expired link is rejected');
    const revokedToken = await issue('CASE-ONE', 'one@example.test');
    const revokedHash = (await import('node:crypto')).createHash('sha256').update(revokedToken).digest();
    await pool.query('UPDATE hosted_participant_links SET revoked_at = now() WHERE token_hash = $1', [revokedHash]);
    assert.equal((await claim(revokedToken, 'fake-person-1-token')).status, 401, 'revoked link is rejected');

    const readOne = await request(base, '/cases/CASE-ONE', { token: 'fake-person-1-token' });
    assert.equal(readOne.status, 200);
    assert.equal(readOne.body.evidence.facts.trainerPass, undefined);
    const payload = { caseId: 'CASE-ONE', idempotencyKey: 'rehearsal-affirmation-1', answer: 'yes', typedName: 'Synthetic Person One' };
    assert.equal((await request(base, '/participant-responses', { method: 'POST', token: 'fake-person-1-token', body: payload })).status, 409,
      'API blocks acknowledgement before trainer pass');
    assert.equal((await request(base, '/cases/CASE-ONE', { token: 'fake-person-2-token' })).status, 403,
      'group participant cannot read another person case');
    await pool.query("UPDATE workflow_cases SET evidence_facts = evidence_facts || '{\"trainerPass\":true}'::jsonb WHERE case_id = 'CASE-ONE'");
    const accepted = await request(base, '/participant-responses', { method: 'POST', token: 'fake-person-1-token', body: payload });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.status, 'verified');
    const retry = await request(base, '/participant-responses', { method: 'POST', token: 'fake-person-1-token', body: payload });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.replayed, true);
    assert.equal(retry.body.responseId, accepted.body.responseId);
    const readBack = await request(base, '/cases/CASE-ONE', { token: 'fake-person-1-token' });
    assert.equal(readBack.body.status, 'acknowledged');
    assert.equal(readBack.body.revision, accepted.body.revision);
    const otherCase = await request(base, '/cases/CASE-TWO', { token: 'fake-person-2-token' });
    assert.equal(otherCase.body.status, 'open', 'acknowledgement remains isolated to the responding group member');
    assert.equal((await request(base, '/cases/CASE-ONE', { token: 'fake-person-2-token' })).status, 403);
  } finally {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await pool.end();
    await engine.close();
  }
});

function dependenciesFor(pool: pg.Pool) {
  const verifier = { async verify(token: string) { return accounts[token] ?? null; } };
  return {
    identities: new PostgresIdentityProvider(pool, verifier), tokenVerifier: verifier,
    gateway: new PostgresWorkflowGateway(pool, { async execute() { throw new Error('Rehearsal does not execute workflow actions'); } }),
    requests: new PostgresWorkflowRepository(pool),
    participantLinks: new HostedParticipantLinks(pool), participantResponses: new ParticipantResponses(pool),
  };
}
