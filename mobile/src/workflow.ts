import workflow from '../../contracts/workflow.v1.json';
import taskContract from '../../contracts/current-task.v1.json';
import fixture from '../../fixtures/offline_fixture.json';

export type Role = 'process_quality' | 'assigned_trainer' | 'assigned_participant' | 'system';
export type CaseStatus = 'planning' | 'invited' | 'assessed' | 'acknowledged' | 'proof_ready' | 'archived_verified' | 'complete';
export type TrainingCase = {
  id: string; requestId: string; sessionId: string; personKey: string; personName: string;
  topicId: string; topicName: string; mode: 'group' | 'single'; trainerKey: string;
  originalLevel: number; targetLevel: number; status: CaseStatus;
  slotId?: string; eventId?: string; trainerPassed?: boolean; acknowledgement?: boolean;
  proofId?: string; proofVersion?: string; archiveReceipt?: string; skillApplied?: boolean;
  declined?: boolean; previousCaseId?: string; supersededByCaseId?: string;
};
export type Slot = { id: string; label: string; start: string; end: string; busy: string[] };
export type DemoState = { cases: TrainingCase[]; slots: Slot[]; nextId?: number };
export type ActionId = typeof workflow.actions[number]['id'];
export type CurrentTask = { action: string; state: 'suggested' | 'blocked' | 'complete'; reason: string; canExecute: false };

const demoTitles: Record<string, string> = { TC_R030: 'Wareneingang · Demo', TC_R052: 'Hochregallager · Demo' };
export const catalogue = fixture.Topics.map(row => ({ id: String(row[0]), name: demoTitles[String(row[0])] || `Demo-Schulungsmodul ${row[0]}`, material: 'Übungsmaterial', practiceIndividual: String(row[7]) === 'Praxis einzeln', fixedTarget: String(row[8]) === 'fixed' ? Number(row[10]) : undefined }));
const people = new Map(fixture.People.map(row => [String(row[0]), ({ WOHNUNG: 'Person A', SUMNER: 'Person B' } as Record<string, string>)[String(row[0])] || String(row[5])]));
const topics = new Map(catalogue.map(topic => [topic.id, topic]));
const levels = new Map(fixture.Skills.map(row => [`${row[0]}:${row[1]}`, row[2]]));
export const learners = fixture.People.filter(row => String(row[2]) === 'Mitarbeiter').map(row => ({ key: String(row[0]), name: people.get(String(row[0]))! }));

export function trainerChoices(topicId: string, mode: 'group' | 'single', participantCount: number): string[] {
  if (!topics.has(topicId) || participantCount < 1 || (mode === 'single' && participantCount !== 1)) return [];
  return ['MATT', 'MARIE'].filter(key => Number(levels.get(`${key}:${topicId}`)) === 4 && (mode === 'single' || participantCount === 1 || key === 'MATT'));
}

export function eligibility(topicId: string, personKey: string, targetLevel: number): { eligible: boolean; level: number | null; reason: string } {
  const topic = topics.get(topicId);
  const raw = levels.get(`${personKey}:${topicId}`);
  const level = typeof raw === 'number' && Number.isInteger(raw) ? raw : null;
  if (!topic || !learners.some(person => person.key === personKey)) return { eligible: false, level, reason: 'Thema oder Person unbekannt' };
  if (level === null) return { eligible: false, level, reason: 'Keine gültige Ausgangsstufe in der Demo-Matrix' };
  if (level === 4) return { eligible: false, level, reason: 'Bereits Trainerstufe 4' };
  if (level < 0 || level > 3) return { eligible: false, level, reason: 'Ungültige Ausgangsstufe' };
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 3 || (topic.fixedTarget && targetLevel !== topic.fixedTarget)) return { eligible: false, level, reason: 'Ungültige Zielstufe' };
  if (targetLevel !== level + 1) return { eligible: false, level, reason: `Nur der nächste Schritt nach Stufe ${level} ist zulässig` };
  return { eligible: true, level, reason: `Stufe ${level} → ${targetLevel}` };
}

