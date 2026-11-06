import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GoogleSheetMemberSource, GoogleTrainingReader, type FormMetadata, type MemberCell, type MemberTables } from '../src/members/source.ts';
import { memberSchema, memberTableNames } from '../src/members/tasks.ts';
import { MemberError, type MemberTaskRef } from '../src/members/types.ts';
import { claims, eventId, fixture, NOW, ref, row } from './member-source-fixture.ts';

const status = (expected: number) => (error: unknown): boolean => error instanceof MemberError && error.status === expected;
const taskRef = (overrides: Partial<MemberTaskRef> = {}): MemberTaskRef => ({ role: 'assigned_participant', caseId: 'CASE-P1', sessionId: 'SES-1', action: 'open_participant_form', ...overrides });

test('member schema keeps its explicit training-table scope when the owner adds an unrelated deadline ledger', () => {
  const source = readFileSync(new URL('../../apps-script/Schema.gs', import.meta.url), 'utf8');
  const owner = vm.runInNewContext(`${source}\nDEMO_SCHEMA.sheets`, {}, { timeout: 1000 });
  assert.ok(Object.hasOwn(owner, 'DeadlineChanges'));
  const schema = memberSchema();
  assert.deepEqual(Object.keys(schema).sort(), [...memberTableNames].sort());
  assert.equal(Object.hasOwn(schema, 'DeadlineChanges'), false);
  for (const name of memberTableNames) assert.deepEqual(schema[name], Array.from(owner[name]));
});

test('private source separates two trainers and two participants sharing a session; dual roles stay assigned', async () => {
  const f = fixture();
  const trainer1 = await f.source.tasks(claims('MATT'));
  assert.deepEqual(trainer1.tasks.map(task => task.caseId).sort(), ['CASE-P1', 'CASE-P2', 'CASE-T2']);
  assert.ok(trainer1.tasks.every(task => task.role === 'assigned_trainer' && task.sessionId === 'SES-1' && task.state === 'ready'));
  assert.equal(trainer1.profile.displayName, 'Trainer Eins');
  assert.deepEqual(trainer1.profile.roles, ['assigned_trainer']);
  assert.ok(f.reads.every(id => id.includes('SES-1')));
  f.reads.length = 0;
  const first = await f.source.tasks(claims('P1'));
  assert.deepEqual(first.tasks.map(task => task.caseId).sort(), ['CASE-P1', 'CASE-P1-PLAN']);
  assert.ok(first.tasks.every(task => task.role === 'assigned_participant'));
  assert.ok(f.reads.every(id => id.endsWith('CASE-P1')));
  const planning = first.tasks.find(task => task.phase === 'planning')!;
  assert.equal(planning.state, 'blocked'); assert.equal(planning.sessionId, ''); assert.equal(planning.action, undefined);
  const second = await f.source.tasks(claims('P2'));
  assert.deepEqual(second.tasks.map(task => task.caseId).sort(), ['CASE-P2', 'CASE-P2-SECOND']);
  const dual = await f.source.tasks(claims('T2'));
  assert.deepEqual(dual.profile.roles, ['assigned_trainer', 'assigned_participant']);
  assert.deepEqual(dual.tasks.map(task => [task.role, task.caseId]).sort(), [
    ['assigned_participant', 'CASE-T2'], ['assigned_trainer', 'CASE-P2-SECOND'],
  ]);
  assert.equal(trainer1.checkedAt, NOW);
});

test('projection is minimal and hands off only through a fresh server action', async () => {
  const f = fixture();
  f.trainerPass();
  const tasks = await f.source.tasks(claims('P1'));
  const task = tasks.tasks.find(task => task.sessionId === 'SES-1')!;
  assert.equal(task.state, 'ready');
  assert.deepEqual(task.action, { id: 'open_participant_form', label: 'Teilnahme bestätigen' });
  const serialized = JSON.stringify(tasks);
  for (const secret of ['docs.google.com', '/edit', 'forms-api:', 'response_id', 'trainer_email', 'form_id', 'Person Zwei', 'CASE-P2']) assert.equal(serialized.includes(secret), false, secret);
  const before = f.counts();
  const opened = await f.source.open(claims('P1'), ref(task));
  assert.equal(opened.url, f.tables.ParticipantForms.find(form => form.case_id === 'CASE-P1')!.form_url);
  assert.equal(opened.checkedAt, NOW);
  assert.deepEqual(f.counts(), { tableReads: before.tableReads + 1, grantReads: before.grantReads + 1 });
});

