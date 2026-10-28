#!/usr/bin/env node
/** Repeat the reviewed offline suites and save a private evaluation. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'data/demo_fixture.json');
const suites = [
  'test_alias_migration.mjs',
  'test_audit.mjs',
  'test_availability.mjs',
  'test_booking.mjs',
  'test_current_tasks.mjs',
  'test_demo_hub.mjs',
  'test_demo_replay.mjs',
  'test_demo_tour.mjs',
  'test_follow_up.mjs',
  'test_form_dispatch.mjs',
  'test_forms_identity.mjs',
  'test_individual_proof.mjs',
  'test_intake.mjs',
  'test_local_preview.mjs',
  'test_participant_acknowledgement.mjs',
  'test_phase_plan.mjs',
  'test_proof_metadata.mjs',
  'test_public_simulator.mjs',
  'test_rsvp.mjs',
  'test_skill_update.mjs',
  'test_trainer_assessment.mjs',
  'test_workflow_contract.mjs',
  'test_archive_proof.py',
  'test_connected_checker.py',
];
const timeoutMs = 60_000;
const maxBuffer = 1024 * 1024;

function usage() {
  return 'Usage: node scripts/run_local_tests.mjs [--repeat 1..20] [--list]\n' +
    'Runs only the reviewed offline suites. Reports go to ignored data/test-runs/.\n';
}

function parseArgs(args) {
  let repeat = 1;
  let list = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repeat' && i + 1 < args.length) {
      repeat = Number(args[++i]);
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error('--repeat must be an integer from 1 to 20.');
    } else if (args[i] === '--list') {
      list = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      process.stdout.write(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${args[i]}`);
    }
  }
  return { repeat, list };
}

function verifyInventory() {
  const found = fs.readdirSync(path.join(root, 'scripts'))
    .filter(name => /^test_.*\.(mjs|py)$/.test(name)).sort();
  const expected = [...suites].sort();
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    throw new Error(`Offline suite inventory changed. Review and update the allowlist in scripts/run_local_tests.mjs. Found: ${found.join(', ')}`);
  }
}

function fingerprint() {
  const files = [
    ...['apps-script', 'contracts', 'scripts', 'docs'].flatMap(dir =>
      fs.readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
        .filter(item => item.isFile()).map(item => path.relative(root, path.join(item.parentPath, item.name)))
        .filter(name => !name.includes('__pycache__') && !name.endsWith('.pyc'))),
    '.claspignore',
    'fixtures/offline_fixture.json',
    'data/demo_fixture.json',
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function run(command, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer,
    env: { ...process.env, CI: '1' },
  });
  return {
    ok: result.status === 0 && !result.error,
    exit_code: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    duration_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function evaluate(attempts, repeat) {
  return suites.map(name => {
    const results = attempts.filter(item => item.suite === name);
    const passed = results.filter(item => item.ok).length;
    return {
      suite: name,
      passed,
      total: repeat,
      result: passed === repeat ? 'stable_pass' : passed === 0 ? 'consistent_failure' : 'intermittent_failure',
      mean_duration_ms: Math.round(results.reduce((sum, item) => sum + item.duration_ms, 0) / repeat),
      max_duration_ms: Math.max(...results.map(item => item.duration_ms)),
    };
  });
}

function markdown(report) {
  const lines = [
    '# COS_C5 local test evaluation',
    '',
    `- Started: ${report.started_at_utc}`,
    `- Finished: ${report.finished_at_utc}`,
    `- Repetitions: ${report.repetitions}`,
    `- Overall: **${report.status}**`,
    `- Evidence: **local offline tests only**; connected Google acceptance is evaluated separately.`,
    `- Commit: ${report.git_commit || 'unavailable'}${report.tracked_changes ? ' (tracked changes present)' : ''}`,
    `- Input SHA-256: \`${report.input_sha256_before}\`${report.input_changed ? ' (changed during run)' : ''}`,
    '',
    '| Suite | Passes | Evaluation | Mean / max ms |',
    '| --- | ---: | --- | ---: |',
    ...report.evaluations.map(item => `| ${item.suite} | ${item.passed}/${item.total} | ${item.result} | ${item.mean_duration_ms} / ${item.max_duration_ms} |`),
  ];
  const failures = report.attempts.filter(item => !item.ok);
  if (failures.length) {
    lines.push('', '## Failed attempts', '');
    for (const item of failures) {
      const detail = [item.error, item.stderr, item.stdout].filter(Boolean).join('\n').trim();
      lines.push(`### Run ${item.run}: ${item.suite}`, '', '```text', detail.slice(-4000) || '(no output)', '```', '');
    }
  }
  if (report.input_changed) lines.push('', 'Input files changed during the run. Treat this evaluation as invalid and rerun.');
  return lines.join('\n') + '\n';
}

try {
  const { repeat, list } = parseArgs(process.argv.slice(2));
  verifyInventory();
  if (list) {
    process.stdout.write(suites.join('\n') + '\n');
    process.exit(0);
  }
  if (!fs.existsSync(fixturePath)) {
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(root, 'fixtures/offline_fixture.json'), fixturePath);
  }
  const startedAt = new Date().toISOString();
  const inputBefore = fingerprint();
  const commit = run('git', ['rev-parse', 'HEAD']);
  const changes = run('git', ['status', '--porcelain', '--untracked-files=no']);
  const attempts = [];
  for (let iteration = 1; iteration <= repeat; iteration++) {
    for (const suite of suites) {
      const args = suite.endsWith('.py')
        ? ['-m', 'unittest', `scripts/${suite}`]
        : [`scripts/${suite}`];
      const result = run(suite.endsWith('.py') ? 'python3' : process.execPath, args);
      attempts.push({ run: iteration, suite, ...result });
      process.stdout.write(`[${iteration}/${repeat}] ${suite}: ${result.ok ? 'PASS' : 'FAIL'} (${result.duration_ms} ms)\n`);
    }
  }
  const inputAfter = fingerprint();
  const evaluations = evaluate(attempts, repeat);
  const inputChanged = inputBefore !== inputAfter;
  const report = {
    schema_version: 1,
    evidence_level: 'local_offline',
    started_at_utc: startedAt,
    finished_at_utc: new Date().toISOString(),
    repetitions: repeat,
    status: !inputChanged && attempts.every(item => item.ok) ? 'pass' : 'fail',
    input_sha256_before: inputBefore,
    input_sha256_after: inputAfter,
    input_changed: inputChanged,
    git_commit: commit.ok ? commit.stdout.trim() : null,
    tracked_changes: changes.ok ? Boolean(changes.stdout.trim()) : null,
    node_version: process.version,
    attempts,
    evaluations,
  };
  const directory = path.join(root, 'data', 'test-runs', `${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'summary.md'), markdown(report), { mode: 0o600 });
  process.stdout.write(`Overall: ${report.status.toUpperCase()}\nReport: ${directory}\n`);
  process.exitCode = report.status === 'pass' ? 0 : 1;
} catch (error) {
  process.stderr.write(`Test runner: ${error.message}\n${usage()}`);
  process.exitCode = 2;
}
