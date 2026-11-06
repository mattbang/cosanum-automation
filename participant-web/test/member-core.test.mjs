import test from 'node:test';
import assert from 'node:assert/strict';
import { MemberClient, logoutCookie, memberRequest, readCookie, readLogoutIntent, readMemberConfig,
  readMemberProfile, readMemberTasks, validatedFormUrl } from '../member/core.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const UUID = '8b20ec3e-5754-4cc7-a54a-e96d5c7a25ed';
const UUID2 = '4858745c-ad15-408c-a1f0-5aa8f6e2f392';
const CONFIG = { googleClientId: 'synthetic-client.apps.googleusercontent.com', logoutCookieName: 'cosanum_member_logout' };
const PROFILE = { personKey: 'person-synthetic-1', displayName: 'Testperson Eins', email: 'person1@example.invalid',
  initials: 'TE', roles: ['assigned_participant'] };
const SESSION = { profile: PROFILE, expiresAt: '2026-11-06T13:00:00Z', generation: 2 };
const TASK = { id: 'task-1', role: 'assigned_participant', caseId: 'case-1', sessionId: 'session-1', requestId: 'request-1',
  title: 'Synthetische Schulung', phase: 'practice', state: 'ready', statusLabel: 'Bestätigung offen', reason: 'Beurteilung liegt vor.',
  action: { id: 'open_participant_form', label: 'Teilnahme bestätigen' } };
const LIST = { profile: PROFILE, tasks: [TASK], checkedAt: '2026-11-06T12:00:00Z' };
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) }; }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function serializedMarkerLock() {
  let tail = Promise.resolve();
  let queued = 0;
  let active = 0;
  const lock = callback => {
    queued += 1;
    const operation = tail.then(async () => {
      active += 1;
      try { return await callback(); } finally { active -= 1; }
    });
    tail = operation.catch(() => {});
    return operation;
  };
  lock.queued = () => queued;
  lock.active = () => active;
  return lock;
}
async function until(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Synthetic interleaving did not reach its checkpoint');
}
function setup({ handler, cookie = '', rejectCookies = false, sharedCookie, markerLock = serializedMarkerLock(), generation = 2, uuid = UUID } = {}) {
  const requests = [];
  const writes = [];
  const cookieState = sharedCookie || { value: cookie };
  let time = NOW;
  const timers = new Map();
  let timerId = 0;
  const cookies = { read: () => {
    const value = cookieState.value;
    cookieState.onRead?.(value);
    return value;
  }, write: value => {
    writes.push(value);
    cookieState.onWrite?.(value, cookieState.value);
    if (!rejectCookies) cookieState.value = value.includes('Max-Age=0') ? '' : value.split(';')[0];
  } };
  const fetchImpl = async (path, options) => {
    const request = { path, ...options, body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(request);
    const custom = await handler?.(request, { setCookie: value => { cookieState.value = value; } });
    if (custom) return custom;
    if (path === '/member/config') return response(CONFIG);
    if (path === '/member/session') return response({ ...SESSION, generation });
    if (path === '/member/tasks') return response(LIST);
    if (path === '/member/auth/challenge') return response({ nonce: 'synthetic-server-nonce' });
    if (path === '/member/logout') return response({ signedOut: true });
    if (path === '/member/tasks/open') return response({ url: 'https://docs.google.com/forms/d/e/synthetic-form/viewform', checkedAt: LIST.checkedAt });
    throw new Error(`Unexpected synthetic route ${path}`);
  };
  const changes = [];
  const notifications = [];
  let announcements = 0;
  const client = new MemberClient({ fetchImpl, cookies, now: () => time, randomUUID: () => uuid, secure: true,
    withMarkerLock: markerLock,
    onChange: state => changes.push(state), notifyLogout: intent => { announcements += 1; notifications.push(intent); },
    setTimer: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimer: id => timers.delete(id) });
  return { client, requests, writes, changes, timers, notifications, get announcements() { return announcements; },
    get cookie() { return cookieState.value; }, set cookie(value) { cookieState.value = value; }, advance: value => { time += value; } };
}

test('member requests use same-origin cookies, no cache and a protected JSON POST', async () => {
  const calls = [];
  await memberRequest('/member/auth/challenge', { method: 'POST' }, async (path, options) => { calls.push({ path, options }); return response({ nonce: 'synthetic' }); });
  assert.equal(calls[0].path, '/member/auth/challenge');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.headers['X-Member-Request'], '1');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
  await assert.rejects(memberRequest('https://other.example/member/session'), /gültigen/);
});

