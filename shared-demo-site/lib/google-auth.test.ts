import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyGoogleIdToken } from './google-auth.ts';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

test('Google ID token verifier checks signature, audience, expiry and verified email', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key' };
  const fetcher = (async () => Response.json({ keys: [jwk] })) as typeof fetch;
  const now = Math.floor(Date.now() / 1000);
  async function token(claims: Record<string, unknown>, signingKey = pair.privateKey) {
    const head = encode({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
    const body = encode({ iss: 'https://accounts.google.com', aud: 'demo-client', exp: now + 3600, iat: now, sub: 'subject-1', email: 'Trainer@example.com', email_verified: true, ...claims });
    const data = head + '.' + body;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, new TextEncoder().encode(data));
    return data + '.' + Buffer.from(signature).toString('base64url');
  }
  assert.deepEqual(await verifyGoogleIdToken(await token({}), 'demo-client', fetcher), { sub: 'subject-1', email: 'trainer@example.com' });
  await assert.rejects(verifyGoogleIdToken(await token({ aud: 'other-client' }), 'demo-client', fetcher));
  await assert.rejects(verifyGoogleIdToken(await token({ exp: now - 1 }), 'demo-client', fetcher));
  await assert.rejects(verifyGoogleIdToken(await token({ email_verified: false }), 'demo-client', fetcher));
  const different = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  await assert.rejects(verifyGoogleIdToken(await token({}, different.privateKey), 'demo-client', fetcher));
});
