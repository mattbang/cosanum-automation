import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MemberError, type MemberProfile, type MemberRole, type MemberTask } from './types.ts';

export const memberTableNames = [
  'Topics', 'People', 'Skills', 'Requests', 'ParticipantCases', 'Sessions', 'SessionCases',
  'SessionRsvps', 'TrainerForms', 'TrainerAssessments', 'ParticipantForms',
  'ParticipantAcknowledgements', 'Proofs', 'ArchiveReceipts', 'SkillUpdates', 'MessageLedger', 'FollowUps',
] as const;
export type MemberTableName = typeof memberTableNames[number];
export type MemberCell = string | number | boolean;
export type MemberRow = Record<string, MemberCell>;
export type MemberTables = { [K in MemberTableName]: MemberRow[] };
export type FormMetadata = {
  formId: string;
  responderUri?: string;
  settings?: { emailCollectionType?: string };
};
export type LiveForm = { metadata?: FormMetadata; unavailable?: boolean };
export type ProjectedTask = { task: MemberTask; url?: string; metadataUnavailable?: boolean };
type QueueRow = Record<string, string | boolean>;
type CanonicalContext = {
  session: MemberRow; link: MemberRow; personCase: MemberRow; request: MemberRow;
  topic: MemberRow; trainer: MemberRow; person: MemberRow; owner: MemberRow;
};
type Canonical = {
  DEMO_SCHEMA: { sheets: Record<MemberTableName, string[]> };
  readDemoTables_: () => MemberTables;
  formsEmailCollectionType_: (formId: string) => string;
  trainerCaseContext_: (tables: MemberTables, sessionId: string, caseId: string) => CanonicalContext;
  trainerAssessmentQueue_: () => QueueRow[];
  participantAcknowledgementQueue_: () => QueueRow[];
  participantAcknowledgementGate_: (tables: MemberTables, context: CanonicalContext) => { allowed: boolean; reason: string; releasedAt?: string };
};

const sourceFiles = ['Schema.gs', 'Booking.gs', 'FormsIdentity.gs', 'TrainerAssessment.gs', 'ParticipantAcknowledgement.gs'];
let canonicalSource: string[] | undefined;

/** The VM has no Sheets, Forms, Calendar, mail, network, token or writing service. */
function canonical(tables?: MemberTables, live = new Map<string, LiveForm>()): Canonical {
  try {
    canonicalSource ??= sourceFiles.map(name => readFileSync(new URL(`../../../apps-script/${name}`, import.meta.url), 'utf8'));
    const context = vm.createContext({
      Utilities: {
        DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
        computeDigest: (_algorithm: string, value: string) => Array.from(createHash('sha256').update(value, 'utf8').digest()),
      },
    }, { codeGeneration: { strings: false, wasm: false } });
    for (let i = 0; i < canonicalSource.length; i++) {
      vm.runInContext(canonicalSource[i], context, { filename: sourceFiles[i], timeout: 1000 });
    }
    const api = context as unknown as Canonical;
    api.readDemoTables_ = () => {
      if (!tables) throw new Error('Training records unavailable');
      return tables;
    };
    api.formsEmailCollectionType_ = formId => {
      const form = live.get(formId);
      if (!form?.metadata || form.unavailable) throw new Error('Live form verification unavailable');
      const rows = tables ? [...tables.TrainerForms, ...tables.ParticipantForms].filter(row => row.form_id === formId) : [];
      if (rows.length !== 1 || !validFormBinding(rows[0], form.metadata)) return '';
      return String(form.metadata.settings?.emailCollectionType ?? '');
    };
    return api;
  } catch {
    throw new MemberError(503, 'Die Schulungsregeln sind derzeit nicht verfügbar.');
  }
}

export function memberSchema(): Record<MemberTableName, string[]> {
  const sheets = canonical().DEMO_SCHEMA.sheets;
  if (Object.keys(sheets).length !== memberTableNames.length || memberTableNames.some(name => !Array.isArray(sheets[name]))) {
    throw new MemberError(503, 'Das Schulungsschema ist nicht kompatibel.');
  }
  return sheets;
}

