import { env } from 'cloudflare:workers';
import { initialState } from '../../../lib/demo';
import { roomCookie } from '../../../lib/room-access';
import { verifyGoogleIdToken } from '../../../lib/google-auth';

export const runtime = 'edge';

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: 'Datenbank nicht bereit.' }, { status: 503 });
  if (!env.GOOGLE_CLIENT_ID && (!env.DEMO_CREATOR_CODE || request.headers.get('X-Demo-Code') !== env.DEMO_CREATOR_CODE))
    return Response.json({ error: 'Startcode ungültig.' }, { status: 403 });
  if (env.GOOGLE_CLIENT_ID) {
    try {
      const identity = await verifyGoogleIdToken(request.headers.get('X-Google-ID-Token') || '', env.GOOGLE_CLIENT_ID);
      if (!env.GOOGLE_TRAINER_EMAIL || identity.email !== env.GOOGLE_TRAINER_EMAIL.toLowerCase())
        return Response.json({ error: 'Nur das zugewiesene Trainerkonto kann eine Demo starten.' }, { status: 403 });
    } catch { return Response.json({ error: 'Bitte mit dem zugewiesenen Google-Konto anmelden.' }, { status: 401 }); }
  }
  const id = crypto.randomUUID();
  const hostToken = crypto.randomUUID() + crypto.randomUUID();
  const guestToken = crypto.randomUUID() + crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO demo_rooms (id, host_token_hash, guest_token_hash, state_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .bind(id, await sha256(hostToken), await sha256(guestToken), JSON.stringify(initialState()), now, now).run();
  return Response.json({ id, hostToken, guestToken }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': roomCookie(request, id, hostToken) } });
}