test('default browser timers and fetch retain the global receiver during initial boot', async () => {
  const original = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, fetch: globalThis.fetch };
  const calls = [];
  try {
    globalThis.clearTimeout = function (id) { assert.equal(this, globalThis); calls.push(['clear', id]); };
    globalThis.setTimeout = function (_callback, delay) { assert.equal(this, globalThis); calls.push(['set', delay]); return 42; };
    globalThis.fetch = function (path) { assert.equal(this, globalThis); calls.push(['fetch', path]); return Promise.resolve(response(CONFIG)); };
    const client = new MemberClient({ cookies: { read: () => '', write: () => {} }, now: () => NOW });
    client.clearTimers();
    client.state.expiresAt = SESSION.expiresAt;
    client.scheduleExpiry();
    assert.equal(client.expiryTimer, 42);
    assert.deepEqual(await client.request('/member/config'), CONFIG);
    client.dispose();
    assert.ok(calls.some(([kind, value]) => kind === 'set' && value === 3600000));
    assert.ok(calls.some(([kind, value]) => kind === 'fetch' && value === '/member/config'));
  } finally { Object.assign(globalThis, original); }
});

test('configuration and roles fail closed on missing or unrecognized data', () => {
  assert.deepEqual(readMemberConfig(CONFIG), CONFIG);
  for (const value of [{}, { ...CONFIG, googleClientId: '' }, { ...CONFIG, logoutCookieName: 'bad; cookie' }]) assert.throws(() => readMemberConfig(value));
  assert.throws(() => readMemberProfile({ ...PROFILE, roles: ['administrator'] }));
  assert.throws(() => readMemberProfile({ ...PROFILE, roles: [] }));
  assert.throws(() => readMemberProfile({ ...PROFILE, roles: ['assigned_participant', 'assigned_participant'] }));
});

test('unsupported or denied shared locks fail closed before session restore or login', async () => {
  for (const withMarkerLock of [undefined, async () => { throw new Error('Lock access denied'); }]) {
    let requests = 0;
    const client = new MemberClient({ cookies: { read: () => '', write: () => {} }, withMarkerLock,
      fetchImpl: async () => { requests += 1; return response(CONFIG); } });
    await client.initialize();
    assert.equal(client.state.phase, 'unavailable');
    assert.equal(client.state.profile, null);
    assert.equal(await client.startLogin(), null);
    assert.equal(requests, 0);
    client.dispose();
  }
});

test('responder URLs allow only a canonical Google Forms viewform without query or fragment', () => {
  for (const value of ['https://docs.google.com/forms/d/abc_123/viewform', 'https://docs.google.com/forms/d/e/abc-123/viewform']) assert.equal(validatedFormUrl(value), value);
  for (const value of ['http://docs.google.com/forms/d/abc/viewform', 'https://docs.google.com.evil.invalid/forms/d/abc/viewform',
    'https://docs.google.com/forms/d/abc/edit', 'https://docs.google.com/forms/d/abc/formResponse', 'https://forms.gle/abc',
    'https://docs.google.com/forms/d/abc/viewform?entry.1=person', 'https://docs.google.com/forms/d/abc/viewform?authuser=0',
    'https://docs.google.com/forms/d/abc/viewform#x', 'https://docs.google.com/forms/d/abc/viewform?',
    'https://docs.google.com/forms/d/abc/viewform#', 'https://user@docs.google.com/forms/d/abc/viewform',
    'https://docs.google.com:8443/forms/d/abc/viewform', 'javascript:alert(1)', '/forms/d/abc/viewform']) assert.throws(() => validatedFormUrl(value), value);
});