export const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
export const email = (value: unknown): string => text(value).trim().toLowerCase();
export const validEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
export const validIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
function unavailable(): never { throw new MemberError(503, 'Die Schulungsdaten sind unvollständig oder widersprüchlich.'); }

/** A responder URL is only an exact live/saved binding; edit links and query redirects never qualify. */
export function validFormBinding(row: MemberRow, metadata: FormMetadata): boolean {
  if (!validIdentifier(row.form_id) || metadata.formId !== row.form_id ||
      typeof metadata.responderUri !== 'string' || metadata.responderUri !== row.form_url) return false;
  try {
    const url = new URL(metadata.responderUri);
    return url.protocol === 'https:' && url.hostname === 'docs.google.com' && !url.port &&
      !url.username && !url.password && !url.search && !url.hash &&
      /^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform$/.test(url.pathname) &&
      url.href === metadata.responderUri;
  } catch { return false; }
}

function unique(rows: MemberRow[], fields: string[], allowBlank = false): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const values = fields.map(field => text(row[field]));
    if (allowBlank && values.every(value => !value)) continue;
    if (values.some(value => !value)) unavailable();
    const key = JSON.stringify(values);
    if (seen.has(key)) unavailable();
    seen.add(key);
  }
}

function one(rows: MemberRow[], field: string, value: MemberCell): MemberRow {
  const found = rows.filter(row => row[field] === value);
  if (found.length !== 1) unavailable();
  return found[0];
}

function isoTimestamp(value: MemberCell): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
  return new Date(time).toISOString() === normalized;
}

