import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiHandler } from '../src/app.ts';
import type { Identity, Snapshot } from '../src/service.ts';

async function call(handler: ReturnType<typeof createApiHandler>, method: string, url: string, body?: unknown, authorization?: string) {
  const request = {
    method, url, headers: authorization ? { authorization } : {},
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); },
  } as unknown as IncomingMessage;
  let status = 0;
  let content = '';
  const response = {
    writeHead(code: number) { status = code; },
    end(value?: string) { content = value || ''; },
  } as unknown as ServerResponse;
  await handler(request, response);
  return { status, body: content ? JSON.parse(content) as Record<string, unknown> : {} };
}

const identity: Identity = { actorKey: 'OWNER', role: 'process_quality', verifiedEmail: 'owner@example.test' };
const snapshot: Snapshot = {
  scope: { requestId: 'REQ-1', sessionId: 'SES-1', caseId: 'CASE-1' },
  request: { requesterName: 'Requester', sourceTeam: 'Demo', reason: 'new_training', deadlineDate: '2026-11-20' },
  personKey: 'PERSON', trainerKey: 'TRAINER', ownerKey: 'OWNER', revision: '1',
  evidence: { facts: { sessionPlanned: true, slotAvailable: true, calendarError: false, slotConflict: false, changedEvent: false }, values: {} },
};

test('HTTP actions and participant routes remain unavailable when authority is not configured', async () => {
  const handler = createApiHandler();
  const action = await call(handler, 'POST', '/actions', { actionId: 'bookSession', caseId: 'CASE-1', idempotencyKey: 'try-1' });
  assert.equal(action.status, 503);
  assert.equal(action.body.error, 'Verified identity and workflow executor are not configured');
  const request = await call(handler, 'POST', '/requests', {});
  assert.equal(request.status, 503);
  const dashboard = await call(handler, 'GET', '/dashboard/process-quality');
  assert.equal(dashboard.status, 503);
});

test('Process & Quality dashboard requires a verified bearer and never trusts a client role', async () => {
  let reads = 0;
  const handler = createApiHandler({
    identities: { async authenticate(token) {
      if (token === 'owner') return identity;
      if (token === 'trainer') return { ...identity, role: 'assigned_trainer' };
      return null;
    } },
    processQualityDashboard: { async read(actor) {
      reads++;
      assert.equal(actor.actorKey, 'OWNER');
      return { unscheduledRequests: [], upcomingSessions: [], attentionCases: [] };
    } },
  });
  assert.equal((await call(handler, 'GET', '/dashboard/process-quality')).status, 401);
  assert.equal((await call(handler, 'GET', '/dashboard/process-quality?role=process_quality', undefined, 'Bearer trainer')).status, 403);
  const accepted = await call(handler, 'GET', '/dashboard/process-quality', undefined, 'Bearer owner');
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, { unscheduledRequests: [], upcomingSessions: [], attentionCases: [] });
  assert.equal(reads, 1);
});

test('request creation preserves request-level mobile provenance and hosted link claim requires a verified bearer', async () => {
  const seen: unknown[] = [];
  const handler = createApiHandler({
    identities: { async authenticate(token) { return token === 'valid-owner' ? identity : null; } },
    requests: { async createRequest(input, actor) { seen.push({ input, actor }); return { requestId: input.id, caseIds: input.cases.map(item => item.caseId), replayed: false }; } },
    tokenVerifier: { async verify(token) { return token === 'valid-person' ? { issuer: 'https://issuer.example.test', subject: 'person-sub', email: 'person@example.test', emailVerified: true } : null; } },
    participantLinks: {
      async issue(input) { return { token: 'one-time-synthetic-link', expiresAt: input.expiresAt }; },
      async claim(linkToken, claims) { seen.push({ linkToken, claims }); return { actorKey: 'PERSON', role: 'assigned_participant', verifiedEmail: claims.email }; },
      async revoke() { return true; },
    },
  });
  {
    const requestBody = {
      id: 'REQ-MOBILE-1', requesterName: 'Requester Name', sourceTeam: 'Warehouse', reason: 'process_change', deadlineDate: '2026-11-20',
      sessions: [{ sessionId: 'SES-1' }], cases: [{ caseId: 'CASE-1', sessionId: 'SES-1', participantKey: 'PERSON', trainerKey: 'TRAINER', ownerKey: 'OWNER' }],
    };
    const created = await call(handler, 'POST', '/requests', requestBody, 'Bearer valid-owner');
    assert.equal(created.status, 201);
    const saved = JSON.parse(JSON.stringify(seen[0])) as { input: typeof requestBody };
    assert.equal(saved.input.requesterName, requestBody.requesterName);
    assert.equal(saved.input.sourceTeam, requestBody.sourceTeam);
    assert.equal(saved.input.reason, requestBody.reason);
    assert.equal(saved.input.deadlineDate, requestBody.deadlineDate);

    const denied = await call(handler, 'POST', '/participant-links/claim', { linkToken: 'secret' }, 'Bearer invalid');
    assert.equal(denied.status, 401);
    const claimed = await call(handler, 'POST', '/participant-links/claim', { linkToken: 'secret' }, 'Bearer valid-person');
    assert.equal(claimed.status, 200);
    assert.deepEqual(claimed.body, { status: 'claimed', actorKey: 'PERSON', role: 'assigned_participant' });
    assert.equal((seen[1] as { linkToken: string }).linkToken, 'secret');
  }
});