test('source task list cannot add a client role, cross-person task, or unpermitted action', () => {
  assert.equal(readMemberTasks(LIST, PROFILE).tasks.length, 1);
  assert.throws(() => readMemberTasks({ ...LIST, profile: { ...PROFILE, personKey: 'another-person' } }, PROFILE));
  assert.throws(() => readMemberTasks({ ...LIST, tasks: [{ ...TASK, role: 'assigned_trainer' }] }, PROFILE));
  assert.throws(() => readMemberTasks({ ...LIST, tasks: [{ ...TASK, state: 'blocked' }] }, PROFILE));
  assert.throws(() => readMemberTasks({ ...LIST, tasks: [{ ...TASK, action: { id: 'open_trainer_form', label: 'Wrong action' } }] }, PROFILE));
  assert.throws(() => readMemberTasks({ ...LIST, tasks: [TASK, TASK] }, PROFILE));
});

test('canonical unscheduled CASE-P1-PLAN remains visible as blocked planning, with no action', async () => {
  const planning = { id: 'assigned_participant:CASE-P1-PLAN:', role: 'assigned_participant', caseId: 'CASE-P1-PLAN',
    sessionId: '', requestId: 'REQ-PLAN', title: 'Sicher arbeiten', phase: 'planning', state: 'blocked', statusLabel: 'In Planung',
    reason: 'Der Termin wird durch Process & Quality geplant.', sourceMaterial: 'Arbeitsanweisung 1' };
  const h = setup({ handler: request => request.path === '/member/tasks' ? response({ ...LIST, tasks: [TASK, planning] }) : null });
  await h.client.initialize();
  assert.equal(h.client.state.phase, 'ready');
  assert.equal(h.client.state.tasks.find(task => task.caseId === 'CASE-P1-PLAN').state, 'blocked');
  const before = h.requests.length;
  await h.client.openTask(planning.id);
  assert.equal(h.requests.length, before);
  assert.throws(() => readMemberTasks({ ...LIST, tasks: [{ ...TASK, sessionId: '' }] }, PROFILE));
  assert.throws(() => readMemberTasks({ ...LIST, tasks: [{ ...planning, phase: 'theory' }] }, PROFILE));
  assert.throws(() => readMemberTasks({ ...LIST, tasks: [{ ...planning, action: TASK.action }] }, PROFILE));
  h.client.dispose();
});

test('restores an existing cookie session and loads only the server task projection', async () => {
  const h = setup();
  await h.client.initialize();
  assert.equal(h.client.state.phase, 'ready');
  assert.deepEqual(h.client.state.profile, PROFILE);
  assert.deepEqual(h.requests.map(request => request.path), ['/member/config', '/member/session', '/member/tasks']);
  assert.equal(h.writes.length, 0);
  h.client.dispose();
});

test('a first visit without a session stays signed out without requesting Google identity', async () => {
  const h = setup({ handler: request => request.path === '/member/session' ? response({}, 401) : null });
  await h.client.initialize();
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(h.client.state.error, '');
  assert.equal(h.client.state.profile, null);
  assert.deepEqual(h.requests.map(request => request.path), ['/member/config', '/member/session']);
});

test('explicit login uses the server nonce and sends a credential only to the session POST', async () => {
  const h = setup({ handler: request => request.path === '/member/session' && request.method === 'GET' ? response({}, 401) : null });
  await h.client.initialize();
  const flow = await h.client.startLogin();
  assert.equal(flow.nonce, 'synthetic-server-nonce');
  await h.client.acceptCredential('synthetic-credential-only', flow.epoch);
  assert.equal(h.client.state.phase, 'ready');
  assert.equal(h.client.state.credential, undefined);
  const posts = h.requests.filter(request => request.method === 'POST');
  assert.deepEqual(posts.map(request => request.path), ['/member/auth/challenge', '/member/session']);
  assert.deepEqual(posts[1].body, { credential: 'synthetic-credential-only' });
  assert.equal(h.writes.length, 0);
  h.client.dispose();
});

