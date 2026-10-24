import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewServer } from './local_preview.mjs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

test('adapter supplies synthetic read views and rejects writes and unknown calls', async () => {
  const code = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), 'local_preview_adapter.js'), 'utf8');
  const alert = { textContent: '', hidden: true };
  const context = {
    window: {},
    document: { getElementById: () => alert, addEventListener: () => {} },
    queueMicrotask
  };
  runInNewContext(code, context);
  const call = name => new Promise(resolve => {
    context.window.google.script.run.withSuccessHandler(value => resolve({ value }))
      .withFailureHandler(error => resolve({ error: error.message }))[name]();
  });
  const dashboard = await call('getAuditDashboard');
  assert.equal(dashboard.value.length, 3);
  assert.deepEqual(Array.from(dashboard.value.map(row => row.state)), ['complete', 'waiting', 'open']);
  assert.equal((await call('getIntakeData')).value.people.length, 4);
  const rsvp = (await call('refreshRsvpStatus')).value;
  const exceptionRows = rsvp.rows.filter(row => row.caseId.startsWith('SAMPLE-EXCEPTION-'));
  assert.equal(exceptionRows.length, 2);
  assert.equal(exceptionRows.filter(row => row.flag === 'declined').length, 1);
  assert.equal(exceptionRows.find(row => row.flag === 'declined').responseStatus, 'declined');
  assert.equal(rsvp.errors.length, 0);
  assert.match((await call('saveDraftRequest')).error, /blocked saveDraftRequest/);
  assert.match((await call('unknownRpc')).error, /blocked unknownRpc/);
  assert.match(alert.textContent, /blocked unknownRpc/);
  assert.equal(alert.hidden, false);
});

test('serves the real client with an offline adapter and no repository file routes', async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${origin}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /OFFLINE PREVIEW · SYNTHETIC DATA · READ ONLY/);
    assert.match(html, /Cosanum · Schulungsdemo/);
    assert.match(html, /getAuditDashboard/);
    assert.match(html, /Offline read-only preview blocked/);
    assert.match(page.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'nonce-/);
    assert.equal((html.match(/<script nonce=/g) || []).length, 2);
    for (const path of ['/apps-script/Index.html', '/scripts/local_preview_adapter.js', '/docs/private/INCREMENT_01_HANDOFF.md', '/%2e%2e/.clasp.json']) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 404, path);
      assert.equal(await response.text(), 'Not found');
    }
    assert.equal((await fetch(`${origin}/`, { method: 'POST' })).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