test('participant waits for a trainer pass and the session end; trainer waits for session end', async () => {
  const f = fixture();
  assert.equal((await f.source.tasks(claims('P1'))).tasks.find(task => task.sessionId)!.state, 'blocked');
  await assert.rejects(f.source.open(claims('P1'), taskRef()), status(403));
  f.trainerPass();
  f.setClock('2026-11-05T08:30:00.000Z');
  const participant = (await f.source.tasks(claims('P1'))).tasks.find(task => task.sessionId)!;
  const trainer = (await f.source.tasks(claims('MATT'))).tasks.find(task => task.caseId === 'CASE-P2')!;
  assert.equal(participant.state, 'blocked'); assert.equal(trainer.state, 'blocked');
  await assert.rejects(f.source.open(claims('P1'), taskRef()), status(403));
  await assert.rejects(f.source.open(claims('MATT'), taskRef({ role: 'assigned_trainer', caseId: 'CASE-P2', action: 'open_trainer_form' })), status(403));
});

test('completed role work remains visible and cannot be opened again', async () => {
  const f = fixture(); f.trainerPass(); f.acknowledge();
  const trainer = (await f.source.tasks(claims('MATT'))).tasks.find(task => task.caseId === 'CASE-P1')!;
  const participant = (await f.source.tasks(claims('P1'))).tasks.find(task => task.sessionId)!;
  assert.equal(trainer.state, 'complete'); assert.equal(participant.state, 'complete');
  assert.equal(trainer.action, undefined); assert.equal(participant.action, undefined);
  await assert.rejects(f.source.open(claims('P1'), taskRef()), status(403));
});

test('unknown account, unverified claims, non-authoritative email, subject mismatch and revoked grants fail closed', async () => {
  const f = fixture();
  await assert.rejects(f.source.profile(claims('unknown')), status(403));
  await assert.rejects(f.source.profile({ ...claims('P1'), emailVerified: false } as never), status(401));
  await assert.rejects(f.source.profile({ ...claims('P1'), issuer: 'https://attacker.invalid' } as never), status(401));
  const person = f.tables.People.find(person => person.person_key === 'P1')!;
  person.email = 'person1@external.example';
  f.tables.ParticipantForms.find(form => form.case_id === 'CASE-P1')!.participant_email = person.email;
  const external = { ...claims('P1'), email: String(person.email) };
  await assert.rejects(f.source.profile(external), status(403));
  f.grants.find(grant => grant.personKey === 'P1')!.subject = external.subject;
  assert.equal((await f.source.profile(external)).personKey, 'P1');
  await assert.rejects(f.source.profile({ ...external, subject: 'wrong-subject' }), status(403));
  f.grants.find(grant => grant.personKey === 'P1')!.active = false;
  await assert.rejects(f.source.profile(external), status(403));
  await assert.rejects(f.source.open(external, taskRef()), status(403));
});

test('Workspace authoritative exact domain works; lookalike emails and forged hosted domain do not select another People row', async () => {
  const f = fixture();
  f.tables.People.find(person => person.person_key === 'P1')!.email = 'Person1@work.example';
  f.tables.ParticipantForms.find(form => form.case_id === 'CASE-P1')!.participant_email = 'person1@work.example';
  assert.equal((await f.source.profile({ ...claims('P1'), email: 'person1@work.example', hostedDomain: 'work.example' })).personKey, 'P1');
  await assert.rejects(f.source.profile({ ...claims('P1'), email: 'person1@work.example', hostedDomain: 'other.example' }), status(403));
  await assert.rejects(f.source.profile({ ...claims('P1'), email: 'person.1@gmail.com' }), status(403));
  await assert.rejects(f.source.profile({ ...claims('P1'), email: 'person1+alias@gmail.com' }), status(403));
});