function makeCase(id: string, requestId: string, sessionId: string, personKey: string, topicId: string, mode: 'group' | 'single'): TrainingCase {
  const topic = topics.get(topicId);
  const originalLevel = Number(levels.get(`${personKey}:${topicId}`));
  if (!topic || !Number.isInteger(originalLevel) || originalLevel < 0) throw new Error('Synthetic case has no valid starting level');
  return { id, requestId, sessionId, personKey, personName: people.get(personKey)!, topicId,
    topicName: topic.name, mode, trainerKey: mode === 'group' ? 'MATT' : 'MARIE', originalLevel,
    targetLevel: Math.min(originalLevel + 1, 3), status: 'planning' };
}

export function createRequest(state: DemoState, topicId: string, personKeys: string[], targetLevel: number, mode: 'group' | 'single' = 'group', trainerKey = 'MATT'): DemoState {
  const topic = topics.get(topicId);
  if (!topic || !personKeys.length || new Set(personKeys).size !== personKeys.length) throw new Error('Thema und eindeutige Personen wählen');
  if (mode === 'single' && personKeys.length !== 1) throw new Error('Einzeltraining erfordert genau eine Person');
  for (const key of personKeys) if (!eligibility(topicId, key, targetLevel).eligible) throw new Error(`${people.get(key) || key}: ${eligibility(topicId, key, targetLevel).reason}`);
  if (!trainerChoices(topicId, mode, personKeys.length).includes(trainerKey)) throw new Error('Trainer ist für diese Sitzung nicht qualifiziert');
  const n = state.nextId || 1;
  const requestId = `REQ-M-${n}`; const sessionId = `SES-M-${n}`;
  const cases = personKeys.map((key, index): TrainingCase => ({
    id: `CASE-M-${n}-${index + 1}`, requestId, sessionId, personKey: key, personName: people.get(key)!, topicId,
    topicName: topic.name, mode, trainerKey, originalLevel: eligibility(topicId, key, targetLevel).level!, targetLevel, status: 'planning',
  }));
  return { ...state, nextId: n + 1, cases: [...state.cases, ...cases] };
}

export function planningSessions(state: DemoState): TrainingCase[][] {
  const groups = new Map<string, TrainingCase[]>();
  for (const entry of state.cases.filter(item => item.status === 'planning')) groups.set(entry.sessionId, [...(groups.get(entry.sessionId) || []), entry]);
  return [...groups.values()];
}

export function upcomingSessions(state: DemoState): TrainingCase[][] {
  const groups = new Map<string, TrainingCase[]>();
  for (const entry of state.cases.filter(item => item.eventId && item.slotId && item.slotId !== 'SLOT-OLD' && item.status !== 'complete')) groups.set(entry.sessionId, [...(groups.get(entry.sessionId) || []), entry]);
  return [...groups.values()].sort((a, b) => (state.slots.find(slot => slot.id === a[0].slotId)?.start || '').localeCompare(state.slots.find(slot => slot.id === b[0].slotId)?.start || ''));
}

export function attentionCases(state: DemoState): TrainingCase[] {
  return state.cases.filter(item => !item.supersededByCaseId && (item.declined || item.status === 'assessed' || item.status === 'proof_ready'));
}

function demoSlot(id: string, daysAhead: number, hour: number, busy: string[]): Slot {
  const anchor = new Date(Date.now() + daysAhead * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'shortOffset' }).formatToParts(anchor);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  const shortOffset = get('timeZoneName').replace('GMT', '');
  const offset = shortOffset === '+2' ? '+02:00' : '+01:00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const startHour = String(hour).padStart(2, '0');
  const endHour = String(hour + 1).padStart(2, '0');
  const dayLabel = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', day: 'numeric', month: 'short' }).format(anchor);
  return { id, label: `${dayLabel} · ${startHour}:00–${endHour}:00 Europe/Zurich`, start: `${date}T${startHour}:00:00${offset}`, end: `${date}T${endHour}:00:00${offset}`, busy };
}

