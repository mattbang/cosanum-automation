import { createHash } from 'node:crypto';
import { GoogleSheetMemberSource, type FormMetadata, type MemberRow, type MemberTableName, type MemberTables } from '../src/members/source.ts';
import { memberSchema, memberTableNames } from '../src/members/tasks.ts';
import type { MemberClaims, MemberGrant, MemberTask, MemberTaskRef } from '../src/members/types.ts';

export const NOW = '2026-11-06T12:00:00.000Z';
export const eventId = (id: string) => `cosanum${createHash('sha256').update(id).digest('hex')}`;
export function row(name: MemberTableName, values: MemberRow): MemberRow {
  return Object.assign(Object.fromEntries(memberSchema()[name].map(key => [key, ''])), { demo_marker: '[DEMO]' }, values);
}
export function claims(key: string): MemberClaims {
  const emails: Record<string, string> = { MATT: 'trainer1@gmail.com', T2: 'trainer2@gmail.com', P1: 'person1@gmail.com', P2: 'person2@gmail.com' };
  return { issuer: 'https://accounts.google.com', subject: `subject-${key}`, email: emails[key] ?? `${key}@gmail.com`, emailVerified: true };
}
export function ref(task: MemberTask): MemberTaskRef {
  return { role: task.role, caseId: task.caseId, sessionId: task.sessionId, action: task.action!.id };
}