test('all handoff role, case, session and action IDs are checked against fresh assignment', async () => {
  const f = fixture(); f.trainerPass();
  await assert.rejects(f.source.open(claims('P1'), taskRef({ caseId: 'CASE-P2' })), status(403));
  await assert.rejects(f.source.open(claims('P1'), taskRef({ sessionId: 'SES-2' })), status(403));
  await assert.rejects(f.source.open(claims('P1'), taskRef({ caseId: '../CASE-P1' })), status(403));
  await assert.rejects(f.source.open(claims('P1'), taskRef({ role: 'assigned_trainer', action: 'open_trainer_form' })), status(403));
  await assert.rejects(f.source.open(claims('P1'), taskRef({ action: 'open_trainer_form' })), status(403));
  const before = (await f.source.tasks(claims('MATT'))).tasks.find(task => task.caseId === 'CASE-P2')!;
  f.tables.Sessions[0].trainer_key = 'T2'; f.tables.Sessions[0].mode = 'individual';
  for (const form of f.tables.TrainerForms.filter(form => form.session_id === 'SES-1')) { form.trainer_key = 'T2'; form.trainer_email = claims('T2').email; }
  f.tables.TrainerAssessments[0].reporter_email = claims('T2').email;
  assert.equal((await f.source.tasks(claims('MATT'))).tasks.length, 0);
  await assert.rejects(f.source.open(claims('MATT'), ref(before)), status(403));
  f.grants.find(grant => grant.personKey === 'P1')!.roles = ['assigned_trainer'];
  await assert.rejects(f.source.open(claims('P1'), taskRef()), status(403));
});

test('live metadata downgrade, wrong form ID and mismatched/unpublished URLs block actions', async () => {
  for (const corrupt of [
    (metadata: FormMetadata) => { metadata.settings!.emailCollectionType = 'RESPONDER_INPUT'; },
    (metadata: FormMetadata) => { metadata.formId = 'OTHER-FORM'; },
    (metadata: FormMetadata) => { metadata.responderUri = 'https://docs.google.com/forms/d/e/OTHER/viewform'; },
    (metadata: FormMetadata) => { metadata.responderUri = metadata.responderUri!.replace('/viewform', '/edit'); },
    (metadata: FormMetadata) => { metadata.responderUri += '?entry.123=spoof'; },
    (metadata: FormMetadata) => { metadata.responderUri = metadata.responderUri!.replace('docs.google.com', 'docs.google.com.attacker.invalid'); },
  ]) {
    const f = fixture(); f.trainerPass();
    const form = f.tables.ParticipantForms.find(form => form.case_id === 'CASE-P1')!;
    corrupt(f.metadata.get(String(form.form_id))!);
    assert.equal((await f.source.tasks(claims('P1'))).tasks.find(task => task.sessionId)!.state, 'blocked');
    await assert.rejects(f.source.open(claims('P1'), taskRef()), status(403));
  }
});

test('unavailable/missing metadata is visible and handoff fails as 503; unrelated forms are never fetched', async () => {
  const f = fixture(); f.trainerPass();
  const form = f.tables.TrainerForms.find(form => form.case_id === 'CASE-P1')!;
  f.failures.add(String(form.form_id));
  const task = (await f.source.tasks(claims('P1'))).tasks.find(task => task.sessionId)!;
  assert.equal(task.state, 'blocked'); assert.match(task.reason, /nicht verfügbar/);
  await assert.rejects(f.source.open(claims('P1'), taskRef()), status(503));
  assert.ok(f.reads.every(id => id.endsWith('CASE-P1')));
  assert.equal(JSON.stringify(task).includes('private form detail'), false);
  f.failures.clear(); f.metadata.delete(String(form.form_id));
  await assert.rejects(f.source.open(claims('P1'), taskRef()), status(503));
});

test('saved edit, redirect, prefilled and wrong-host URLs never become links even if live metadata repeats them', async () => {
  for (const url of [
    'https://docs.google.com/forms/d/example/edit',
    'https://docs.google.com/forms/d/example/viewform?authuser=1',
    'https://docs.google.com/forms/d/example/viewform?entry.123=other-person',
    'https://docs.google.com/forms/d/example/viewform#redirect',
    'https://docs.google.com.attacker.invalid/forms/d/example/viewform',
    'javascript:alert(1)',
  ]) {
    const f = fixture(); f.trainerPass();
    const form = f.tables.ParticipantForms.find(form => form.case_id === 'CASE-P1')!;
    form.form_url = url; f.metadata.get(String(form.form_id))!.responderUri = url;
    const task = (await f.source.tasks(claims('P1'))).tasks.find(task => task.sessionId)!;
    assert.equal(task.state, 'blocked'); assert.equal(task.action, undefined);
    await assert.rejects(f.source.open(claims('P1'), taskRef()), status(403));
  }
});