export function initialState(): DemoState {
  return {
    cases: [
      { ...makeCase('CASE-G-1', 'REQ-G', 'SES-G', 'WOHNUNG', 'TC_R027', 'group'), status: 'invited', slotId: 'SLOT-1', eventId: 'DEMO-EVENT-SES-G' },
      { ...makeCase('CASE-G-2', 'REQ-G', 'SES-G', 'SUMNER', 'TC_R027', 'group'), status: 'invited', slotId: 'SLOT-1', eventId: 'DEMO-EVENT-SES-G' },
      makeCase('CASE-S-1', 'REQ-S', 'SES-S', 'WOHNUNG', 'TC_R030', 'single'),
      { ...makeCase('CASE-H-1', 'REQ-H', 'SES-H', 'WOHNUNG', 'TC_R033', 'group'), status: 'assessed', slotId: 'SLOT-OLD', eventId: 'DEMO-EVENT-SES-H', trainerPassed: false },
    ],
    slots: [
      demoSlot('SLOT-1', 1, 9, []),
      demoSlot('SLOT-2', 2, 10, ['MARIE']),
      demoSlot('SLOT-3', 5, 14, ['SUMNER']),
      { id: 'SLOT-OLD', label: 'Di, 20. Okt · 09:00–10:00', start: '2026-10-20T09:00:00+02:00', end: '2026-10-20T10:00:00+02:00', busy: [] },
    ],
    nextId: 1,
  };
}

export function sessionCases(state: DemoState, entry: TrainingCase): TrainingCase[] {
  return state.cases.filter(item => item.sessionId === entry.sessionId);
}

export function slotAvailable(state: DemoState, entry: TrainingCase, slotId: string): boolean {
  const slot = state.slots.find(item => item.id === slotId);
  if (!slot || slot.id === 'SLOT-OLD') return false;
  const linked = sessionCases(state, entry);
  return !slot.busy.some(key => key === entry.trainerKey || linked.some(item => item.personKey === key)) &&
    !state.cases.some(item => item.sessionId !== entry.sessionId && item.slotId === slotId && item.eventId);
}

export function evaluate(actionId: ActionId, role: Role, scope: Record<string, string>, facts: Record<string, boolean>, values: Record<string, string> = {}) {
  const action = workflow.actions.find(item => item.id === actionId);
  if (!action) throw new Error(`Unknown action ${actionId}`);
  const missing: string[] = [];
  if (role !== action.actor) missing.push('actor');
  for (const key of action.scopeKey) if (!scope[key]?.trim()) missing.push(key);
  for (const fact of action.requires) if (facts[fact] !== true) missing.push(fact);
  for (const fact of ('forbids' in action ? action.forbids : []) || []) if (facts[fact] !== false) missing.push(`not:${fact}`);
  for (const [key, value] of Object.entries(('equals' in action ? action.equals : {}) || {})) if (values[key] !== value) missing.push(`${key}=${value}`);
  return { allowed: missing.length === 0, missing };
}

export function currentTask(entry: TrainingCase): CurrentTask {
  if (entry.supersededByCaseId) return { action: 'reschedule', state: 'complete', reason: `Neuer Versuch ${entry.supersededByCaseId} angelegt`, canExecute: false };
  if (entry.declined) return { action: 'reschedule', state: 'blocked', reason: 'Teilnahme abgesagt; Person einzeln neu planen', canExecute: false };
  if (entry.status === 'assessed' && !entry.trainerPassed) return { action: 'trainer_review', state: 'blocked', reason: 'Trainerbeurteilung nicht bestanden; erneute Planung erforderlich', canExecute: false };
  if (entry.status === 'complete') return { action: 'complete', state: 'complete', reason: 'Synthetischer Ablauf abgeschlossen', canExecute: false };
  const map: Record<Exclude<CaseStatus, 'complete'>, [string, string]> = {
    planning: ['booking', 'Termin auswählen und Buchung prüfen'],
    invited: ['trainer_assessment', 'Trainerbeurteilung fehlt'],
    assessed: ['participant_acknowledgement', 'Bestätigung der teilnehmenden Person fehlt'],
    acknowledged: ['create_proof', 'Individuellen Nachweis erstellen'],
    proof_ready: ['archive_review', 'Drive- und lokale Kopie prüfen'],
    archived_verified: ['skill_update', 'Kompetenzstand nach Archivprüfung aktualisieren'],
  };
  const [action, reason] = map[entry.status];
  if (!taskContract.actionEnum.includes(action as typeof taskContract.actionEnum[number])) throw new Error('Task action outside contract');
  return { action, state: 'suggested', reason, canExecute: false };
}

