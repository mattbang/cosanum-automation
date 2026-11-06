import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

test('member browser startup reports invalid and missing binaries and removes their temporary profiles', { timeout: 40_000 }, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'cosanum-member-startup-test-'));
  try {
    for (const [label, binary] of [['invalid', process.execPath], ['missing', join(temporaryRoot, 'missing-chrome')]]) {
      const evidence = join(temporaryRoot, `${label}-evidence`);
      let failure: Error & { code?: string | number; signal?: string | null; killed?: boolean; stderr?: string } | undefined;
      try {
        await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/member-browser-rehearsal.mjs'], {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          env: { ...process.env, TMPDIR: temporaryRoot, TMP: temporaryRoot, TEMP: temporaryRoot,
            COSANUM_CHROME_PATH: binary, COSANUM_MEMBER_BROWSER_EVIDENCE: evidence },
          timeout: 15_000,
        });
      } catch (error) { failure = error as typeof failure; }
      assert.ok(failure, `${label} Chrome binary must fail`);
      assert.equal(failure.killed, false, 'the harness must exit and close its local server without a timeout kill');
      assert.equal(failure.signal, null);
      assert.equal(failure.code, 1);
      const diagnostic = failure.stderr || '';
      assert.match(diagnostic, /Headless Chrome exited during startup \(exit=.*signal=.*spawn=.*profile=.*stderr=/);
      assert.doesNotMatch(diagnostic, /undefined == true|ERR_ASSERTION/);
      if (label === 'invalid') {
        assert.match(diagnostic, /exit=\d+/);
        assert.match(diagnostic, /bad option: --headless=new/);
      } else assert.match(diagnostic, /spawn=ENOENT:/);
      const profile = diagnostic.match(/profile=("(?:[^"\\]|\\.)*")/);
      assert.ok(profile, 'startup diagnostics must identify the temporary profile for cleanup verification');
      await assert.rejects(access(JSON.parse(profile[1])), { code: 'ENOENT' });
      assert.equal((await readdir(temporaryRoot)).some(name => name.startsWith('cosanum-members-chrome-')), false);
      await assert.rejects(access(join(evidence, 'report.json')), { code: 'ENOENT' });
    }
  } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
});

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