test('ISO timestamp types and accepted ledger chronology fail closed', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.tables.Sessions[0].end_utc = 2026; },
    (f: ReturnType<typeof fixture>) => { f.tables.Sessions[0].end_utc = '06.11.2026 09:00'; },
    (f: ReturnType<typeof fixture>) => { f.tables.Sessions[0].end_utc = '2026-02-30T09:00:00Z'; },
    (f: ReturnType<typeof fixture>) => { f.trainerPass(); f.tables.TrainerAssessments[0].submitted_at = '2026-11-05T08:30:00Z'; },
    (f: ReturnType<typeof fixture>) => { f.trainerPass(); f.acknowledge(); f.tables.ParticipantAcknowledgements[0].submitted_at = '2026-11-05T09:00:30Z'; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.source.tasks(claims('P1')), status(503));
  }
});

test('practice acknowledgement uses canonical same-case theory pass and live theory identity gates', async () => {
  const f = fixture();
  const theory = f.tables.Sessions[0];
  const practice = row('Sessions', { ...theory, session_id: 'SES-PRACTICE', phase: 'practice', phase_order: '2', theory_session_id: 'SES-1', mode: 'individual',
    start_utc: '2026-11-05T13:00:00.000Z', end_utc: '2026-11-05T14:00:00.000Z', calendar_event_id: eventId('SES-PRACTICE') });
  f.tables.Sessions.push(practice);
  f.tables.SessionCases.push(row('SessionCases', { session_id: practice.session_id, case_id: 'CASE-P1', request_id: 'REQ-1', person_key: 'P1' }));
  for (const name of ['TrainerForms', 'ParticipantForms'] as const) {
    const original = f.tables[name].find(form => form.case_id === 'CASE-P1')!;
    const formId = `${name}-practice`;
    const form = row(name, { ...original, session_id: practice.session_id, form_id: formId, form_url: `https://docs.google.com/forms/d/${formId}/viewform` });
    f.tables[name].push(form);
    f.metadata.set(formId, { formId, responderUri: String(form.form_url), settings: { emailCollectionType: 'VERIFIED' } });
  }
  f.trainerPass('CASE-P1', 'SES-PRACTICE');
  const state = async () => (await f.source.tasks(claims('P1'))).tasks.find(task => task.sessionId === 'SES-PRACTICE')!.state;
  assert.equal(await state(), 'blocked');
  f.trainerPass(); assert.equal(await state(), 'ready');
  const theoryForm = f.tables.TrainerForms.find(form => form.case_id === 'CASE-P1' && form.session_id === 'SES-1')!;
  f.metadata.get(String(theoryForm.form_id))!.settings!.emailCollectionType = 'DO_NOT_COLLECT';
  assert.equal(await state(), 'blocked');
  await assert.rejects(f.source.open(claims('P1'), taskRef({ sessionId: 'SES-PRACTICE' })), status(403));
});

test('duplicate and corrupt source joins fail as 503 instead of selecting a first row', async () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    f => { f.tables.People.push({ ...f.tables.People[0] }); },
    f => { f.tables.People[2].email = f.tables.People[3].email; },
    f => { f.tables.Sessions.push({ ...f.tables.Sessions[0] }); },
    f => { f.tables.SessionCases.push({ ...f.tables.SessionCases[0] }); },
    f => { f.tables.SessionCases[0].person_key = 'P2'; },
    f => { f.tables.SessionCases[0].request_id = 'REQ-2'; },
    f => { f.tables.SessionCases[0].session_id = 'missing'; },
    f => { f.tables.ParticipantForms[0].participant_email = claims('P2').email; },
    f => { f.tables.TrainerForms[0].trainer_key = 'T2'; },
    f => { f.tables.TrainerForms[1].form_id = f.tables.TrainerForms[0].form_id; },
    f => { f.trainerPass(); f.tables.TrainerAssessments[0].form_id = f.tables.TrainerForms[1].form_id; },
    f => { f.trainerPass(); f.tables.TrainerAssessments.push({ ...f.tables.TrainerAssessments[0], response_id: 'duplicate-accepted' }); },
    f => { f.tables.ParticipantCases[0].demo_marker = '[OTHER]'; },
    f => { delete f.tables.People[0].email; },
    f => { f.grants.push({ ...f.grants[0] }); },
    f => { f.grants[0].roles.push('administrator' as never); },
    f => { f.grants[0].personKey = 'unknown'; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.source.tasks(claims('P1')), status(503));
    assert.equal(f.reads.length, 0);
  }
});

