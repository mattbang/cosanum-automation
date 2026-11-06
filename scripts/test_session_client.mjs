import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('apps-script/Index.html', 'utf8');
const start = source.indexOf('function createAppRpcClient(');
const end = source.indexOf('\n(function initializeAccountShell()', start);
assert(start >= 0 && end > start, 'session RPC adapter is available to verify independently');
const context = vm.createContext({ Proxy, Array, String });
vm.runInContext(source.slice(start, end), context);

const requests = [], delivered = [], failures = [], sessionFailures = [];
const state = { token: 'test-only-token', epoch: 1, authorized: true };
function transport(success, failure) {
  return {
    withSuccessHandler: callback => transport(callback, failure),
    withFailureHandler: callback => transport(success, callback),
    dispatchAppRequest: payload => requests.push({ payload, success, failure })
  };
}
const client = context.createAppRpcClient(transport(), () => ({ ...state }), error => sessionFailures.push(error));
const userObject = { local: true };
client.withSuccessHandler((result, user) => delivered.push({ result, user }))
  .withFailureHandler(error => failures.push(error)).withUserObject(userObject)
  .saveDraftRequest({ topicId: 'SYNTHETIC', personKeys: ['PERSON-A'] });
assert.equal(requests.length, 1);
assert.equal(requests[0].payload.method, 'saveDraftRequest');
assert.equal(requests[0].payload.token, state.token);
assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload.args)), [{ topicId: 'SYNTHETIC', personKeys: ['PERSON-A'] }]);
assert.equal('userObject' in requests[0].payload, false, 'local callback context never goes to the server');
requests[0].success({ requestId: 'REQ-A' });
assert.equal(delivered.length, 1);
assert.equal(delivered[0].user, userObject);

client.withSuccessHandler(result => delivered.push(result)).getAuditDashboard();
state.epoch += 1;
requests[1].success({ privateCase: 'STALE' });
assert.equal(delivered.length, 1, 'a late reply cannot populate a replaced session');
state.token = ''; state.authorized = false;
client.withSuccessHandler(result => delivered.push(result)).getCatalogue();
assert.equal(requests.length, 2, 'a signed-out view cannot send a workflow request');
assert.equal(sessionFailures.length, 1);

state.token = 'new-test-only-token'; state.authorized = true;
client.withFailureHandler(error => failures.push(error)).getIntakeData();
requests[2].failure({ message: 'APP_SESSION_REQUIRED: expired' });
assert.equal(sessionFailures.length, 2, 'revocation returns to the shared signed-out flow');
assert.equal(failures.length, 0);
client.withFailureHandler(error => failures.push(error)).getRsvpStatus();
requests[3].failure({ message: 'Synthetic Calendar read failed' });
assert.equal(failures.length, 1, 'workflow errors remain visible in their own view');
client.withFailureHandler(error => failures.push(error)).getOwnerResourceOverview();
state.token = 'third-test-only-token';
requests[4].failure({ message: 'APP_ACCESS_DENIED' });
assert.equal(sessionFailures.length, 2, 'an old account response cannot sign out a newer account');
assert.equal(client.then, undefined);
console.log('Pass: authenticated RPC dispatch, no signed-out requests, local callback context, revocation, and stale-response suppression.');