export function fixture() {
  const tables = Object.fromEntries(memberTableNames.map(name => [name, []])) as unknown as MemberTables;
  tables.Topics.push(row('Topics', { topic_id: 'TOPIC-1', display_name: 'Sicher arbeiten', source_material: 'Arbeitsanweisung 1', theory_required: 'yes', practice_required: 'yes' }));
  for (const key of ['MATT', 'T2', 'P1', 'P2']) tables.People.push(row('People', {
    person_key: key, email: claims(key).email, display_alias: { MATT: 'Trainer Eins', T2: 'Trainer Zwei', P1: 'Person Eins', P2: 'Person Zwei' }[key]!, demo_role: 'Coach',
  }));
  for (const id of ['REQ-1', 'REQ-2', 'REQ-PLAN']) tables.Requests.push(row('Requests', { request_id: id, action_id: `action-${id}`, topic_id: 'TOPIC-1', target_level: '1', status: 'draft' }));
  tables.Sessions.push(row('Sessions', { session_id: 'SES-1', request_id: 'REQ-1', phase: 'theory', phase_order: '1', mode: 'group', trainer_key: 'MATT', status: 'invited',
    start_utc: '2026-11-05T08:00:00.000Z', end_utc: '2026-11-05T09:00:00.000Z', calendar_event_id: eventId('SES-1') }));
  tables.Sessions.push(row('Sessions', { session_id: 'SES-2', request_id: 'REQ-2', phase: 'theory', phase_order: '1', mode: 'individual', trainer_key: 'T2', status: 'invited',
    start_utc: '2026-11-05T10:00:00.000Z', end_utc: '2026-11-05T11:00:00.000Z', calendar_event_id: eventId('SES-2') }));
  for (const [caseId, personKey, requestId, sessionId] of [
    ['CASE-P1', 'P1', 'REQ-1', 'SES-1'], ['CASE-P2', 'P2', 'REQ-1', 'SES-1'], ['CASE-T2', 'T2', 'REQ-1', 'SES-1'],
    ['CASE-P2-SECOND', 'P2', 'REQ-2', 'SES-2'], ['CASE-P1-PLAN', 'P1', 'REQ-PLAN', ''],
  ]) {
    tables.ParticipantCases.push(row('ParticipantCases', { case_id: caseId, request_id: requestId, person_key: personKey, current_level: '0', target_level: '1', status: 'draft' }));
    if (!sessionId) continue;
    const trainer = tables.Sessions.find(s => s.session_id === sessionId)!.trainer_key as string;
    tables.SessionCases.push(row('SessionCases', { session_id: sessionId, case_id: caseId, request_id: requestId, person_key: personKey }));
    for (const kind of ['trainer', 'participant']) {
      const formId = `${kind}-${sessionId}-${caseId}`;
      const fields = { session_id: sessionId, case_id: caseId, person_key: personKey, form_id: formId,
        form_url: `https://docs.google.com/forms/d/e/published-${formId}/viewform`, verified_at: '2026-11-05T07:00:00.000Z', verified_by: 'forms-api:trainer1@gmail.com' };
      if (kind === 'trainer') tables.TrainerForms.push(row('TrainerForms', { ...fields, trainer_key: trainer, trainer_email: claims(trainer).email }));
      else tables.ParticipantForms.push(row('ParticipantForms', { ...fields, request_id: requestId, participant_email: claims(personKey).email }));
    }
  }
  const grants: MemberGrant[] = [
    { personKey: 'MATT', active: true, roles: ['assigned_trainer'] },
    { personKey: 'T2', active: true, roles: ['assigned_trainer', 'assigned_participant'] },
    { personKey: 'P1', active: true, roles: ['assigned_participant'] },
    { personKey: 'P2', active: true, roles: ['assigned_participant'] },
  ];
  const reads: string[] = [];
  const metadata = new Map<string, FormMetadata>([...tables.TrainerForms, ...tables.ParticipantForms].map(form => [String(form.form_id), {
    formId: String(form.form_id), responderUri: String(form.form_url), settings: { emailCollectionType: 'VERIFIED' },
  }]));
  const failures = new Set<string>();
  let sourceFailure = false, grantFailure = false;
  let clock = NOW;
  let tableReads = 0, grantReads = 0;
  const source = new GoogleSheetMemberSource({
    readTables: async () => { tableReads++; if (sourceFailure) throw new Error('private failure detail'); return tables; },
    grants: async () => { grantReads++; if (grantFailure) throw new Error('private grant detail'); return grants; },
    readForm: async formId => { reads.push(formId); if (failures.has(formId) || !metadata.has(formId)) throw new Error('private form detail'); return metadata.get(formId)!; },
    now: () => new Date(clock),
  });
  function trainerPass(caseId = 'CASE-P1', sessionId = 'SES-1') {
    const form = tables.TrainerForms.find(f => f.case_id === caseId && f.session_id === sessionId)!;
    const session = tables.Sessions.find(s => s.session_id === sessionId)!;
    tables.TrainerAssessments.push(row('TrainerAssessments', {
      response_id: `report-${sessionId}-${caseId}`, form_id: form.form_id, session_id: sessionId, case_id: caseId, person_key: form.person_key,
      reporter_email: form.trainer_email, submitted_at: new Date(Date.parse(String(session.end_utc)) + 60_000).toISOString(),
      attendance: 'attended', assessment: 'passed', attestation: 'yes', disposition: 'accepted',
    }));
  }
  function acknowledge(caseId = 'CASE-P1', sessionId = 'SES-1') {
    const form = tables.ParticipantForms.find(f => f.case_id === caseId && f.session_id === sessionId)!;
    const session = tables.Sessions.find(s => s.session_id === sessionId)!;
    tables.ParticipantAcknowledgements.push(row('ParticipantAcknowledgements', {
      response_id: `ack-${sessionId}-${caseId}`, form_id: form.form_id, request_id: form.request_id, session_id: sessionId, case_id: caseId, person_key: form.person_key,
      respondent_email: form.participant_email, submitted_at: new Date(Date.parse(String(session.end_utc)) + 120_000).toISOString(),
      typed_name: 'Person Test', affirmative: 'yes', disposition: 'accepted',
    }));
  }
  return { source, tables, grants, reads, metadata, failures, trainerPass, acknowledge,
    setClock: (value: string) => { clock = value; }, failSource: () => { sourceFailure = true; }, failGrants: () => { grantFailure = true; },
    counts: () => ({ tableReads, grantReads }),
  };
}
