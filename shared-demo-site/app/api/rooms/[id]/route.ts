import { env } from 'cloudflare:workers';
import { transition, type DemoAction, type DemoState } from '../../../../lib/demo';
import { verifyGoogleIdToken } from '../../../../lib/google-auth';
import { roomToken, roomCookie } from '../../../../lib/room-access';

export const runtime = 'edge';
type Context = { params: Promise<{ id: string }> };
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function fail(message: string, status: number) { return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } }); }
async function load(request: Request, context: Context) {
  if (!env.DB) return { error: fail('Datenbank nicht bereit.', 503) };
  const { id } = await context.params;
  const token = roomToken(request, id);
  if (!token || !/^[a-f0-9-]{72}$/.test(token)) return { error: fail('Zugangslink fehlt.', 401) };
  const room = await env.DB.prepare('SELECT * FROM demo_rooms WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!room) return { error: fail('Demo nicht gefunden.', 404) };
  if (Date.now() - Date.parse(String(room.created_at)) > 72 * 3600000) return { error: fail('Dieser Demo-Link ist abgelaufen.', 410) };
  const hash = await sha256(token);
  const role = hash === room.host_token_hash ? 'host' : hash === room.guest_token_hash ? 'guest' : null;
  if (!role) return { error: fail('Dieser Zugangslink ist ungültig.', 403) };
  if (env.GOOGLE_CLIENT_ID) {
    try {
      const identity = await verifyGoogleIdToken(request.headers.get('X-Google-ID-Token') || '', env.GOOGLE_CLIENT_ID);
      const assignedEmail = role === 'host' ? env.GOOGLE_TRAINER_EMAIL : env.GOOGLE_PARTICIPANT_EMAIL;
      if (!assignedEmail || identity.email !== assignedEmail.toLowerCase())
        return { error: fail('Dieses Google-Konto ist für die Rolle nicht zugewiesen.', 403) };
    } catch { return { error: fail('Bitte mit dem zugewiesenen Google-Konto anmelden.', 401) }; }
  }
  return { room, role, id, token, participantEmail: role === 'host' ? env.GOOGLE_PARTICIPANT_EMAIL : undefined } as const;
}

export async function GET(request: Request, context: Context) {
  const loaded = await load(request, context);
  if ('error' in loaded) return loaded.error;
  return Response.json({ role: loaded.role, participantEmail: loaded.participantEmail, revision: loaded.room.revision, state: JSON.parse(String(loaded.room.state_json)) }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': roomCookie(request, loaded.id, loaded.token) } });
}

export async function POST(request: Request, context: Context) {
  const loaded = await load(request, context);
  if ('error' in loaded) return loaded.error;
  const db = env.DB;
  if (!db) return fail('Datenbank nicht bereit.', 503);
  let body: { revision?: number; action?: DemoAction };
  try { body = await request.json() as typeof body; } catch { return fail('Ungültige Anfrage.', 400); }
  if (!Number.isInteger(body.revision) || body.revision !== loaded.room.revision) return fail('Der Fall wurde auf dem anderen Gerät geändert. Bitte neu laden.', 409);
  if (!body.action || typeof body.action !== 'object' || typeof body.action.type !== 'string') return fail('Aktion fehlt.', 400);
  let next: DemoState;
  try { next = transition(JSON.parse(String(loaded.room.state_json)) as DemoState, loaded.role, body.action, new Date().toISOString()); }
  catch (error) { return fail(error instanceof Error ? error.message : 'Aktion abgelehnt.', 400); }
  const updated = await db.prepare('UPDATE demo_rooms SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
    .bind(JSON.stringify(next), new Date().toISOString(), loaded.id, body.revision).run();
  if (updated.meta.changes !== 1) return fail('Der Fall wurde auf dem anderen Gerät geändert. Bitte neu laden.', 409);
  return Response.json({ role: loaded.role, participantEmail: loaded.participantEmail, revision: Number(loaded.room.revision) + 1, state: next }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': roomCookie(request, loaded.id, loaded.token) } });
}