export function transition(state: DemoState, caseId: string, action: 'book' | 'pass' | 'fail' | 'acknowledge' | 'proof' | 'archive' | 'skill' | 'decline' | 'retry', slotId?: string): DemoState {
  const selected = state.cases.find(item => item.id === caseId);
  if (!selected) throw new Error('Unknown case');
  const cases = state.cases.map(item => ({ ...item }));
  const current = cases.find(item => item.id === caseId)!;
  const scope = { requestId: current.requestId, sessionId: current.sessionId, caseId: current.id,
    proofId: current.proofId || '', proofVersion: current.proofVersion || '' };
  function requireGate(id: ActionId, role: Role, facts: Record<string, boolean>, values?: Record<string, string>) {
    const result = evaluate(id, role, scope, facts, values);
    if (!result.allowed) throw new Error(`Gate blocked: ${result.missing.join(', ')}`);
  }
  if (action === 'retry') {
    if (current.supersededByCaseId || !(current.declined || (current.status === 'assessed' && !current.trainerPassed))) throw new Error('Nur abgelehnte oder nicht bestandene Fälle neu planen');
    const n = state.nextId || 1;
    const id = `CASE-R-${n}`;
    current.supersededByCaseId = id;
    cases.push({ ...current, id, sessionId: `SES-R-${n}`, mode: 'single', status: 'planning', slotId: undefined, eventId: undefined, trainerPassed: undefined, acknowledgement: undefined, proofId: undefined, proofVersion: undefined, archiveReceipt: undefined, skillApplied: undefined, declined: false, previousCaseId: current.id, supersededByCaseId: undefined });
    return { ...state, cases, nextId: n + 1 };
  } else if (action === 'book') {
    if (current.status !== 'planning' || !slotId) throw new Error('Case is not ready to book');
    const available = slotAvailable(state, selected, slotId);
    requireGate('bookSession', 'process_quality', { sessionPlanned: true, slotAvailable: available, calendarError: false, slotConflict: !available, changedEvent: false });
    for (const item of cases.filter(item => item.sessionId === current.sessionId)) {
      item.slotId = slotId; item.eventId = `DEMO-EVENT-${item.sessionId}`; item.status = 'invited';
    }
  } else if (action === 'decline') {
    if (current.status !== 'invited') throw new Error('Only an invited case can decline');
    requireGate('recordDecline', 'system', { eventAndGuestVerified: Boolean(current.eventId) }, { guestResponse: 'declined' });
    current.declined = true;
  } else if (action === 'pass' || action === 'fail') {
    if (current.status !== 'invited' || current.declined) throw new Error('Assessment is not ready');
    requireGate('recordTrainerAssessment', 'assigned_trainer', { assignedTrainer: true, trainerFormVerified: true });
    current.trainerPassed = action === 'pass';
    current.status = 'assessed';
  } else if (action === 'acknowledge') {
    if (current.status !== 'assessed') throw new Error('Acknowledgement is not ready');
    requireGate('acceptParticipantAcknowledgement', 'assigned_participant', { assignedParticipant: true, participantFormVerified: true, trainerPass: current.trainerPassed === true, answeredYes: true });
    current.acknowledgement = true; current.status = 'acknowledged';
  } else if (action === 'proof') {
    if (current.status !== 'acknowledged') throw new Error('Accepted personal response required');
    current.proofId = `DEMO-PROOF-${current.id}`; current.proofVersion = '1'; current.status = 'proof_ready';
  } else if (action === 'archive') {
    if (current.status !== 'proof_ready') throw new Error('Proof is not ready');
    scope.proofId = current.proofId!; scope.proofVersion = current.proofVersion!;
    requireGate('verifyArchive', 'process_quality', { allPhaseEvidence: true, proofVerified: true, drivePdfVerified: true, localPdfVerified: true });
    current.archiveReceipt = `DEMO-ARCHIVE-${current.id}`; current.status = 'archived_verified';
  } else if (action === 'skill') {
    if (current.status !== 'archived_verified') throw new Error('Verified archive required');
    scope.proofId = current.proofId!; scope.proofVersion = current.proofVersion!;
    requireGate('applySkillUpdate', 'system', { allPhaseEvidence: true, proofVerified: true, archiveReceiptVerified: Boolean(current.archiveReceipt), liveLevelUnchanged: true, levelFourTarget: current.targetLevel === 4, duplicateAppliedUpdate: Boolean(current.skillApplied) }, { proofStatus: 'archived_verified' });
    current.skillApplied = true; current.status = 'complete';
  }
  return { ...state, cases };
}