test('a cancelled login ignores a later Google callback without sending its credential', async () => {
  const h = setup({ handler: request => request.path === '/member/session' ? response({}, 401) : null });
  await h.client.initialize();
  const flow = await h.client.startLogin();
  h.client.cancelLogin();
  await h.client.acceptCredential('synthetic-late-credential', flow.epoch);
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(h.requests.filter(request => request.path === '/member/session' && request.method === 'POST').length, 0);
});

test('duplicate Google callbacks cannot start parallel session creation', async () => {
  const wait = deferred();
  const h = setup({ handler: request => request.path === '/member/session' ? request.method === 'GET' ? response({}, 401) : wait.promise : null });
  await h.client.initialize();
  const flow = await h.client.startLogin();
  const login = h.client.acceptCredential('synthetic-credential', flow.epoch);
  await h.client.acceptCredential('synthetic-duplicate', flow.epoch);
  wait.resolve(response(SESSION));
  await login;
  assert.equal(h.requests.filter(request => request.path === '/member/session' && request.method === 'POST').length, 1);
  h.client.dispose();
});

test('logout persists only a noncredential marker before its POST and erases private state immediately', async () => {
  const wait = deferred();
  const h = setup({ handler: request => {
    if (request.path === '/member/logout') {
      assert.equal(readCookie(h.cookie, CONFIG.logoutCookieName), `2.${UUID}`);
      assert.equal(h.client.state.profile, null);
      assert.deepEqual(h.client.state.tasks, []);
      return wait.promise;
    }
    return null;
  } });
  await h.client.initialize();
  const logout = h.client.logout();
  assert.equal(h.client.state.phase, 'logging_out');
  wait.resolve(response({ signedOut: true }));
  await logout;
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(h.cookie, '');
  assert.equal(h.announcements, 1);
  assert.deepEqual(h.notifications, [{ generation: 2, logoutId: UUID }]);
  assert.equal(h.writes[0], `${CONFIG.logoutCookieName}=2.${UUID}; Path=/; SameSite=Strict; Max-Age=86400; Secure`);
  assert.deepEqual(h.requests.at(-1).body, { generation: 2, logoutId: UUID });
});

test('a reload with pending logout retries it before restoring any session or loading tasks', async () => {
  const h = setup({ cookie: `${CONFIG.logoutCookieName}=2.${UUID}` });
  await h.client.initialize();
  assert.deepEqual(h.requests.map(request => request.path), ['/member/config', '/member/logout']);
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(h.cookie, '');
  assert.equal(h.announcements, 0);
});

test('failed logout survives reload and keeps login blocked until an exact retry succeeds', async () => {
  let fail = true;
  const h = setup({ cookie: `${CONFIG.logoutCookieName}=2.${UUID}`, handler: request => request.path === '/member/logout' && fail ? response({}, 503) : null });
  await h.client.initialize();
  assert.equal(h.client.state.phase, 'logout_pending');
  assert.match(h.cookie, new RegExp(UUID));
  assert.equal(await h.client.startLogin(), null);
  assert.equal(h.requests.some(request => request.path === '/member/auth/challenge'), false);
  fail = false;
  await h.client.retryLogout();
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(h.cookie, '');
});

test('logout confirms a different newer marker separately when an older response arrives', async () => {
  let replaced = false;
  const h = setup({ handler: (request, jar) => {
    if (request.path === '/member/logout' && !replaced) {
      replaced = true;
      jar.setCookie(`${CONFIG.logoutCookieName}=3.${UUID2}`);
    }
    return null;
  } });
  await h.client.initialize();
  await h.client.logout();
  assert.deepEqual(h.requests.at(-1).body, { generation: 3, logoutId: UUID2 });
  assert.equal(h.requests.filter(request => request.path === '/member/logout').length, 2);
  assert.equal(h.writes.filter(value => value.includes('Max-Age=0')).length, 1);
  assert.equal(h.cookie, '');
  assert.equal(h.client.state.phase, 'signed_out');
});

