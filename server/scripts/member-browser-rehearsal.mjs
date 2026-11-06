import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, claims } from '../test/member-source-fixture.ts';
import {
  MemberSessions,
  LocalSyntheticMemberSessionStore,
} from '../src/members/sessions.ts';
import { createMemberHandler } from '../src/members/http.ts';
const out =
  process.env.COSANUM_MEMBER_BROWSER_EVIDENCE ||
  (await mkdtemp(join(tmpdir(), 'cosanum-member-browser-evidence-')));
await mkdir(out, { recursive: true });
const data = fixture();
data.trainerPass('CASE-P1');
data.trainerPass('CASE-P2');
data.acknowledge('CASE-P2');
const source = data.source;
let failLogout = false,
  failTasks = false;
const sessions = new MemberSessions(
  new LocalSyntheticMemberSessionStore(),
  {
    async verify(value) {
      const c = JSON.parse(value);
      return c.issuer === 'https://accounts.google.com' &&
        c.emailVerified === true
        ? c
        : null;
    },
  },
  source,
);
let handler;
const server = createServer(async (req, res) => {
  if (failLogout && req.url === '/member/logout') {
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end('{"error":"Synthetic unavailable"}');
    return;
  }
  if (failTasks && req.url === '/member/tasks') {
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end('{"error":"Synthetic unavailable"}');
    return;
  }
  if (!(await handler(req, res))) {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
handler = createMemberHandler({
  origin,
  googleClientId: '123456-member-test.apps.googleusercontent.com',
  sessions,
});
const profile = await mkdtemp(join(tmpdir(), 'cosanum-members-chrome-'));
const chrome = spawn(
  process.env.COSANUM_CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sockets = [];
let browser;
class Client {
  constructor(socket) {
    this.socket = socket;
    this.n = 0;
    this.pending = new Map();
    this.events = new Map();
    this.errors = [];
    socket.addEventListener('message', (event) => {
      const m = JSON.parse(String(event.data));
      if (m.id) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.reject(Error(m.error.message));
        else p?.resolve(m.result);
      } else
        for (const fn of this.events.get(m.method) || [])
          Promise.resolve(fn(m.params)).catch((e) => {
            this.eventError = e;
          });
    });
  }
  static async open(url) {
    const s = new WebSocket(url);
    await new Promise((resolve, reject) => {
      s.addEventListener('open', resolve, { once: true });
      s.addEventListener('error', reject, { once: true });
    });
    sockets.push(s);
    return new Client(s);
  }
  command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.n;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(name, fn) {
    const a = this.events.get(name) || [];
    a.push(fn);
    this.events.set(name, a);
  }
  async eval(expression) {
    if (this.eventError) throw this.eventError;
    const r = await this.command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
    return r.result.value;
  }
  async wait(expr, label = expr) {
    for (let i = 0; i < 160; i++) {
      if (await this.eval(expr)) return;
      await pause(30);
    }
    const state = await this.eval(
      `({heading:document.querySelector('h1')?.textContent,error:document.getElementById('error')?.textContent,notice:document.getElementById('notice')?.textContent,login:document.getElementById('identity-status')?.textContent,loading:document.getElementById('loading-view')?.hidden,body:document.body.innerText.slice(0,900)})`,
    );
    throw Error(
      'Timed out ' +
        label +
        ' ' +
        JSON.stringify({ state, errors: this.errors }),
    );
  }
  async capture(name) {
    const r = await this.command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await writeFile(out + '/' + name + '.png', Buffer.from(r.data, 'base64'));
  }
  async layout(label) {
    const r = await this.eval(
      `({width:innerWidth,scroll:document.documentElement.scrollWidth,clipped:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.textContent)})`,
    );
    assert(r.scroll <= r.width + 1, label + ' overflow ' + JSON.stringify(r));
    assert.deepEqual(r.clipped, [], label + ' clipped');
    return r;
  }
}
const sdk = `(()=>{let options;window.google={accounts:{id:{initialize(value){options=value},renderButton(parent){const b=document.createElement('button');b.id='synthetic-google';b.textContent='Mit Google anmelden · lokale Testidentität';b.type='button';b.onclick=()=>{const all=${JSON.stringify(Object.fromEntries(['MATT', 'T2', 'P1', 'P2'].map((k) => [k, claims(k)])))};options.callback({credential:JSON.stringify({...all[window.__syntheticMember],nonce:options.nonce})})};parent.replaceChildren(b)},cancel(){},disableAutoSelect(){}}}}})()`;
const checks = [];
try {
  let port, browserPath;
  for (let i = 0; i < 120; i++) {
    try {
      const a = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8'))
        .trim()
        .split('\n');
      [port, browserPath] = a;
      if (port) break;
    } catch {}
    await pause(30);
  }
  assert(port);
  browser = await Client.open(`ws://127.0.0.1:${port}${browserPath}`);
  const make = async (key, context) => {
    if (!context)
      context = (await browser.command('Target.createBrowserContext'))
        .browserContextId;
    const target = (
      await browser.command('Target.createTarget', {
        url: 'about:blank',
        browserContextId: context,
      })
    ).targetId;
    const p = await Client.open(
      `ws://127.0.0.1:${port}/devtools/page/${target}`,
    );
    p.on('Runtime.exceptionThrown', (e) =>
      p.errors.push(
        e.exceptionDetails.exception?.description || e.exceptionDetails.text,
      ),
    );
    p.on('Log.entryAdded', (e) => p.errors.push(e.entry.text));
    await p.command('Page.enable');
    await p.command('Runtime.enable');
    await p.command('Log.enable');
    await p.command('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__syntheticMember=${JSON.stringify(key)};`,
    });
    await p.command('Fetch.enable', {
      patterns: [{ urlPattern: 'https://*' }],
    });
    p.on('Fetch.requestPaused', async (event) => {
      if (event.request.url === 'https://accounts.google.com/gsi/client')
        await p.command('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
          body: Buffer.from(sdk).toString('base64'),
        });
      else
        await p.command('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'BlockedByClient',
        });
    });
    await p.command('Page.navigate', { url: origin + '/member/' });
    await p.wait(
      "document.readyState==='complete' && (!document.getElementById('sign-in').disabled || !document.getElementById('member-view').hidden)",
    );
    return { p, context, target };
  };
  const signin = async (p) => {
    await p.eval("document.getElementById('sign-in').click()");
    await p.wait(
      "!!document.getElementById('synthetic-google')",
      'synthetic GSI button',
    );
    await p.eval("document.getElementById('synthetic-google').click()");
    await p.wait(
      "!document.getElementById('member-view').hidden && !document.getElementById('task-loading').hidden===false && !!document.querySelector('#task-list li')",
      'authenticated tasks',
    );
  };
  const p1 = await make('P1');
  for (const width of [320, 390, 820, 1440]) {
    await p1.p.command('Emulation.setDeviceMetricsOverride', {
      width,
      height: width < 500 ? 844 : 1000,
      deviceScaleFactor: 1,
      mobile: width < 500,
    });
    await p1.p.layout('login-' + width);
    await p1.p.capture('login-' + width);
    checks.push('login-layout-' + width);
  }
  await signin(p1.p);
  let text = await p1.p.eval('document.body.innerText');
  assert(text.includes('Person Eins'));
  assert(!text.includes('Person Zwei'));
  assert(!text.includes('Trainer Zwei'));
  assert(text.includes('Termin'));
  assert(
    (await p1.p.eval(
      "[...document.querySelectorAll('#task-list li')].length",
    )) >= 2,
  );
  for (const width of [320, 390, 820, 1440]) {
    await p1.p.command('Emulation.setDeviceMetricsOverride', {
      width,
      height: width < 500 ? 844 : 1000,
      deviceScaleFactor: 1,
      mobile: width < 500,
    });
    await p1.p.layout('participant-' + width);
    await p1.p.capture('participant-' + width);
    checks.push('participant-layout-' + width);
  }
  await p1.p.eval("document.querySelector('[data-task-action]').click()");
  await p1.p.wait(
    "!!document.querySelector('[data-form-task]')",
    'fresh permitted Form link',
  );
  assert.match(
    await p1.p.eval("document.querySelector('[data-form-task]').href"),
    /^https:\/\/docs.google.com\/forms\/d\/e\/published-/,
  );
  await p1.p.capture('participant-form-ready');
  checks.push('fresh-form-handoff');
  const attack = await p1.p.eval(
    `fetch('/member/tasks/open',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Member-Request':'1'},body:JSON.stringify({role:'assigned_trainer',caseId:'CASE-P2',sessionId:'SES-1',action:'open_trainer_form'})}).then(r=>r.status)`,
  );
  assert.equal(attack, 403);
  checks.push('participant-direct-trainer-action-denied');
  await p1.p.command('Page.reload');
  await p1.p.wait(
    "!document.getElementById('sign-in').disabled",
    'revoked attacker session stays signed out',
  );
  await signin(p1.p);
  await p1.p.eval("document.getElementById('account-button').click()");
  assert.equal(await p1.p.eval('document.activeElement.id'), 'profile-button');
  await p1.p.eval("document.getElementById('profile-button').click()");
  await p1.p.wait("document.getElementById('profile-dialog').open");
  await p1.p.layout('profile');
  await p1.p.capture('profile');
  await p1.p.eval("document.getElementById('close-profile').click()");
  checks.push('account-menu-profile-keyboard');
  const sibling = await make('P1', p1.context);
  await sibling.p.wait(
    "!document.getElementById('member-view').hidden",
    'sibling session restore',
  );
  await p1.p.eval(
    "document.getElementById('account-button').click();document.getElementById('logout-button').click()",
  );
  await p1.p.wait(
    "!document.getElementById('sign-in').disabled",
    'confirmed logout',
  );
  await sibling.p.wait(
    "document.getElementById('member-view').hidden",
    'sibling private DOM cleared',
  );
  await p1.p.command('Page.reload');
  await p1.p.wait(
    "!document.getElementById('sign-in').disabled",
    'signed-out refresh',
  );
  assert.equal(
    await p1.p.eval("document.querySelectorAll('#task-list li').length"),
    0,
  );
  checks.push('logout-sibling-refresh');
  await signin(p1.p);
  failLogout = true;
  await p1.p.eval(
    "document.getElementById('account-button').click();document.getElementById('logout-button').click()",
  );
  await p1.p.wait(
    "!document.getElementById('retry-logout').hidden",
    'failed logout retry',
  );
  assert.equal(
    await p1.p.eval("document.getElementById('sign-in').disabled"),
    true,
  );
  await p1.p.command('Page.reload');
  await p1.p.wait(
    "!document.getElementById('retry-logout').hidden",
    'pending logout reload barrier',
  );
  assert.equal(
    await p1.p.eval("document.getElementById('sign-in').disabled"),
    true,
  );
  await p1.p.capture('pending-logout');
  failLogout = false;
  await p1.p.eval("document.getElementById('retry-logout').click()");
  await p1.p.wait(
    "!document.getElementById('sign-in').disabled",
    'logout retry confirmed',
  );
  checks.push('pending-logout-reload-retry');
  const trainer = await make('MATT');
  await signin(trainer.p);
  text = await trainer.p.eval('document.body.innerText');
  assert(text.includes('Trainer Eins'));
  const assigned = await trainer.p.eval(
    "fetch('/member/tasks',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json())",
  );
  assert(
    assigned.tasks.every(
      (t) => t.role === 'assigned_trainer' && t.sessionId === 'SES-1',
    ),
  );
  await trainer.p.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await trainer.p.layout('trainer');
  await trainer.p.capture('trainer');
  checks.push('trainer-assigned-roster');
  const dual = await make('T2');
  await signin(dual.p);
  assert.equal(
    await dual.p.eval("document.querySelectorAll('#role-tabs button').length"),
    2,
  );
  await dual.p.eval(
    "document.getElementById('role-assigned_participant').click()",
  );
  await dual.p.layout('dual-role');
  await dual.p.capture('dual-role');
  checks.push('verified-dual-role-switch');
  const p2 = await make('P2');
  await signin(p2.p);
  text = await p2.p.eval('document.body.innerText');
  assert(text.includes('Person Zwei'));
  assert(!text.includes('Person Eins'));
  await p2.p.eval("document.getElementById('complete-tab').click()");
  await p2.p.layout('completed');
  await p2.p.capture('participant-completed');
  checks.push('same-session-participants-isolated');
  await dual.p.command('Page.bringToFront');
  await dual.p.wait("document.visibilityState === 'visible' && !document.getElementById('refresh-tasks').disabled", 'visible dual-role session');
  failTasks = true;
  await dual.p.eval("document.getElementById('refresh-tasks').click()");
  await dual.p.wait(
    "!document.getElementById('tasks-error').hidden",
    'source outage',
  );
  await dual.p.capture('source-unavailable');
  assert.equal(
    await dual.p.eval("document.querySelectorAll('[data-task-action]').length"),
    0,
  );
  failTasks = false;
  checks.push('source-outage-no-stale-actions');
  const report = {
    evidence: 'local_synthetic_browser',
    checks,
    passed: checks.length,
    externalGoogleCalls: false,
    realTrainingWrites: false,
    source: 'canonical private-workflow projection with synthetic rows',
    screenshots: out,
  };
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  for (const s of sockets) s.close();
  const exited =
    chrome.exitCode === null
      ? new Promise((resolve) => chrome.once('exit', resolve))
      : Promise.resolve();
  chrome.kill('SIGTERM');
  await exited;
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 6,
    retryDelay: 100,
  });
}