test('source/grant outages do not fall back to old records and returned errors omit private failure detail', async () => {
  for (const failure of ['source', 'grants']) {
    const f = fixture(); await f.source.tasks(claims('P1'));
    if (failure === 'source') f.failSource(); else f.failGrants();
    await assert.rejects(f.source.tasks(claims('P1')), error => status(503)(error) && !(error as Error).message.includes('private'));
    await assert.rejects(f.source.open(claims('P1'), taskRef()), status(503));
  }
});

test('source does not mutate records, grants or metadata and no Google writing service is needed', async () => {
  const f = fixture(); f.trainerPass();
  const before = JSON.stringify([f.tables, f.grants, [...f.metadata]]);
  await f.source.profile(claims('P1')); await f.source.tasks(claims('MATT')); await f.source.tasks(claims('P1')); await f.source.open(claims('P1'), taskRef());
  assert.equal(JSON.stringify([f.tables, f.grants, [...f.metadata]]), before);
});

function batch(tables: MemberTables) {
  const schema = memberSchema();
  return { spreadsheetId: 'synthetic-workbook', valueRanges: memberTableNames.map(name => ({
    range: `'${name}'!A1:Z100`, values: [schema[name], ...tables[name].map(row => schema[name].map(header => row[header]))] as MemberCell[][],
  })) };
}

test('Google reader issues only exact workbook and scoped Form GET requests with existing schema headers', async () => {
  const f = fixture(); const urls: string[] = [];
  const reader = new GoogleTrainingReader({ get: async <T>(url: string): Promise<T> => {
    urls.push(url);
    return (url.includes('sheets.googleapis.com') ? batch(f.tables) : { formId: 'safe-form', responderUri: 'https://docs.google.com/forms/d/safe-form/viewform', settings: { emailCollectionType: 'VERIFIED' } }) as T;
  } }, 'synthetic-workbook');
  assert.equal((await reader.readTables()).People.length, 4);
  assert.equal((await reader.readForm('safe-form')).settings!.emailCollectionType, 'VERIFIED');
  assert.equal(urls.length, 2);
  const query = new URL(urls[0]);
  assert.equal(query.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
  assert.deepEqual(query.searchParams.getAll('ranges'), memberTableNames.map(name => `'${name}'`));
  assert.match(urls[1], /^https:\/\/forms.googleapis.com\/v1\/forms\/safe-form\?/);
  await assert.rejects(reader.readForm('form/../../other'), status(503));
  assert.equal(urls.length, 2);
});

test('Google reader rejects changed headers, missing/duplicate tabs, wrong workbook, orphan rows and wrong form metadata', async () => {
  const f = fixture();
  for (const mutation of [
    (data: ReturnType<typeof batch>) => { data.spreadsheetId = 'wrong-workbook'; },
    (data: ReturnType<typeof batch>) => { data.valueRanges.pop(); },
    (data: ReturnType<typeof batch>) => { data.valueRanges[1].range = data.valueRanges[0].range; },
    (data: ReturnType<typeof batch>) => { data.valueRanges[0].values[0] = [...data.valueRanges[0].values[0]].reverse(); },
    (data: ReturnType<typeof batch>) => { data.valueRanges[0].values[0].push('extra_header'); },
    (data: ReturnType<typeof batch>) => { data.valueRanges[0].values[0].pop(); },
    (data: ReturnType<typeof batch>) => { data.valueRanges[0].values[0][0] = 123; },
    (data: ReturnType<typeof batch>) => { data.valueRanges[0].values.push(['', 'orphan']); },
  ]) {
    const data = structuredClone(batch(f.tables)); mutation(data);
    const reader = new GoogleTrainingReader({ get: async <T>() => data as T }, 'synthetic-workbook');
    await assert.rejects(reader.readTables(), status(503));
  }
  const reader = new GoogleTrainingReader({ get: async <T>() => ({ formId: 'other-form' }) as T }, 'synthetic-workbook');
  await assert.rejects(reader.readForm('safe-form'), status(503));
  assert.throws(() => new GoogleTrainingReader({ get: async <T>() => ({} as T) }, '../workbook'), status(503));
});
