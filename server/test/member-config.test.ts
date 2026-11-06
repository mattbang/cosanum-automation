import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { loadMemberConfig, validateMemberConfig } from '../src/members/config.ts';
import { MEMBER_GOOGLE_READ_SCOPES } from '../src/members/runtime.ts';

function approved() {
  return { version: 1, approved: true, origin: 'https://members.example.test',
    googleClientId: '123456-member-test.apps.googleusercontent.com', spreadsheetId: 'synthetic_workbook_not_a_live_id',
    members: [{ personKey: 'TRAINER', roles: ['assigned_trainer'], active: true },
      { personKey: 'PERSON', roles: ['assigned_participant', 'assigned_trainer'], active: false }] };
}

test('private member config requires explicit target, role grants and release approval', () => {
  assert.equal(validateMemberConfig(approved()).members.length, 2);
  for (const patch of [
    { approved: false }, { origin: 'http://members.example.test' }, { origin: 'https://members.example.test/' },
    { origin: 'https://user:pass@members.example.test' }, { googleClientId: 'not-a-web-client' },
    { spreadsheetId: 'https://sheets.example.test/another-target' }, { members: [] },
    { members: [{ personKey: 'TRAINER', roles: ['process_quality'], active: true }] },
    { members: [{ personKey: 'TRAINER', roles: ['assigned_trainer'] }] },
    { members: [approved().members[0], approved().members[0]] },
    { members: [ { ...approved().members[0], subject: 'same' }, { ...approved().members[1], subject: 'same' } ] },
  ]) assert.throws(() => validateMemberConfig({ ...approved(), ...patch }));
  assert.deepEqual([...MEMBER_GOOGLE_READ_SCOPES], [
    'https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/forms.body.readonly',
  ]);
});

test('member configuration remains outside source control and reload observes revoked grants', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cosanum-member-config-')), path = join(directory, 'members.json');
  try {
    await writeFile(path, JSON.stringify(approved()), { mode: 0o600 });
    assert.equal((await loadMemberConfig(path)).members[0].active, true);
    const changed = approved(); changed.members[0].active = false;
    await writeFile(path, JSON.stringify(changed));
    assert.equal((await loadMemberConfig(path)).members[0].active, false);
    await chmod(path, 0o644); await assert.rejects(loadMemberConfig(path), /owner-private/);
    await chmod(path, 0o400); assert.equal((await loadMemberConfig(path)).members[0].active, false);
    await assert.rejects(loadMemberConfig('members.json'), /absolute/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