/** Validate joins before a scope can be projected; never silently choose the first duplicate. */
export function validateMemberTables(value: unknown): MemberTables {
  if (!value || typeof value !== 'object') unavailable();
  const tables = structuredClone(value) as MemberTables;
  const schema = memberSchema();
  for (const name of memberTableNames) {
    if (!Array.isArray(tables[name])) unavailable();
    for (const row of tables[name]) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== schema[name].length ||
          schema[name].some(field => !Object.hasOwn(row, field) || !['string', 'number', 'boolean'].includes(typeof row[field])) ||
          row.demo_marker !== '[DEMO]') unavailable();
      for (const field of ['start_utc', 'end_utc', 'verified_at', 'submitted_at']) {
        if (Object.hasOwn(row, field) && row[field] !== '' && !isoTimestamp(row[field])) unavailable();
      }
    }
  }
  for (const [name, fields] of [
    ['Topics', ['topic_id']], ['People', ['person_key']], ['Skills', ['person_key', 'topic_id']],
    ['Requests', ['request_id']], ['ParticipantCases', ['case_id']], ['Sessions', ['session_id']],
    ['SessionCases', ['session_id', 'case_id']], ['SessionRsvps', ['session_id', 'case_id']],
    ['TrainerForms', ['session_id', 'case_id']], ['ParticipantForms', ['session_id', 'case_id']],
    ['TrainerAssessments', ['form_id', 'response_id']], ['ParticipantAcknowledgements', ['form_id', 'response_id']],
    ['Proofs', ['proof_id', 'proof_version']], ['ArchiveReceipts', ['proof_id', 'proof_version']],
    ['SkillUpdates', ['idempotency_key']], ['MessageLedger', ['send_key']], ['FollowUps', ['action_id']],
  ] as [MemberTableName, string[]][]) unique(tables[name], fields);
  unique(tables.Requests, ['action_id'], true);
  unique(tables.People.map(row => ({ ...row, normalizedEmail: email(row.email) })), ['normalizedEmail']);
  unique([...tables.TrainerForms, ...tables.ParticipantForms], ['form_id']);
  for (const person of tables.People) {
    if (!validIdentifier(person.person_key) || !validEmail(email(person.email)) || typeof person.display_alias !== 'string' || !person.display_alias.trim()) unavailable();
  }
  for (const request of tables.Requests) {
    if (!validIdentifier(request.request_id)) unavailable();
    one(tables.Topics, 'topic_id', request.topic_id);
  }
  for (const personCase of tables.ParticipantCases) {
    if (!validIdentifier(personCase.case_id)) unavailable();
    one(tables.Requests, 'request_id', personCase.request_id);
    one(tables.People, 'person_key', personCase.person_key);
  }
  for (const skill of tables.Skills) {
    one(tables.People, 'person_key', skill.person_key);
    one(tables.Topics, 'topic_id', skill.topic_id);
  }
  for (const session of tables.Sessions) {
    if (!validIdentifier(session.session_id) || !['theory', 'practice'].includes(text(session.phase)) ||
        !['planned', 'invited'].includes(text(session.status))) unavailable();
    one(tables.Requests, 'request_id', session.request_id);
    one(tables.People, 'person_key', session.trainer_key);
    if (session.phase === 'theory' && session.theory_session_id) unavailable();
    if (session.phase === 'practice') {
      const theory = one(tables.Sessions, 'session_id', session.theory_session_id);
      if (theory.phase !== 'theory' || theory.request_id !== session.request_id) unavailable();
    }
    if (session.status === 'invited' && (!isoTimestamp(session.start_utc) || !isoTimestamp(session.end_utc) ||
        Date.parse(text(session.end_utc)) <= Date.parse(text(session.start_utc)))) unavailable();
    if (!tables.SessionCases.some(link => link.session_id === session.session_id)) unavailable();
  }
  const phaseCases = new Set<string>();
  for (const link of tables.SessionCases) {
    const session = one(tables.Sessions, 'session_id', link.session_id);
    const personCase = one(tables.ParticipantCases, 'case_id', link.case_id);
    if (link.request_id !== session.request_id || link.request_id !== personCase.request_id || link.person_key !== personCase.person_key) unavailable();
    const phaseKey = JSON.stringify([link.case_id, session.phase]);
    if (phaseCases.has(phaseKey)) unavailable();
    phaseCases.add(phaseKey);
    if (session.phase === 'practice' && !tables.SessionCases.some(theoryLink =>
      theoryLink.session_id === session.theory_session_id && theoryLink.case_id === link.case_id && theoryLink.person_key === link.person_key)) unavailable();
  }
  for (const name of ['TrainerForms', 'ParticipantForms', 'TrainerAssessments', 'ParticipantAcknowledgements', 'SessionRsvps'] as const) {
    for (const row of tables[name]) {
      const session = one(tables.Sessions, 'session_id', row.session_id);
      const personCase = one(tables.ParticipantCases, 'case_id', row.case_id);
      if (!tables.SessionCases.some(link => link.session_id === row.session_id && link.case_id === row.case_id) ||
          row.person_key !== personCase.person_key || session.request_id !== personCase.request_id ||
          (Object.hasOwn(row, 'request_id') && row.request_id !== personCase.request_id)) unavailable();
      if (name === 'TrainerForms') {
        const trainer = one(tables.People, 'person_key', session.trainer_key);
        if (row.trainer_key !== trainer.person_key || email(row.trainer_email) !== email(trainer.email)) unavailable();
      } else if (name === 'ParticipantForms') {
        const person = one(tables.People, 'person_key', personCase.person_key);
        if (email(row.participant_email) !== email(person.email)) unavailable();
      } else if (name === 'TrainerAssessments' || name === 'ParticipantAcknowledgements') {
        const form = one(tables[name === 'TrainerAssessments' ? 'TrainerForms' : 'ParticipantForms'], 'form_id', row.form_id);
        if (form.session_id !== row.session_id || form.case_id !== row.case_id || form.person_key !== row.person_key) unavailable();
        if (row.disposition === 'accepted') {
          const actor = one(tables.People, 'person_key', name === 'TrainerAssessments' ? session.trainer_key : personCase.person_key);
          if (email(row[name === 'TrainerAssessments' ? 'reporter_email' : 'respondent_email']) !== email(actor.email)) unavailable();
          // Native handlers establish acceptance. Reject impossible ledger chronology before using that acceptance for navigation.
          if (!isoTimestamp(row.submitted_at) || !isoTimestamp(form.verified_at) || !isoTimestamp(session.end_utc) ||
              Date.parse(text(row.submitted_at)) < Math.max(Date.parse(text(form.verified_at)), Date.parse(text(session.end_utc)))) unavailable();
          if (name === 'ParticipantAcknowledgements') {
            const reports = tables.TrainerAssessments.filter(report => report.session_id === row.session_id && report.case_id === row.case_id && report.disposition === 'accepted');
            if (reports.length !== 1 || Date.parse(text(row.submitted_at)) < Date.parse(text(reports[0].submitted_at))) unavailable();
          }
        }
      }
    }
  }
  for (const name of ['TrainerAssessments', 'ParticipantAcknowledgements'] as const) {
    unique(tables[name].filter(row => row.disposition === 'accepted'), ['session_id', 'case_id']);
  }
  for (const name of memberTableNames) {
    for (const row of tables[name]) Object.freeze(row);
    Object.freeze(tables[name]);
  }
  return Object.freeze(tables);
}