test('visibility and sibling retries coalesce without recreating a marker already cleared by a sibling', async () => {
  const wait = deferred();
  const h = setup({ handler: request => request.path === '/member/logout' ? wait.promise : null });
  await h.client.initialize();
  const logout = h.client.logout();
  await until(() => h.requests.some(request => request.path === '/member/logout'));
  h.cookie = '';
  const retry = h.client.retryLogout();
  const sibling = h.client.externalLogout({ generation: 2, logoutId: UUID });
  assert.equal(h.writes.length, 1);
  assert.equal(h.cookie, '');
  assert.equal(h.requests.filter(request => request.path === '/member/logout').length, 1);
  wait.resolve(response({ signedOut: true }));
  await Promise.all([logout, retry, sibling]);
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(h.cookie, '');
});

test('an old failed intent cannot be resurrected over a later generation during retry', async () => {
  const wait = deferred();
  let calls = 0;
  const h = setup({ handler: request => {
    if (request.path !== '/member/logout') return null;
    calls += 1;
    if (calls === 1) return response({}, 503);
    if (calls === 2) return wait.promise;
    assert.deepEqual(request.body, { generation: 3, logoutId: UUID2 });
    assert.equal(h.cookie, `${CONFIG.logoutCookieName}=3.${UUID2}`);
    return response({ signedOut: true });
  } });
  await h.client.initialize();
  await h.client.logout();
  assert.equal(h.client.state.phase, 'logout_pending');
  h.cookie = '';
  const retry = h.client.retryLogout();
  await until(() => calls === 2);
  assert.equal(h.cookie, '');
  assert.equal(h.writes.length, 1);
  h.cookie = `${CONFIG.logoutCookieName}=3.${UUID2}`;
  wait.resolve(response({ signedOut: true }));
  await retry;
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(calls, 3);
  assert.equal(h.writes.filter(value => !value.includes('Max-Age=0')).length, 1);
});

test('shared marker lock serializes a newer write queued during an older exact compare and clear', async () => {
  const markerLock = serializedMarkerLock();
  const sharedCookie = { value: '' };
  const olderResponse = deferred();
  const newerResponse = deferred();
  let newerConfirmed = false;
  let newerLogout;
  let interleave = false;
  const handler = request => {
    if (request.path !== '/member/logout') return null;
    return request.body.generation === 2 ? olderResponse.promise : newerResponse.promise;
  };
  const older = setup({ sharedCookie, markerLock, handler });
  const newer = setup({ sharedCookie, markerLock, handler, generation: 3, uuid: UUID2 });
  await older.client.initialize();
  await newer.client.initialize();
  sharedCookie.onWrite = (value, previous) => {
    assert.equal(markerLock.active(), 1, 'every marker mutation must hold the one shared lock');
    if (value.includes('Max-Age=0') && previous === `${CONFIG.logoutCookieName}=3.${UUID2}`)
      assert.equal(newerConfirmed, true, 'generation 3 marker must survive until generation 3 is confirmed');
  };
  const olderLogout = older.client.logout();
  await until(() => older.requests.some(request => request.path === '/member/logout'));
  sharedCookie.onRead = value => {
    if (!interleave || value !== `${CONFIG.logoutCookieName}=2.${UUID}`) return;
    interleave = false;
    assert.equal(markerLock.active(), 1);
    newerLogout = newer.client.logout();
  };
  interleave = true;
  olderResponse.resolve(response({ signedOut: true }));
  await until(() => newer.requests.some(request => request.path === '/member/logout'));
  assert.equal(sharedCookie.value, `${CONFIG.logoutCookieName}=3.${UUID2}`);
  assert.equal(newerConfirmed, false);
  assert.equal(older.client.state.profile, null);
  assert.equal(newer.client.state.profile, null);
  newerConfirmed = true;
  newerResponse.resolve(response({ signedOut: true }));
  await Promise.all([olderLogout, newerLogout]);
  assert.equal(sharedCookie.value, '');
  assert.equal(older.client.state.phase, 'signed_out');
  assert.equal(newer.client.state.phase, 'signed_out');
  older.client.dispose();
  newer.client.dispose();
});

