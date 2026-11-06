import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

test('member browser rehearsal: private role tasks, fresh Forms, cross-tab logout and reload recovery', { timeout: 60_000 }, async t => {
  const chrome = process.env.COSANUM_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try { await access(chrome); }
  catch { t.skip('Chrome unavailable; set COSANUM_CHROME_PATH to run the synthetic browser rehearsal'); return; }
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/member-browser-rehearsal.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, COSANUM_CHROME_PATH: chrome }, timeout: 55_000,
  });
  const report = JSON.parse(stdout.trim().split('\n').at(-1)!);
  assert.equal(report.evidence, 'local_synthetic_browser');
  assert.equal(report.externalGoogleCalls, false);
  assert.equal(report.realTrainingWrites, false);
  assert.equal(report.passed, 17);
  assert.ok(report.checks.includes('same-session-participants-isolated'));
  assert.ok(report.checks.includes('participant-direct-trainer-action-denied'));
  assert.ok(report.checks.includes('pending-logout-reload-retry'));
});