function scopedLinks(tables: MemberTables, profile: MemberProfile): MemberRow[] {
  const roles = new Set(profile.roles);
  return tables.SessionCases.filter(link => {
    const session = one(tables.Sessions, 'session_id', link.session_id);
    return (roles.has('assigned_participant') && link.person_key === profile.personKey) ||
      (roles.has('assigned_trainer') && session.trainer_key === profile.personKey);
  });
}

/** Only member-assigned pairs and their same-case theory prerequisites cause live Form reads. */
export function scopedFormIds(tables: MemberTables, profile: MemberProfile): string[] {
  const pairs = new Set<string>();
  for (const link of scopedLinks(tables, profile)) {
    pairs.add(JSON.stringify([link.session_id, link.case_id]));
    const session = one(tables.Sessions, 'session_id', link.session_id);
    if (session.phase === 'practice') pairs.add(JSON.stringify([session.theory_session_id, link.case_id]));
  }
  return [...new Set([...tables.TrainerForms, ...tables.ParticipantForms]
    .filter(row => pairs.has(JSON.stringify([row.session_id, row.case_id])))
    .map(row => text(row.form_id)))];
}

function safeLabel(value: MemberCell): string {
  const label = text(value).replace(/[\r\n\t<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return label.slice(0, 400);
}

function baseTask(role: MemberRole, personCase: MemberRow, request: MemberRow, topic: MemberRow, session?: MemberRow): MemberTask {
  const task: MemberTask = {
    id: `${role}:${text(personCase.case_id)}:${text(session?.session_id)}`,
    role, caseId: text(personCase.case_id), sessionId: text(session?.session_id), requestId: text(request.request_id),
    title: safeLabel(topic.display_name), phase: session?.phase === 'theory' ? 'theory' : session?.phase === 'practice' ? 'practice' : 'planning',
    state: 'blocked', statusLabel: 'In Planung', reason: 'Der Termin wird durch Process & Quality geplant.',
  };
  if (session?.start_utc) task.startsAt = text(session.start_utc);
  if (session?.end_utc) task.endsAt = text(session.end_utc);
  if (topic.source_material) task.sourceMaterial = safeLabel(topic.source_material);
  return task;
}

export function projectMemberTasks(tables: MemberTables, profile: MemberProfile, live: Map<string, LiveForm>, now: Date): ProjectedTask[] {
  const api = canonical(tables, live);
  let trainerQueue: QueueRow[], participantQueue: QueueRow[];
  try {
    trainerQueue = api.trainerAssessmentQueue_();
    participantQueue = api.participantAcknowledgementQueue_();
  } catch { throw new MemberError(503, 'Die Schulungsaufgaben können derzeit nicht zuverlässig geprüft werden.'); }
  const projected: ProjectedTask[] = [];
  for (const role of profile.roles) {
    for (const personCase of tables.ParticipantCases) {
      const request = one(tables.Requests, 'request_id', personCase.request_id);
      const topic = one(tables.Topics, 'topic_id', request.topic_id);
      const links = tables.SessionCases.filter(link => link.case_id === personCase.case_id);
      if (role === 'assigned_participant' && personCase.person_key !== profile.personKey) continue;
      if (role === 'assigned_participant' && !links.length) {
        projected.push({ task: baseTask(role, personCase, request, topic) });
      }
      for (const link of links) {
        const session = one(tables.Sessions, 'session_id', link.session_id);
        if (role === 'assigned_trainer' && session.trainer_key !== profile.personKey) continue;
        const task = baseTask(role, personCase, request, topic, session);
        const counterpart = one(tables.People, 'person_key', role === 'assigned_trainer' ? personCase.person_key : session.trainer_key);
        task.counterpartName = safeLabel(counterpart.display_alias);
        const item: ProjectedTask = { task };
        projected.push(item);
        if (session.status !== 'invited') continue;
        const row = (role === 'assigned_trainer' ? trainerQueue : participantQueue)
          .find(row => row.sessionId === session.session_id && row.caseId === personCase.case_id);
        if (!row) unavailable();
        const neededIds = new Set<string>();
        for (const form of [...tables.TrainerForms, ...tables.ParticipantForms]) {
          if (form.case_id === personCase.case_id && (form.session_id === session.session_id ||
              (session.phase === 'practice' && form.session_id === session.theory_session_id && tables.TrainerForms.includes(form)))) {
            if (role === 'assigned_participant' || tables.TrainerForms.includes(form) && form.session_id === session.session_id) neededIds.add(text(form.form_id));
          }
        }
        item.metadataUnavailable = [...neededIds].some(id => live.get(id)?.unavailable || !live.get(id)?.metadata);
        if (item.metadataUnavailable) {
          task.statusLabel = 'Prüfung nicht verfügbar';
          task.reason = 'Die aktuelle Google-Formularprüfung ist nicht verfügbar. Bitte später erneut versuchen.';
          continue;
        }
        if (row.status === 'identity_blocked' || row.needsVerifiedReview) {
          task.statusLabel = 'Formular gesperrt';
          task.reason = 'Die verifizierte Google-Konto-Erfassung des Formulars muss durch Process & Quality geprüft werden.';
          continue;
        }
        if (now.getTime() < Date.parse(text(session.end_utc))) {
          task.statusLabel = 'Termin ausstehend'; task.reason = 'Das Formular wird nach dem Ende des Termins freigegeben.';
          continue;
        }
        if (row.submittedAt && Date.parse(String(row.submittedAt)) > now.getTime()) unavailable();
        const completed = role === 'assigned_trainer' ? !!row.responseId : row.status === 'acknowledged';
        if (completed) {
          task.state = 'complete'; task.statusLabel = role === 'assigned_trainer' ? 'Bericht erfasst' : 'Teilnahme bestätigt';
          task.reason = role === 'assigned_trainer' ? 'Ihr Trainerbericht für diesen Schulungsteil wurde erfasst.' : 'Ihre persönliche Teilnahmebestätigung wurde erfasst.';
          continue;
        }
        if (role === 'assigned_participant') {
          const context = api.trainerCaseContext_(tables, text(session.session_id), text(personCase.case_id));
          const gate = api.participantAcknowledgementGate_(tables, context);
          if (!gate.allowed || !gate.releasedAt || Date.parse(gate.releasedAt) > now.getTime()) {
            task.statusLabel = 'Trainerfreigabe ausstehend';
            task.reason = gate.reason || 'Die gültige Trainerfreigabe für diesen Schulungsteil steht noch aus.';
            continue;
          }
        }
        if (!row.formUrl) {
          task.statusLabel = 'Formular ausstehend'; task.reason = 'Das persönliche Formular muss durch Process & Quality bereitgestellt und geprüft werden.';
          continue;
        }
        task.state = 'ready'; task.statusLabel = 'Bereit';
        task.reason = role === 'assigned_trainer' ? 'Der Trainerbericht für diese Person kann eingereicht werden.' : 'Sie können Ihre eigene Teilnahme bestätigen.';
        task.action = { id: role === 'assigned_trainer' ? 'open_trainer_form' : 'open_participant_form',
          label: role === 'assigned_trainer' ? 'Trainerbericht öffnen' : 'Teilnahme bestätigen' };
        item.url = String(row.formUrl);
      }
    }
  }
  return projected.sort((a, b) => a.task.id.localeCompare(b.task.id));
}