test('case reads and actions both enforce exact role assignment and idempotency', async () => {
  let writes = 0;
  let current = snapshot;
  const handler = createApiHandler({
    identities: { async authenticate(token) { return token === 'valid-owner' ? identity : null; } },
    gateway: {
      async load() { return current; },
      async execute(_actionId, _snapshot, _payload, actor, key) {
        assert.equal(actor.actorKey, 'OWNER'); assert.equal(key, 'book-1'); writes++;
        current = { ...snapshot, revision: '2', evidence: { facts: { ...snapshot.evidence.facts, eventVerified: true, receiptSaved: true }, values: {} } };
      },
    },
  });
  {
    const read = await call(handler, 'GET', '/cases/CASE-1', undefined, 'Bearer valid-owner');
    assert.equal(read.status, 200);
    const missingKey = await call(handler, 'POST', '/actions', { actionId: 'bookSession', caseId: 'CASE-1' }, 'Bearer valid-owner');
    assert.equal(missingKey.status, 400);
    const action = await call(handler, 'POST', '/actions', { actionId: 'bookSession', caseId: 'CASE-1', idempotencyKey: 'book-1' }, 'Bearer valid-owner');
    assert.equal(action.status, 200);
    assert.equal(action.body.revision, '2');
    assert.equal(writes, 1);
  }
});

test('participant response route requires a verified bearer and returns the persisted receipt', async () => {
  let received: unknown;
  const participant: Identity = {
    actorKey: 'PERSON', role: 'assigned_participant', verifiedEmail: 'person@example.test',
    issuer: 'https://issuer.example.test', subject: 'person-subject',
  };
  const handler = createApiHandler({
    identities: { async authenticate(token) { return token === 'valid-person' ? participant : null; } },
    participantResponses: { async submit(input, actor) {
      received = { input, actor };
      return { status: 'verified', actionId: 'acceptParticipantAcknowledgement', caseId: input.caseId,
        responseId: 'response-1', revision: '2', replayed: false };
    } },
  });
  assert.equal((await call(handler, 'POST', '/participant-responses', { caseId: 'CASE-1', idempotencyKey: 'key' })).status, 401);
  const invalid = await call(handler, 'POST', '/participant-responses', { caseId: 'CASE-1', idempotencyKey: 'key', answer: 'no', typedName: 'Person' }, 'Bearer valid-person');
  assert.equal(invalid.status, 400);
  const accepted = await call(handler, 'POST', '/participant-responses', {
    caseId: 'CASE-1', idempotencyKey: 'key', answer: 'yes', typedName: 'Person', facts: { trainerPass: true },
  }, 'Bearer valid-person');
  assert.equal(accepted.status, 201);
  assert.deepEqual(accepted.body, {
    status: 'verified', actionId: 'acceptParticipantAcknowledgement', caseId: 'CASE-1', responseId: 'response-1', revision: '2', replayed: false,
  });
  assert.deepEqual(received, { input: { caseId: 'CASE-1', idempotencyKey: 'key', answer: 'yes', typedName: 'Person' }, actor: participant });
});
