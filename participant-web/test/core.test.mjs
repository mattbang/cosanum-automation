import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, canRetryParticipantResponse, invitationUrlWithoutSecret, isRetryableSubmissionError, participantResponseReady, readConfig, readInvitation } from '../core.js';

test('configuration fails closed until an API origin is provided', () => {
  assert.throws(() => readConfig({}), /not configured|konfiguriert/i);
  assert.throws(() => readConfig({ apiOrigin: 'http://api.example.test' }), /HTTPS/i);
  assert.equal(readConfig({ apiOrigin: 'https://api.example.test', identityProvider: 'google', googleClientId: '' }).apiOrigin, 'https://api.example.test');
});

test('invitation accepts a case locator and high entropy token, then removes the token from the URL', () => {
  const url = 'https://participant.example.test/?case=CASE-ABC-7#link=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
  assert.deepEqual(readInvitation(url), { caseId: 'CASE-ABC-7', linkToken: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', insecureQueryToken: false });
  assert.equal(invitationUrlWithoutSecret(url), '/?case=CASE-ABC-7');
  assert.deepEqual(readInvitation('https://participant.example.test/#case=CASE-ABC-7&link=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'), { caseId: 'CASE-ABC-7', linkToken: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', insecureQueryToken: false });
  assert.deepEqual(readInvitation('https://participant.example.test/?case=CASE-ABC-7&link=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'), { caseId: 'CASE-ABC-7', linkToken: '', insecureQueryToken: true });
  assert.deepEqual(readInvitation('https://participant.example.test/?case=not%20a%20case&link=short'), { caseId: '', linkToken: '', insecureQueryToken: true });
});

test('participant response requires a claimed participant link and persisted trainer pass', () => {
  const snapshot = { status: 'assessed', evidence: { facts: { trainerPass: true } } };
  assert.equal(participantResponseReady(snapshot, false), false);
  assert.equal(participantResponseReady({ status: 'assessed', evidence: { facts: { trainerPass: false } } }, true), false);
  assert.equal(participantResponseReady(snapshot, true), true);
  for (const status of ['open', 'invited', 'acknowledged', 'proof_ready', 'archived_verified', 'complete'])
    assert.equal(participantResponseReady({ ...snapshot, status }, true), false);
});

test('transient server and network failures can retry, while client conflicts cannot', () => {
  assert.equal(isRetryableSubmissionError(new TypeError('network unavailable')), true);
  for (const status of [500, 502, 503, 504, 599]) assert.equal(isRetryableSubmissionError({ status }), true);
  for (const status of [400, 401, 403, 404, 409]) assert.equal(isRetryableSubmissionError({ status }), false);
  assert.equal(canRetryParticipantResponse({ status: 502 }, 1), true);
  assert.equal(canRetryParticipantResponse(new TypeError('network unavailable'), 2), true);
  assert.equal(canRetryParticipantResponse({ status: 503 }, 3), false);
  assert.equal(canRetryParticipantResponse({ status: 409 }, 1), false);
});

test('API client uses configured origin and verified bearer without storing client state', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, async json() { return { status: 'claimed' }; } };
  };
  const result = await apiRequest({ apiOrigin: 'https://api.example.test/' }, '/participant-links/claim', 'verified-token', {
    method: 'POST', body: JSON.stringify({ linkToken: 'one-time-token' }),
  }, fetchImpl);
  assert.deepEqual(result, { status: 'claimed' });
  assert.equal(request.url, 'https://api.example.test/participant-links/claim');
  assert.equal(request.options.headers.Authorization, 'Bearer verified-token');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
});

test('participant response request sends only the contract payload and stable retry key', async () => {
  let request;
  const payload = { caseId: 'CASE-1', idempotencyKey: 'response-attempt-1', answer: 'yes', typedName: 'Ada Example' };
  await apiRequest({ apiOrigin: 'https://api.example.test' }, '/participant-responses', 'verified-token', {
    method: 'POST', body: JSON.stringify(payload),
  }, async (url, options) => {
    request = { url, options };
    return { ok: true, async json() { return { status: 'verified', actionId: 'acceptParticipantAcknowledgement', caseId: 'CASE-1', responseId: 'RESP-1', revision: '8', replayed: false }; } };
  });
  assert.equal(request.url, 'https://api.example.test/participant-responses');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer verified-token');
  assert.deepEqual(JSON.parse(request.options.body), payload);
});

test('API client translates assignment and unavailable errors without exposing server text', async () => {
  for (const [status, expected] of [[403, /nicht zugeordnet/i], [503, /nicht verfügbar/i]]) {
    await assert.rejects(apiRequest({ apiOrigin: 'https://api.example.test' }, '/cases/CASE-1', 'token', {}, async () => ({
      ok: false, status, async json() { return { error: 'private backend detail' }; },
    })), expected);
  }
});