// Run the actual account shell against a controllable synthetic service. Persisting
// the same tab store into a second shell instance models a reload during logout.
const SESSION_KEY = 'cosanum.training.session.v1';
const PENDING_KEY = 'cosanum.training.pending-logout.v1';
const BROWSER_KEY = 'cosanum.training.browser.v1';
const LOGOUT_KEY = 'cosanum.training.logout.v1';
const shellStart = source.indexOf('(function initializeAccountShell()');
const shellEnd = source.indexOf('\nfunction mountTrainingApp(', shellStart);
assert(shellStart > 0 && shellEnd > shellStart);
let uuidSequence = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`;
const flush = () => new Promise(resolve => setImmediate(resolve));
const service = {
  sequence: 0, generation: new Map(), completedLogouts: new Set(), sessions: new Map(),
  start(request) { if (request.method === 'beginAppSession') request.generation = this.generation.get(request.input.browserId) || 0; },
  issue(request) {
    const current = this.generation.get(request.input.browserId) || 0;
    if (current !== request.generation) throw new Error('APP_SESSION_REQUIRED: logout overtook login');
    const token = `synthetic-account-token-${++this.sequence}`;
    this.sessions.set(token, { browserId: request.input.browserId, generation: current });
    return { token, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      profile: { displayName: 'Synthetic Owner', email: 'owner@example.test', role: 'Process & Quality', initials: 'SO' },
      preferences: { density: 'comfortable', motion: 'system' } };
  },
  end(input) {
    const key = input.browserId + ':' + input.logoutId;
    if (!this.completedLogouts.has(key)) {
      this.completedLogouts.add(key);
      this.generation.set(input.browserId, (this.generation.get(input.browserId) || 0) + 1);
      for (const [token, item] of this.sessions) if (item.browserId === input.browserId) this.sessions.delete(token);
    }
    return { signedOut: true };
  }
};
function shell(tabStore, browserStore) {
  const requests = [], events = {}, storageWrites = [], nodes = new Map();
  let mounted = 0, disposed = 0;
  const document = { documentElement: { dataset: {} }, visibilityState: 'visible', activeElement: null,
    addEventListener() {}, getElementById: id => node(id) };
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const value = { id, hidden: false, disabled: false, inert: false, open: false, textContent: '', value: '',
      dataset: {}, children: [], isConnected: true, attributes: {}, listeners: {},
      addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); },
      emit(name, event = {}) { for (const callback of this.listeners[name] || []) callback({ target: this, preventDefault() {}, ...event }); },
      setAttribute(name, content) { this.attributes[name] = content; },
      querySelectorAll() { return [node('openProfile'), node('logoutButton')]; },
      contains(target) { return target === this; }, focus() { document.activeElement = this; },
      replaceChildren(...values) { this.children = values; },
      close() { this.open = false; this.emit('close'); }, showModal() { this.open = true; },
      content: { cloneNode() { return {}; } } };
    nodes.set(id, value); return value;
  }
  function storage(map, kind) {
    return { getItem: key => map.get(key) ?? null,
      setItem(key, value) { map.set(key, String(value)); storageWrites.push({ operation: 'set', kind, key }); },
      removeItem(key) { map.delete(key); storageWrites.push({ operation: 'remove', kind, key }); } };
  }
  function native(success, failure) {
    return new Proxy({}, { get(_, method) {
      if (method === 'withSuccessHandler') return callback => native(callback, failure);
      if (method === 'withFailureHandler') return callback => native(success, callback);
      return input => {
        const request = { method, input, succeed: result => success?.(result), fail: error => failure?.(error) };
        service.start(request); requests.push(request);
      };
    } });
  }
  const window = { google: { script: { run: native() } },
    addEventListener(name, callback) { (events[name] ||= []).push(callback); } };
  const shellContext = vm.createContext({ window, document, sessionStorage: storage(tabStore, 'tab'), localStorage: storage(browserStore, 'browser'),
    crypto: { randomUUID: uuid }, Date, Promise, Proxy, Array, String, Object, Number, JSON, RegExp,
    setTimeout() { return 1; }, clearTimeout() {}, createAppRpcClient: context.createAppRpcClient,
    mountTrainingApp() { mounted += 1; return () => { disposed += 1; }; } });
  vm.runInContext(source.slice(shellStart, shellEnd), shellContext);
  return { requests, node, storageWrites, tabStore, browserStore,
    storageEvent(value) { for (const handler of events.storage || []) handler({ key: LOGOUT_KEY, newValue: value }); },
    get mounted() { return mounted; }, get disposed() { return disposed; } };
}
function completeLogin(runtime) {
  const request = runtime.requests.at(-1); assert.equal(request.method, 'beginAppSession');
  const result = service.issue(request); request.succeed(result); return result;
}
function completeLogout(runtime) {
  const request = runtime.requests.at(-1); assert.equal(request.method, 'endAppSession');
  request.succeed(service.end(request.input)); return request;
}
const browserStore = new Map([[BROWSER_KEY, uuid()]]), tabStore = new Map();
const first = shell(tabStore, browserStore);
first.node('loginButton').emit('click'); completeLogin(first); await flush();
assert.equal(first.mounted, 1);
first.node('logoutButton').emit('click');
const originalIntent = JSON.parse(tabStore.get(PENDING_KEY));
const firstLogout = first.requests.at(-1);
assert.equal(firstLogout.method, 'endAppSession');
assert.equal(firstLogout.input.browserId, browserStore.get(BROWSER_KEY));
assert.equal(firstLogout.input.logoutId, originalIntent.logoutId);
assert.equal(firstLogout.input.token, originalIntent.token);
assert.equal(tabStore.has(SESSION_KEY), false);
const pendingWrite = first.storageWrites.findLastIndex(item => item.key === PENDING_KEY && item.operation === 'set');
const tokenRemoval = first.storageWrites.findLastIndex(item => item.key === SESSION_KEY && item.operation === 'remove');
assert(pendingWrite < tokenRemoval, 'the logout intent is saved before the tab token is cleared');
assert.equal(first.node('trainingHost').children.length, 0);
firstLogout.fail(new Error('Synthetic connection failure')); await flush();
assert.equal(first.node('loginButton').disabled, true);
assert.equal(tabStore.has(PENDING_KEY), true, 'a failed revoke remains durable for retry');
assert.equal(first.node('logoutRetry').hidden, false);

const reloaded = shell(tabStore, browserStore);
assert.equal(reloaded.requests.length, 1);
assert.equal(reloaded.requests[0].method, 'endAppSession', 'reload resumes revocation before any restore or login');
assert.equal(reloaded.requests[0].input.logoutId, originalIntent.logoutId);
assert.equal(reloaded.node('loginButton').disabled, true);
completeLogout(reloaded); await flush();
assert.equal(tabStore.has(PENDING_KEY), false, 'only an acknowledged revoke clears the pending record');
assert.equal(reloaded.node('loginButton').disabled, false);
assert.equal(service.generation.get(originalIntent.browserId), 1);
reloaded.node('loginButton').emit('click'); const fresh = completeLogin(reloaded); await flush();
service.end(originalIntent);
assert.equal(service.generation.get(originalIntent.browserId), 1, 'a retried old logout cannot advance the generation again');
assert.equal(service.sessions.has(fresh.token), true, 'an acknowledged logout replay leaves a new explicit login valid');

const siblingStore = new Map(), sibling = shell(siblingStore, browserStore);
sibling.node('loginButton').emit('click');
const waitingBegin = sibling.requests.at(-1);
const lateResult = service.issue(waitingBegin); // Committed earlier; its reply is delayed.
reloaded.node('logoutButton').emit('click');
const siblingNotice = browserStore.get(LOGOUT_KEY), notice = JSON.parse(siblingNotice);
sibling.storageEvent(siblingNotice);
assert.equal(sibling.requests.at(-1).method, 'endAppSession');
assert.equal(sibling.requests.at(-1).input.logoutId, notice.logoutId, 'all tabs reuse the initiating logout ID');
assert.equal(JSON.parse(siblingStore.get(PENDING_KEY)).logoutId, notice.logoutId);
assert.equal(sibling.node('loginButton').disabled, true);
completeLogout(reloaded); completeLogout(sibling); await flush();
waitingBegin.succeed(lateResult); await flush();
assert.equal(sibling.mounted, 0, 'a delayed login reply cannot remount a canceled login');
assert.equal(sibling.requests.filter(request => request.method === 'endAppSession').length, 1,
  'late login cleanup never invents a second logout intent');
assert.equal(service.sessions.has(lateResult.token), false);
assert.equal(service.generation.get(notice.browserId), 2, 'the sibling acknowledgement is idempotent');
assert.equal(siblingStore.has(PENDING_KEY), false);
assert.equal(browserStore.get(LOGOUT_KEY).includes('synthetic-account-token-'), false, 'logout broadcasts never contain a credential');
assert.equal([...browserStore.values()].some(value => value.includes('synthetic-account-token-')), false);
console.log('Pass: pending logout persists across reload, retry IDs remain stable, sibling cancellation suppresses late login, and old intent replay preserves a fresh login.');
