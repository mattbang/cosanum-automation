type GoogleIdentity = { sub: string; email: string };
type GoogleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
let cached: { keys: GoogleJwk[]; until: number } | null = null;
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function decode(segment: string): Record<string, unknown> {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - segment.length % 4) % 4);
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}
function bytes(segment: string): Uint8Array<ArrayBuffer> {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - segment.length % 4) % 4);
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}
async function keys(fetcher: typeof fetch) {
  if (cached && cached.until > Date.now()) return cached.keys;
  const response = await fetcher(JWKS_URL);
  if (!response.ok) throw new Error('Google-Schlüssel nicht verfügbar.');
  const body = await response.json() as { keys?: GoogleJwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error('Google-Schlüssel ungültig.');
  cached = { keys: body.keys, until: Date.now() + 300000 };
  return cached.keys;
}

export async function verifyGoogleIdToken(token: string, clientId: string, fetcher: typeof fetch = fetch): Promise<GoogleIdentity> {
  if (!clientId || typeof token !== 'string' || token.length > 8192) throw new Error('Google-Anmeldung fehlt.');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Google-Token ungültig.');
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try { header = decode(parts[0]); payload = decode(parts[1]); } catch { throw new Error('Google-Token ungültig.'); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Google-Token-Algorithmus ungültig.');
  let jwk = (await keys(fetcher)).find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) { cached = null; jwk = (await keys(fetcher)).find(key => key.kid === header.kid && key.kty === 'RSA'); }
  if (!jwk) throw new Error('Google-Signaturschlüssel unbekannt.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!valid) throw new Error('Google-Signatur ungültig.');
  const now = Math.floor(Date.now() / 1000);
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(String(payload.iss)) ||
      payload.aud !== clientId || typeof payload.exp !== 'number' || payload.exp <= now ||
      typeof payload.iat !== 'number' || payload.iat > now + 60 ||
      !(payload.email_verified === true || payload.email_verified === 'true') ||
      typeof payload.sub !== 'string' || !payload.sub ||
      typeof payload.email !== 'string' || !payload.email)
    throw new Error('Google-Identität nicht bestätigt.');
  return { sub: payload.sub, email: payload.email.toLowerCase() };
}
