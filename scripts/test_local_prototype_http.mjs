import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Script } from 'node:vm';
import { createPrototypeServer } from './local_prototype.mjs';

const owner = { role: 'owner', personKey: 'MATT' };
function stubRuntime() {
  const calls = [];
  const runtime = { identities: () => [{ ...owner, label: 'Demo Coordinator' }], calls };
  for (const method of ['catalogue', 'preview', 'saveRequest', 'snapshot', 'setClock', 'reset']) {
    runtime[method] = (...args) => { calls.push({ method, args }); return { accepted: method }; };
  }
  return runtime;
}
async function withServer(runtime, fn) {
  const server = createPrototypeServer({ runtime });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ server, origin }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
async function post(origin, body, overrides = {}) {
  return fetch(origin + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...overrides }, body: JSON.stringify(body) });
}
function raw(origin, { path = '/api', method = 'POST', headers = {}, body = '', chunks } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    if (chunks) { for (const chunk of chunks) req.write(chunk); req.end(); }
    else req.end(body);
  });
}

test('local shell has isolated assets, explicit synthetic identity and no repository file routes', async () => {
  const runtime = stubRuntime();
  await withServer(runtime, async ({ origin }) => {
    const response = await fetch(origin);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-inline|unsafe-eval/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(html, /\[DEMO\] · LOKALER PROTOTYP/);
    assert.match(html, /keine Anmeldung/);
    assert.doesNotMatch(html, /__CSP_NONCE__|<script[^>]+src=|<link[^>]+href=/);
    const script = html.match(/<script nonce="([^"]+)">([\s\S]+?)<\/script>/);
    assert.ok(script);
    assert.match(response.headers.get('content-security-policy'), new RegExp(`nonce-${script[1].replace(/[+]/g, '\\+')}`));
    new Script(script[2]);
    const boot = await (await fetch(origin + '/api/bootstrap')).json();
    assert.deepEqual(boot.identities, runtime.identities());
    for (const path of ['/scripts/prototype/runtime.mjs', '/data/local-prototype/state.json', '/%2e%2e/.clasp.json', '/api/bootstrap?extra=1', '/favicon.ico']) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
  });
});

test('RPC dispatch is explicit and preserves the actor and unchanged retry key', async () => {
  const runtime = stubRuntime();
  await withServer(runtime, async ({ origin }) => {
    const input = { actionId: randomUUID(), topicId: 'TC_R030', targetLevel: 1, personKeys: ['WOHNUNG'] };
    for (let i = 0; i < 2; i++) {
      const response = await post(origin, { method: 'saveRequest', actor: owner, input });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).result, { accepted: 'saveRequest' });
    }
    assert.deepEqual(runtime.calls, [{ method: 'saveRequest', args: [input, owner] }, { method: 'saveRequest', args: [input, owner] }]);
    for (const method of ['constructor', '__proto__', 'close', 'identities', 'saveDraftRequest_', 'unknown']) {
      assert.equal((await post(origin, { method, actor: owner })).status, 400, method);
    }
    for (const actor of [null, [], { role: 'owner' }, { ...owner, admin: true }]) {
      assert.equal((await post(origin, { method: 'snapshot', actor })).status, 400);
    }
    assert.equal((await post(origin, { method: 'snapshot', actor: owner, extra: true })).status, 400);
    assert.equal(runtime.calls.length, 2, 'rejected envelopes do not reach any runtime method');
  });
});

test('foreign pages, missing origins, rebound hosts and cross-site metadata cannot invoke runtime', async () => {
  const runtime = stubRuntime();
  await withServer(runtime, async ({ origin, server }) => {
    const body = JSON.stringify({ method: 'saveRequest', actor: owner, input: {} });
    for (const headers of [
      { Origin: 'https://evil.example' },
      { Origin: 'null' },
      { Origin: '' },
      { Host: `evil.example:${server.address().port}` },
      { Host: '127.0.0.1:1' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' }
    ]) assert.equal((await raw(origin, { headers, body })).status, 403, JSON.stringify(headers));
    const noOrigin = await fetch(origin + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(noOrigin.status, 403);
    const foreignRead = await fetch(origin + '/api/bootstrap', { headers: { Origin: 'https://evil.example' } });
    assert.equal(foreignRead.status, 403);
    assert.equal(runtime.calls.length, 0);
  });
});

test('content type, JSON parsing and both declared and streaming body limits fail closed', async () => {
  const runtime = stubRuntime();
  await withServer(runtime, async ({ origin }) => {
    const body = JSON.stringify({ method: 'snapshot', actor: owner });
    assert.equal((await raw(origin, { headers: { 'Content-Type': 'text/plain' }, body })).status, 415);
    assert.equal((await raw(origin, { headers: { 'Content-Encoding': 'gzip' }, body })).status, 415);
    assert.equal((await raw(origin, { body: '{' })).status, 400);
    assert.equal((await raw(origin, { body: 'null' })).status, 400);
    assert.equal((await raw(origin, { body: '[]' })).status, 400);
    assert.equal((await raw(origin, { headers: { 'Content-Length': '9000' }, body: 'x'.repeat(9000) })).status, 413);
    assert.equal((await raw(origin, { headers: { 'Transfer-Encoding': 'chunked' }, chunks: ['x'.repeat(5000), 'x'.repeat(5000)] })).status, 413);
    assert.equal(runtime.calls.length, 0);
    assert.equal((await post(origin, { method: 'snapshot', actor: owner })).status, 200, 'server remains healthy after malformed requests');
  });
});

test('actual canonical intake persists through HTTP and exposes only the selected participant cases', async () => {
  const { openPrototype } = await import('./prototype/runtime.mjs');
  const dataDir = mkdtempSync(join(tmpdir(), 'cosanum-local-http-'));
  let runtime;
  const input = { actionId: randomUUID(), topicId: 'TC_R030', targetLevel: 1, personKeys: ['WOHNUNG'], initialDeadline: { date: '2026-11-20', reference: 'Synthetic test request' } };
  try {
    runtime = openPrototype({ dataDir });
    await withServer(runtime, async ({ origin }) => {
      const saved = await post(origin, { method: 'saveRequest', actor: owner, input });
      assert.equal(saved.status, 200, await saved.clone().text());
      assert.equal((await saved.json()).result.reused, false);
      assert.equal((await (await post(origin, { method: 'saveRequest', actor: owner, input })).json()).result.reused, true);
      const own = (await (await post(origin, { method: 'snapshot', actor: { role: 'participant', personKey: 'WOHNUNG' } })).json()).result;
      const other = (await (await post(origin, { method: 'snapshot', actor: { role: 'participant', personKey: 'SUMNER' } })).json()).result;
      assert.equal(own.cases.length, 1);
      assert.equal(own.deadlines.length, 1);
      assert.equal(other.cases.length, 0);
      assert.equal(other.requests.length, 0);
      assert.equal((await post(origin, { method: 'saveRequest', actor: { role: 'participant', personKey: 'WOHNUNG' }, input: { ...input, actionId: randomUUID() } })).status, 400);
    });
    runtime.close();
    runtime = openPrototype({ dataDir });
    await withServer(runtime, async ({ origin }) => {
      const afterRestart = (await (await post(origin, { method: 'snapshot', actor: owner })).json()).result;
      assert.equal(afterRestart.requests.length, 1);
      assert.equal(afterRestart.cases.length, 1);
      assert.equal(afterRestart.deadlines.length, 1);
    });
  } finally { runtime?.close(); rmSync(dataDir, { recursive: true, force: true }); }
});
