import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MemberSessions } from './sessions.ts';
import { MemberError, type MemberTaskRef } from './types.ts';

type MemberHttpOptions = { origin: string; googleClientId: string; sessions: MemberSessions; staticDirectory?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cookies(request: IncomingMessage): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (request.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim(), value = part.slice(index + 1).trim();
    if (result.has(name) && /^(?:__Host-cosanum_member_|cosanum_dev_member_)/.test(name))
      throw new MemberError(401, 'Bitte die Anmeldung erneut öffnen.');
    result.set(name, value);
  }
  return result;
}

async function input(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
    throw new MemberError(415, 'Diese Anfrage wird nicht unterstützt.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const value of request) {
    const chunk = Buffer.from(value); size += chunk.length;
    if (size > 24_000) throw new MemberError(413, 'Die Anfrage ist zu groß.');
    chunks.push(chunk);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new MemberError(400, 'Die Anfrage konnte nicht gelesen werden.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MemberError(400, 'Die Anfrage ist ungültig.');
  return parsed as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

export function createMemberHandler(options: MemberHttpOptions) {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))))
    throw new Error('Member origin must be an exact HTTPS origin, or loopback for synthetic tests');
  const secure = origin.protocol === 'https:';
  if (options.sessions.storeKind !== 'postgres' && secure) throw new Error('A production member portal requires the persistent session store');
  const prefix = secure ? '__Host-cosanum_member_' : 'cosanum_dev_member_';
  const names = { session: prefix + 'session', browser: prefix + 'browser', challenge: prefix + 'challenge', logout: prefix + 'logout' };
  const staticDirectory = options.staticDirectory || fileURLToPath(new URL('../../../participant-web/member/', import.meta.url));
  const setCookie = (name: string, value: string, maxAge: number): string =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const staticAssets: Record<string, { name: string; type: string }> = {
    '/member/': { name: 'index.html', type: 'text/html; charset=utf-8' },
    '/member/app.js': { name: 'app.js', type: 'text/javascript; charset=utf-8' },
    '/member/core.js': { name: 'core.js', type: 'text/javascript; charset=utf-8' },
    '/member/styles.css': { name: 'styles.css', type: 'text/css; charset=utf-8' },
  };
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    let url: URL;
    try {
      const target = request.url || '/';
      if (!target.startsWith('/') || target.startsWith('//')) throw new Error('Invalid request target');
      url = new URL(target, options.origin);
    } catch {
      response.setHeader('Cache-Control', 'no-store');
      send(response, 400, { error: 'Die Seitenadresse ist ungültig.' }); return true;
    }
    if (url.pathname !== '/member' && !url.pathname.startsWith('/member/')) return false;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    try {
      if (url.search || url.hash) throw new MemberError(400, 'Bitte die Schulungsseite ohne zusätzliche Anmeldedaten öffnen.');
      if (request.method === 'GET' && url.pathname === '/member') {
        response.writeHead(302, { Location: '/member/' }); response.end(); return true;
      }
      const asset = staticAssets[url.pathname];
      if ((request.method === 'GET' || request.method === 'HEAD') && asset) {
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        const data = await readFile(join(staticDirectory, asset.name));
        response.writeHead(200, { 'Content-Type': asset.type }); response.end(request.method === 'HEAD' ? undefined : data); return true;
      }
      if (request.method === 'GET' && url.pathname === '/member/config') {
        send(response, 200, { googleClientId: options.googleClientId, logoutCookieName: names.logout }); return true;
      }
      if (request.method === 'POST') {
        if (request.headers.origin !== options.origin || request.headers['x-member-request'] !== '1' ||
            request.headers['sec-fetch-site'] === 'cross-site') throw new MemberError(403, 'Bitte die Anmeldung auf der Schulungsseite starten.');
      }
      const jar = cookies(request);
      const browser = jar.get(names.browser), session = jar.get(names.session);
      const pendingLogout = jar.has(names.logout);
      if (request.method === 'POST' && url.pathname === '/member/logout') {
        const data = await input(request);
        if (typeof data.logoutId !== 'string' || !uuid.test(data.logoutId)) throw new MemberError(400, 'Die Abmeldung konnte nicht zugeordnet werden.');
        send(response, 200, await options.sessions.logout(browser, data.generation)); return true;
      }
      if (pendingLogout) throw new MemberError(401, 'Bitte die ausstehende Abmeldung abschließen.');
      if (request.method === 'POST' && url.pathname === '/member/auth/challenge') {
        await input(request);
        const challenge = await options.sessions.challenge(browser);
        response.setHeader('Set-Cookie', [setCookie(names.browser, challenge.browserId, 30 * 86400), setCookie(names.challenge, challenge.challengeId, 600)]);
        send(response, 200, { nonce: challenge.nonce }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/member/session') {
        const data = await input(request);
        const result = await options.sessions.login(data.credential, browser, jar.get(names.challenge));
        response.setHeader('Set-Cookie', setCookie(names.session, result.token, 8 * 3600));
        send(response, 200, result.view); return true;
      }
      if (request.method === 'GET' && url.pathname === '/member/session') {
        send(response, 200, await options.sessions.restore(session, browser)); return true;
      }
      if (request.method === 'GET' && url.pathname === '/member/tasks') {
        send(response, 200, await options.sessions.tasks(session, browser)); return true;
      }
      if (request.method === 'POST' && url.pathname === '/member/tasks/open') {
        const data = await input(request);
        if (!['assigned_trainer', 'assigned_participant'].includes(String(data.role)) ||
            !['open_trainer_form', 'open_participant_form'].includes(String(data.action)) ||
            typeof data.caseId !== 'string' || !data.caseId || data.caseId.length > 250 ||
            typeof data.sessionId !== 'string' || !data.sessionId || data.sessionId.length > 250)
          throw new MemberError(400, 'Die Schulungsaufgabe ist ungültig.');
        send(response, 200, await options.sessions.open(session, browser, data as MemberTaskRef)); return true;
      }
      send(response, 404, { error: 'Diese Schulungsseite ist nicht verfügbar.' });
    } catch (error) {
      if (error instanceof MemberError) send(response, error.status, { error: error.message });
      else send(response, 503, { error: 'Die Schulungsverwaltung ist derzeit nicht erreichbar. Bitte erneut versuchen.' });
    }
    return true;
  };
}
