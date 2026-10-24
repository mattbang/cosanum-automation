import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewServer, renderPreview } from './local_preview.mjs';
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
  const call = (name, ...args) => new Promise(resolve => {
    context.window.google.script.run.withSuccessHandler(value => resolve({ value }))
      .withFailureHandler(error => resolve({ error: error.message }))[name](...args);
  });
  const dashboard = await call('getAuditDashboard');
  assert.equal(dashboard.value.length, 3);
  assert.deepEqual(Array.from(dashboard.value.map(row => row.state)), ['complete', 'waiting', 'open']);
  const catalogue = (await call('getCatalogue')).value;
  assert.equal((await call('getIntakeData')).value.people.length, 4);
  assert.ok(catalogue.topics.every(topic => topic.theory && topic.theoryMinutes === 60 && (!topic.practice || topic.practiceMinutes === 180)));
  for (const request of dashboard.value) {
    const plan = (await call('getSavedPhasePlan', request.requestId)).value;
    const topic = catalogue.topics.find(row => row.id === request.topicId);
    assert.equal(plan.phases.length, request.plannedSessions);
    assert.equal(plan.phases[0].phase, 'theory');
    assert.equal(plan.phases[0].durationMinutes, 60);
    assert.equal(plan.phases.filter(row => row.eventId).length, request.bookedSessions);
    if (topic.practice) {
      assert.equal(plan.phases[1].phase, 'practice');
      assert.equal(plan.phases[1].durationMinutes, 180);
      assert.equal(plan.phases[1].theorySessionId, plan.phases[0].sessionId);
    }
    for (const person of request.cases) {
      assert.deepEqual(Array.from(person.phases.map(row => row.sessionId)), Array.from(plan.phases.map(row => row.sessionId)));
      assert.ok(person.phases.every(row => request.bookedSessions || !row.rsvp));
      if (person.state === 'complete') assert.ok(person.phases.every(row => row.rsvp === 'accepted' && row.trainerResponseId && row.acknowledgementResponseId));
    }
  }
  const rsvp = (await call('getOfflineRsvpPreview')).value;
  const exceptionRows = rsvp.rows.filter(row => row.caseId.startsWith('SAMPLE-EXCEPTION-'));
  assert.equal(exceptionRows.length, 2);
  assert.equal(exceptionRows.filter(row => row.flag === 'declined').length, 1);
  assert.equal(exceptionRows.find(row => row.flag === 'declined').responseStatus, 'declined');
  assert.equal(rsvp.errors.length, 0);
  assert.equal(rsvp.rows.filter(row => row.caseId.startsWith('SAMPLE-INDIVIDUAL-')).length, 0);
  assert.equal(rsvp.rows.filter(row => row.caseId.startsWith('SAMPLE-GROUP-')).length, 4);
  assert.match((await call('saveDraftRequest')).error, /blocked saveDraftRequest/);
  assert.match((await call('processVerifiedSkillUpdates')).error, /blocked processVerifiedSkillUpdates/);
  assert.match((await call('refreshRsvpStatus')).error, /blocked refreshRsvpStatus/);
  assert.match((await call('unknownRpc')).error, /blocked unknownRpc/);
  assert.match(alert.textContent, /blocked unknownRpc/);
  assert.equal(alert.hidden, false);
});

test('serves the real client with an offline adapter and no repository file routes', async () => {
  const source = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../apps-script/Index.html'), 'utf8');
  assert.match(source, /\.refreshRsvpStatus\(\)/);
  assert.doesNotMatch(source, /\.getOfflineRsvpPreview\(\)/);
  assert.throws(() => renderPreview('<body><script>.refreshRsvpStatus().refreshRsvpStatus()</script>', '', 'nonce'), /RSVP client call changed/);
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
    assert.match(html, /\.getOfflineRsvpPreview\(\)/);
    assert.doesNotMatch(html, /\.refreshRsvpStatus\(\)/);
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
