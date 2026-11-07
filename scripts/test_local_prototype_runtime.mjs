import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openPrototype, INITIAL_CLOCK, RESET_CONFIRMATION } from './prototype/runtime.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cosanum-prototype-runtime-'));
const owner = { role: 'owner', personKey: 'MATT' };
const participant = { role: 'participant', personKey: 'WOHNUNG' };
const other = { role: 'participant', personKey: 'SUMNER' };
const trainer = { role: 'trainer', personKey: 'MATT' };
const input = { topicId: 'TC_R030', targetLevel: 1, personKeys: ['WOHNUNG'],
  actionId: '123e4567-e89b-42d3-a456-426614174000', initialDeadline: { date: '2026-11-13', reference: 'Synthetic test request' } };
let runtime;
try {
  runtime = openPrototype({ dataDir: directory });
  assert.equal(runtime.identities().length, 5);
  assert.equal(runtime.catalogue(owner).people.length, 4);
  assert.deepEqual(runtime.catalogue(participant).people.map(p => p.key), ['WOHNUNG']);
  assert.equal(runtime.snapshot(owner).clock, INITIAL_CLOCK);
  assert.equal(runtime.preview(input, owner).allAllowed, true);
  assert.equal(runtime.preview({ ...input, targetLevel: 2 }, owner).allAllowed, false, 'canonical no-skipped-level gate');
  assert.equal(runtime.preview({ ...input, topicId: 'TC_R052' }, owner).allAllowed, false, 'excluded activity stays blocked');
  assert.throws(() => runtime.saveRequest({ ...input, targetLevel: 2 }, owner), /gesperrt/);
  assert.throws(() => runtime.saveRequest({ ...input, initialDeadline: { ...input.initialDeadline, date: '2026-02-30' } }, owner), /Frist/);
  assert.equal(runtime.snapshot(owner).requests.length, 0, 'failed command is transactional');
  const first = runtime.saveRequest(input, owner);
  assert.equal(first.reused, false);
  assert.equal(runtime.saveRequest(input, owner).reused, true);
  assert.throws(() => runtime.saveRequest({ ...input, personKeys: ['SUMNER'] }, owner), /anderen Entwurf/);
  assert.throws(() => runtime.saveRequest({ ...input, initialDeadline: { ...input.initialDeadline, date: '2026-11-14' } }, owner), /anderen Änderung/);
  assert.equal(runtime.snapshot(owner).requests.length, 1);
  assert.equal(runtime.snapshot(owner).deadlines.length, 1);
  assert.equal(runtime.snapshot(owner).cases[0].deadline.state, 'upcoming');

  for (const actor of [participant, other, trainer, { role: 'owner', personKey: 'MARIE' }, { role: 'owner', personKey: 'UNKNOWN' }]) {
    assert.throws(() => runtime.saveRequest(input, actor), /not allowed/);
    assert.throws(() => runtime.preview(input, actor), /not allowed/);
    assert.throws(() => runtime.setClock(INITIAL_CLOCK, actor), /not allowed/);
    assert.throws(() => runtime.reset(RESET_CONFIRMATION, actor), /not allowed/);
  }
  assert.throws(() => runtime.snapshot({ role: 'participant', personKey: 'MATT' }), /not allowed/);
  assert.equal(runtime.snapshot(participant).cases.length, 1);
  assert.equal(runtime.snapshot(other).requests.length, 0);
  assert.equal(runtime.snapshot(trainer).requests.length, 0, 'unassigned trainer has no case access');
  const secondInput = { topicId: 'TC_R027', targetLevel: 1, personKeys: ['SUMNER'], actionId: '123e4567-e89b-42d3-a456-426614174001' };
  const second = runtime.saveRequest(secondInput, owner);
  const scoped = runtime.snapshot(participant);
  assert.equal(scoped.requests.length, 1);
  assert.equal(JSON.stringify(scoped).includes(second.requestId), false);
  assert.equal(JSON.stringify(scoped).includes('SUMNER'), false);
  assert.deepEqual(JSON.parse(scoped.deadlines[0].case_scope_json), [first.cases[0].caseId]);
  assert.deepEqual(scoped.cases[0].deadline.request.history[0].caseIds, [first.cases[0].caseId]);
  const disconnected = runtime.snapshot(owner); disconnected.requests.length = 0;
  assert.equal(runtime.snapshot(owner).requests.length, 2, 'read projections cannot mutate the store');

  runtime.setClock('2026-11-12T23:00:00Z', owner);
  assert.equal(runtime.snapshot(owner).cases[0].deadline.state, 'due_today', 'Europe/Zurich calendar day');
  runtime.setClock('2026-11-13T23:00:00Z', owner);
  assert.equal(runtime.snapshot(owner).cases[0].deadline.state, 'overdue');
  for (const clock of ['tomorrow', '2026-02-30T12:00:00Z', '2026-11-09', '', null]) assert.throws(() => runtime.setClock(clock, owner), /clock|Clock/);
  assert.equal(runtime.snapshot(owner).clock, '2026-11-13T23:00:00.000Z');
  assert.throws(() => openPrototype({ dataDir: directory }), /writer lock/);
  const external = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import {openPrototype} from "./scripts/prototype/runtime.mjs"; openPrototype({dataDir:process.argv[1]});', directory], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  assert.notEqual(external.status, 0);
  assert.match(external.stderr, /writer lock/);
  runtime.close();
  assert.throws(() => runtime.snapshot(owner), /closed/);
  runtime.close();
  runtime = openPrototype({ dataDir: directory });
  assert.equal(runtime.snapshot(owner).requests.length, 2);
  assert.equal(runtime.snapshot(owner).clock, '2026-11-13T23:00:00.000Z');
  assert.equal(runtime.saveRequest(input, owner).reused, true, 'restart/retry preserves existing action and deadline');
  assert.equal(runtime.snapshot(owner).deadlines.length, 1);
  assert.throws(() => runtime.reset('yes', owner), /exact confirmation/);
  assert.equal(runtime.snapshot(owner).requests.length, 2);
  runtime.reset(RESET_CONFIRMATION, owner);
  assert.equal(runtime.snapshot(owner).clock, INITIAL_CLOCK);
  assert.equal(runtime.snapshot(owner).requests.length, 0);
  runtime.close();

  const file = path.join(directory, 'prototype-state.json');
  const valid = fs.readFileSync(file, 'utf8');
  const corruptions = [() => '{broken', state => ({ ...state, schemaVersion: -1 }),
    state => ({ ...state, fixtureHash: 'wrong' }), state => ({ ...state, clock: '2026-02-30T12:00:00Z' }),
    state => { state.tables.People[0][1] = 'unapproved@example.test'; return state; },
    state => { state.tables.Requests.push(['malformed']); return state; },
    state => { state.tables.Sessions.push(Array(15).fill('')); return state; }];
  for (const corrupt of corruptions) {
    const bad = corrupt(JSON.parse(valid));
    const bytes = typeof bad === 'string' ? bad : JSON.stringify(bad);
    fs.writeFileSync(file, bytes);
    assert.throws(() => openPrototype({ dataDir: directory }));
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'corrupt state is preserved, never silently reset');
    assert.equal(fs.existsSync(path.join(directory, '.prototype-writer.lock')), false, 'failed open releases its own lease');
  }
  fs.writeFileSync(file, valid);
  runtime = openPrototype({ dataDir: directory });
  assert.equal(runtime.snapshot(owner).requests.length, 0);
  runtime.close();
  const externalFile = path.join(directory, 'unrelated.txt');
  fs.writeFileSync(externalFile, 'preserve me');
  fs.unlinkSync(file); fs.symlinkSync(externalFile, file);
  assert.throws(() => openPrototype({ dataDir: directory }), /symbolic links/);
  assert.equal(fs.readFileSync(externalFile, 'utf8'), 'preserve me');
  console.log('PASS local prototype runtime: canonical intake/deadlines, transactional persistence, scoped reads, reset/clock, corruption and single-writer checks.');
} finally {
  runtime?.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