test('a delayed older-generation broadcast cannot clear a newer verified session', async () => {
  const h = setup();
  await h.client.initialize();
  assert.equal(h.client.externalLogout({ generation: 1, logoutId: UUID }), false);
  assert.equal(h.client.externalLogout({ type: 'logout' }), false);
  assert.equal(h.client.state.phase, 'ready');
  assert.deepEqual(h.client.state.profile, PROFILE);
  assert.equal(h.requests.some(request => request.path === '/member/logout'), false);
  h.client.dispose();
});

test('a broadcast arriving after marker cleanup still suppresses an older pending login response', async () => {
  const wait = deferred();
  const h = setup({ handler: request => request.path === '/member/session' ? request.method === 'GET' ? response({}, 401) : wait.promise : null });
  await h.client.initialize();
  const flow = await h.client.startLogin();
  const login = h.client.acceptCredential('synthetic-old-pending-credential', flow.epoch);
  assert.equal(h.client.externalLogout({ generation: 2, logoutId: UUID }), false);
  wait.resolve(response(SESSION));
  await login;
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(h.client.state.profile, null);
  assert.equal(h.requests.some(request => request.path === '/member/tasks'), false);
});

test('a delayed older broadcast permits a pending login response from a later generation', async () => {
  const wait = deferred();
  const h = setup({ handler: request => request.path === '/member/session' ? request.method === 'GET' ? response({}, 401) : wait.promise : null });
  await h.client.initialize();
  const flow = await h.client.startLogin();
  const login = h.client.acceptCredential('synthetic-new-pending-credential', flow.epoch);
  assert.equal(h.client.externalLogout({ generation: 2, logoutId: UUID }), false);
  wait.resolve(response({ ...SESSION, generation: 3 }));
  await login;
  assert.equal(h.client.state.phase, 'ready');
  assert.equal(h.client.state.generation, 3);
  assert.deepEqual(h.client.state.profile, PROFILE);
  h.client.dispose();
});

test('a blocked marker write prevents a logout POST and removes all displayed private data', async () => {
  const h = setup({ rejectCookies: true });
  await h.client.initialize();
  await h.client.logout();
  assert.equal(h.client.state.phase, 'logout_pending');
  assert.equal(h.client.state.profile, null);
  assert.equal(h.requests.some(request => request.path === '/member/logout'), false);
  await h.client.startLogin();
  assert.equal(h.requests.some(request => request.path === '/member/auth/challenge'), false);
});

test('malformed pending cookies fail closed without restoring or clearing the marker', async () => {
  const h = setup({ cookie: `${CONFIG.logoutCookieName}=malformed` });
  await h.client.initialize();
  assert.equal(h.client.state.phase, 'logout_pending');
  assert.equal(h.cookie, `${CONFIG.logoutCookieName}=malformed`);
  assert.equal(h.requests.length, 1);
});

test('late task replies after logout cannot restore the previous identity or tasks', async () => {
  const wait = deferred();
  const h = setup({ handler: request => request.path === '/member/tasks' ? wait.promise : null });
  const restore = h.client.initialize();
  while (!h.requests.some(request => request.path === '/member/tasks')) await new Promise(resolve => setImmediate(resolve));
  await h.client.logout();
  wait.resolve(response(LIST));
  await restore;
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(h.client.state.profile, null);
  assert.deepEqual(h.client.state.tasks, []);
});

test('late login replies after a cross-tab logout cannot restore private state', async () => {
  const wait = deferred();
  const h = setup({ handler: request => request.path === '/member/session' ? request.method === 'GET' ? response({}, 401) : wait.promise : null });
  await h.client.initialize();
  const flow = await h.client.startLogin();
  const login = h.client.acceptCredential('synthetic-credential', flow.epoch);
  h.cookie = `${CONFIG.logoutCookieName}=2.${UUID}`;
  await h.client.externalLogout({ generation: 2, logoutId: UUID });
  wait.resolve(response(SESSION));
  await login;
  assert.equal(h.client.state.phase, 'signed_out');
  assert.equal(h.client.state.profile, null);
});

