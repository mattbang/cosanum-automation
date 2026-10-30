import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
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
  'fake-person-ui-token': { issuer, subject: 'person-ui', email: 'ui@example.test', emailVerified: true },
  'fake-wrong-account-token': { issuer, subject: 'wrong', email: 'wrong@example.test', emailVerified: true },
};

const CHROME_PATH = process.env.COSANUM_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

class DevToolsPage {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== 'number') return;
      const operation = this.pending.get(message.id);
      if (!operation) return;
      this.pending.delete(message.id);
      if (message.error) operation.reject(new Error(message.error.message));
      else operation.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const operation of this.pending.values()) operation.reject(new Error('Chrome DevTools connection closed'));
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<DevToolsPage> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, reject) => {
      socket.addEventListener('open', () => resolveOpen(), { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not connect to headless Chrome DevTools')), { once: true });
    });
    return new DevToolsPage(socket);
  }

  command(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
    return result.result.value as T;
  }

  close() { this.socket.close(); }
}

async function waitForPage(page: DevToolsPage, expression: string, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.evaluate<boolean>(expression)) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  const diagnostic = await page.evaluate(`({ url: location.href, readyState: document.readyState,
    signInDisabled: document.getElementById('sign-in')?.disabled,
    error: document.getElementById('error')?.textContent,
    config: window.COSANUM_PARTICIPANT_CONFIG, fetchLog: window.__fetchLog })`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

async function withHeadlessChrome<T>(origin: string, operation: (page: DevToolsPage) => Promise<T>, t: TestContext): Promise<T | undefined> {
  try { await access(CHROME_PATH); }
  catch { t.diagnostic(`Headless Chrome not found at ${CHROME_PATH}; set COSANUM_CHROME_PATH to enable browser checks`); return undefined; }
  const profile = await mkdtemp(join(tmpdir(), 'cosanum-participant-chrome-'));
  let chrome: ChildProcess | undefined;
  let page: DevToolsPage | undefined;
  try {
    chrome = spawn(CHROME_PATH, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--remote-allow-origins=*',
      '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-extensions',
      '--disable-sync', '--metrics-recording-only', '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { stdio: 'ignore' });
    const activePortPath = join(profile, 'DevToolsActivePort');
    let port = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      try { port = (await readFile(activePortPath, 'utf8')).split('\n')[0] ?? ''; if (port) break; }
      catch { /* Chrome is still starting. */ }
      if (chrome.exitCode !== null) throw new Error(`Headless Chrome exited during startup (${chrome.exitCode})`);
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
    }
    if (!port) throw new Error('Headless Chrome did not publish its DevTools port');
    const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    assert.equal(target.status, 200, 'Chrome creates a temporary blank tab');
    const targetInfo = await target.json() as { webSocketDebuggerUrl: string };
    page = await DevToolsPage.connect(targetInfo.webSocketDebuggerUrl);
    await page.command('Page.enable');
    await page.command('Runtime.enable');
    await page.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.command('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.__fetchLog = [];
      window.__historyWasReplaced = false;
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        window.__fetchLog.push({ url: String(url), hash: window.location.hash, historyWasReplaced: window.__historyWasReplaced, body: options.body || '' });
        return nativeFetch(url, options);
      };
      const nativeReplaceState = History.prototype.replaceState;
      History.prototype.replaceState = function(...args) {
        window.__historyWasReplaced = true;
        return nativeReplaceState.apply(this, args);
      };
      window.__fakeCredential = 'fake-wrong-account-token';
      window.google = { accounts: { id: {
        initialize({ callback }) { window.__fakeIdentityCallback = callback; },
        renderButton(element) {
          const button = document.createElement('button');
          button.id = 'synthetic-identity-button';
          button.type = 'button';
          button.textContent = 'Continue with synthetic account';
          button.addEventListener('click', () => window.__fakeIdentityCallback({ credential: window.__fakeCredential }));
          element.replaceChildren(button);
        }
      } } };
    })();` });
    await page.command('Page.navigate', { url: `${origin}/?case=CASE-UI&link=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG` });
    await waitForPage(page, "document.readyState === 'complete' && !document.getElementById('error').hidden", 'query-token rejection');
    assert.match(await page.evaluate<string>("document.getElementById('error').textContent"), /nicht sicher formatiert/i);
    assert.equal((await page.evaluate<any[]>("window.__fetchLog")).length, 0, 'query-string secret rejection happens before API fetch');
    const result = await operation(page);
    return result;
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise<void>(resolveExit => chrome!.once('exit', () => resolveExit()));
      chrome.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolveWait => setTimeout(resolveWait, 1500))]);
      if (chrome.exitCode === null) {
        const forceExit = new Promise<void>(resolveExit => chrome!.once('exit', () => resolveExit()));
        chrome.kill('SIGKILL');
        await Promise.race([forceExit, new Promise(resolveWait => setTimeout(resolveWait, 1500))]);
      }
    }
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function request(base: string, path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') && text ? JSON.parse(text) as Record<string, any> : {}, text };
}

test('synthetic participant API and static asset rehearsal uses fake identities and isolated PGlite state', async t => {
  const engine = new PGlite();
  const pool = new pg.Pool({ ...createPgConfig(engine), max: 1 });
  const receivedUrls: string[] = [];
  const responseAttempts: Record<string, unknown>[] = [];
  let failNextParticipantResponse = false;
  const server = createServer(async (req, res) => {
    receivedUrls.push(req.url ?? '');
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/' || path.startsWith('/participant-web/') || ['/app.js', '/core.js', '/config.js', '/styles.css'].includes(path)) {
      const rel = path === '/' ? 'index.html' : path.startsWith('/participant-web/') ? path.slice('/participant-web/'.length) : path.slice(1);
      try {
        const file = rel === 'config.js'
          ? Buffer.from("window.COSANUM_PARTICIPANT_CONFIG = Object.freeze({ apiOrigin: window.location.origin, identityProvider: 'google', googleClientId: 'synthetic-client' });")
          : await readFile(resolve(join(import.meta.dirname, '../../participant-web', rel)));
        res.writeHead(200, { 'Content-Type': rel.endsWith('.js') ? 'text/javascript; charset=utf-8' : rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(file);
      } catch { res.writeHead(404); res.end(); }
      return;
    }
    if (req.method === 'POST' && path === '/participant-responses' && failNextParticipantResponse) {
      failNextParticipantResponse = false;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      responseAttempts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Synthetic one-time outage' }));
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

    // Fetching a URL with a fragment demonstrates HTTP transport behavior only; the page script is not executed here.
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
    // This fixture seeds persisted evidence directly; it does not exercise trainer assessment submission.
    await pool.query("UPDATE workflow_cases SET status = 'assessed', evidence_facts = evidence_facts || '{\"trainerPass\":true}'::jsonb WHERE case_id = 'CASE-ONE'");
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

    await repository.createRequest({
      id: 'REQ-UI-REHEARSAL', requesterName: 'Synthetic browser rehearsal', sourceTeam: 'Test', reason: 'new_training', deadlineDate: '2026-11-20',
      sessions: [{ sessionId: 'SES-UI-REHEARSAL' }],
      cases: [{ caseId: 'CASE-UI', sessionId: 'SES-UI-REHEARSAL', participantKey: 'PERSON-UI', participantEmail: 'ui@example.test', trainerKey: 'TRAINER', ownerKey: owner.actorKey }],
    }, owner);
    const uiToken = await issue('CASE-UI', 'ui@example.test');
    const browserResult = await withHeadlessChrome(base, async page => {
      await page.command('Page.navigate', { url: `${base}/?case=CASE-UI&fresh=1#link=${uiToken}` });
      await waitForPage(page, "document.readyState === 'complete' && !document.getElementById('sign-in').disabled", 'configured participant page');
      assert.equal(await page.evaluate<string>('location.hash'), '', 'the invitation fragment is removed during page initialization');
      assert.equal(await page.evaluate<boolean>("window.__historyWasReplaced === true"), true);

      await page.evaluate<void>("document.getElementById('sign-in').click()");
      await waitForPage(page, "Boolean(document.getElementById('synthetic-identity-button'))", 'synthetic identity button');
      await page.evaluate<void>("document.getElementById('synthetic-identity-button').click()");
      await waitForPage(page, "!document.getElementById('error').hidden", 'wrong-account error');
      assert.match(await page.evaluate<string>("document.getElementById('error').textContent"), /nicht zugeordnet/i);
      const firstApiCall = await page.evaluate<any>('window.__fetchLog[0]');
      assert.equal(firstApiCall.hash, '', 'the fragment is absent when the first local API request begins');
      assert.equal(firstApiCall.historyWasReplaced, true, 'history cleanup ran before the first local API request');

      assert.equal(await page.evaluate<boolean>("Boolean(document.getElementById('synthetic-identity-button')?.getClientRects().length)"), true,
        'the retry uses the visible synthetic identity button');
      await page.evaluate<void>("window.__fakeCredential = 'fake-person-ui-token'; document.getElementById('synthetic-identity-button').click()");
      await waitForPage(page, "!document.getElementById('case-view').hidden && document.getElementById('case-status').textContent", 'assigned case read');
      assert.equal(await page.evaluate<boolean>("document.getElementById('participant-response').hidden"), true,
        'the rendered response form stays hidden before trainer pass');
      assert.match(await page.evaluate<string>("document.getElementById('action-state').textContent"), /noch nicht bestätigt/i);

      await pool.query("UPDATE workflow_cases SET status = 'assessed', evidence_facts = evidence_facts || '{\"trainerPass\":true}'::jsonb WHERE case_id = 'CASE-UI'");
      const refreshedToken = await issue('CASE-UI', 'ui@example.test');
      await page.command('Page.navigate', { url: `${base}/?case=CASE-UI&fresh=2#link=${refreshedToken}` });
      await waitForPage(page, "document.readyState === 'complete' && !document.getElementById('sign-in').disabled", 'fresh trainer-pass invitation');
      await page.evaluate<void>("window.__fakeCredential = 'fake-person-ui-token'");
      await page.evaluate<void>("document.getElementById('sign-in').click()");
      await waitForPage(page, "Boolean(document.getElementById('synthetic-identity-button'))", 'fresh synthetic identity button');
      await page.evaluate<void>("document.getElementById('synthetic-identity-button').click()");
      await waitForPage(page, "!document.getElementById('participant-response').hidden", 'trainer-pass response form');

      const mobile = await page.evaluate<{ width: number; scrollWidth: number; consentLabelHeight: number; nameHeight: number; submitHeight: number }>(`(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          consentLabelHeight: rect('.check-row').height, nameHeight: rect('#typed-name').height, submitHeight: rect('#submit-response').height };
      })()`);
      assert.equal(mobile.width, 390);
      assert.equal(mobile.scrollWidth, mobile.width, 'mobile page has no horizontal overflow');
      assert.ok(mobile.consentLabelHeight >= 44, 'the visible checkbox label offers a 44px touch area');
      assert.ok(mobile.nameHeight >= 44, 'the visible name field offers a 44px touch area');
      assert.ok(mobile.submitHeight >= 44, 'the visible submit button offers a 44px touch area');

      const beforeResponses = responseAttempts.length;
      await page.evaluate<void>("document.getElementById('submit-response').click()");
      assert.equal(await page.evaluate<boolean>("document.getElementById('answer-yes').validity.valueMissing"), true,
        'the native checkbox requirement blocks an unchecked form');
      assert.equal(responseAttempts.length, beforeResponses, 'unchecked response sends no POST');
      await page.evaluate<void>("document.getElementById('answer-yes').click(); document.getElementById('submit-response').click()");
      assert.equal(await page.evaluate<boolean>("document.getElementById('typed-name').validity.valueMissing"), true,
        'the required typed name blocks an empty form');
      assert.equal(responseAttempts.length, beforeResponses, 'empty typed name sends no POST');

      await page.evaluate<void>("document.getElementById('typed-name').value = 'Synthetic UI Person'; document.getElementById('typed-name').dispatchEvent(new Event('input', { bubbles: true })); window.__fetchLog = []");
      failNextParticipantResponse = true;
      await page.evaluate<void>("document.getElementById('submit-response').click()");
      await waitForPage(page, "document.getElementById('submit-response').textContent.includes('Mit derselben Antwort erneut versuchen')", 'bounded retry prompt after synthetic 503');
      const firstAttempt = await page.evaluate<any>("JSON.parse(window.__fetchLog.find(item => item.url.endsWith('/participant-responses')).body)");
      assert.equal(responseAttempts.length, beforeResponses + 1, 'one synthetic 503 was returned before persistence');
      assert.equal(firstAttempt.answer, 'yes');
      assert.equal(firstAttempt.typedName, 'Synthetic UI Person');
      await page.evaluate<void>("document.getElementById('submit-response').click()");
      await waitForPage(page, "!document.getElementById('notice').hidden && document.getElementById('case-status').textContent === 'Bestätigt'", 'response receipt and readback');
      const posts = await page.evaluate<any[]>("window.__fetchLog.filter(item => item.url.endsWith('/participant-responses')).map(item => JSON.parse(item.body))");
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[1], posts[0], 'retry uses the exact same answer and idempotency key');
      assert.equal(posts[0].idempotencyKey, responseAttempts[beforeResponses].idempotencyKey);
      assert.equal(await request(base, '/cases/CASE-UI', { token: 'fake-person-ui-token' }).then(result => result.body.status), 'acknowledged');
      return mobile;
    }, t);
    if (browserResult) assert.equal(browserResult.width, 390);
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