test('form handoff makes a fresh scoped POST and never claims completion from opening it', async () => {
  const h = setup();
  await h.client.initialize();
  await h.client.openTask(TASK.id);
  assert.deepEqual(h.requests.at(-1).body, { role: TASK.role, caseId: TASK.caseId, sessionId: TASK.sessionId, action: TASK.action.id });
  assert.equal(h.client.canOpenForm(TASK.id), true);
  h.client.formOpened();
  assert.equal(h.client.state.readyForm, null);
  assert.equal(h.client.state.tasks[0].state, 'ready');
  await h.client.openTask('tampered-id');
  assert.equal(h.requests.filter(request => request.path === '/member/tasks/open').length, 1);
  h.client.dispose();
});

test('unsafe server form links clear action data instead of creating a handoff', async () => {
  const h = setup({ handler: request => request.path === '/member/tasks/open' ? response({ url: 'https://docs.google.com/forms/d/id/edit', checkedAt: LIST.checkedAt }) : null });
  await h.client.initialize();
  await h.client.openTask(TASK.id);
  assert.equal(h.client.state.phase, 'error');
  assert.equal(h.client.state.readyForm, null);
  assert.deepEqual(h.client.state.tasks, []);
  h.client.dispose();
});

test('a current pending marker suppresses an action even before a visibility or channel event', async () => {
  const h = setup();
  await h.client.initialize();
  h.cookie = `${CONFIG.logoutCookieName}=2.${UUID}`;
  await h.client.openTask(TASK.id);
  assert.equal(h.client.state.phase, 'logout_pending');
  assert.equal(h.client.state.profile, null);
  assert.equal(h.requests.some(request => request.path === '/member/tasks/open'), false);
});

test('visibility suspension and expired handoffs remove active links; refreshed source can revoke a role', async () => {
  const dual = { ...PROFILE, roles: ['assigned_trainer', 'assigned_participant'] };
  let refreshed = false;
  const h = setup({ handler: request => {
    if (request.path === '/member/session') return response({ ...SESSION, profile: dual });
    if (request.path === '/member/tasks') return response({ ...LIST, profile: refreshed ? PROFILE : dual });
    return null;
  } });
  await h.client.initialize();
  assert.equal(h.client.state.profile.roles.length, 2);
  await h.client.openTask(TASK.id);
  h.advance(60001);
  assert.equal(h.client.canOpenForm(TASK.id), false);
  h.client.suspend();
  assert.equal(h.client.state.phase, 'suspended');
  assert.deepEqual(h.client.state.tasks, []);
  assert.equal(h.client.state.readyForm, null);
  refreshed = true;
  await h.client.restore();
  assert.deepEqual(h.client.state.profile.roles, ['assigned_participant']);
  h.client.dispose();
});

test('source outages hide previous tasks and absolute session expiry erases identity', async () => {
  let outage = false;
  const h = setup({ handler: request => request.path === '/member/tasks' && outage ? response({}, 503) : null });
  await h.client.initialize();
  outage = true;
  await h.client.restore();
  assert.equal(h.client.state.phase, 'error');
  assert.deepEqual(h.client.state.tasks, []);
  h.advance(3600001);
  for (const callback of [...h.timers.values()]) callback();
  assert.equal(h.client.state.phase, 'expired');
  assert.equal(h.client.state.profile, null);
  assert.deepEqual(h.client.state.tasks, []);
  h.client.dispose();
});

test('cookie utilities preserve the logout scope and reject unsafe values', () => {
  assert.equal(readCookie('other=x; cosanum_member_logout=2.value; last=y', 'cosanum_member_logout'), '2.value');
  assert.deepEqual(readLogoutIntent(`0.${UUID}`), { marker: `0.${UUID}`, generation: 0, logoutId: UUID });
  assert.equal(logoutCookie(CONFIG.logoutCookieName, `2.${UUID}`, false).includes('Secure'), false);
  assert.throws(() => logoutCookie('bad;name', `2.${UUID}`, true));
  assert.throws(() => readLogoutIntent(`9007199254740992.${UUID}`));
});
