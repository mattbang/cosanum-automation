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
  declined?: boolean;
};
export type Slot = { id: string; label: string; start: string; end: string; busy: string[] };
export type DemoState = { cases: TrainingCase[]; slots: Slot[] };
export type ActionId = typeof workflow.actions[number]['id'];
export type CurrentTask = { action: string; state: 'suggested' | 'blocked' | 'complete'; reason: string; canExecute: false };

const people = new Map(fixture.People.map(row => [String(row[0]), String(row[5])]));
const topics = new Map(fixture.Topics.map(row => [String(row[0]), String(row[1])]));
const levels = new Map(fixture.Skills.map(row => [`${row[0]}:${row[1]}`, Number(row[2])]));

function makeCase(id: string, requestId: string, sessionId: string, personKey: string, topicId: string, mode: 'group' | 'single'): TrainingCase {
  const originalLevel = levels.get(`${personKey}:${topicId}`);
  if (!Number.isInteger(originalLevel) || originalLevel! < 0) throw new Error('Synthetic case has no valid starting level');
  return { id, requestId, sessionId, personKey, personName: people.get(personKey)!, topicId,
    topicName: topics.get(topicId)!, mode, trainerKey: 'MARIE', originalLevel: originalLevel!,
    targetLevel: Math.min(originalLevel! + 1, 3), status: 'planning' };
}

export function initialState(): DemoState {
  return {
    cases: [
      makeCase('CASE-G-1', 'REQ-G', 'SES-G', 'WOHNUNG', 'TC_R027', 'group'),
      makeCase('CASE-G-2', 'REQ-G', 'SES-G', 'SUMNER', 'TC_R027', 'group'),
      makeCase('CASE-S-1', 'REQ-S', 'SES-S', 'WOHNUNG', 'TC_R030', 'single'),
    ],
    slots: [
      { id: 'SLOT-1', label: 'Do, 29. Okt · 09:00–10:00', start: '2026-10-29T09:00:00+01:00', end: '2026-10-29T10:00:00+01:00', busy: [] },
      { id: 'SLOT-2', label: 'Fr, 30. Okt · 10:00–11:00', start: '2026-10-30T10:00:00+01:00', end: '2026-10-30T11:00:00+01:00', busy: ['MARIE'] },
      { id: 'SLOT-3', label: 'Mo, 2. Nov · 14:00–15:00', start: '2026-11-02T14:00:00+01:00', end: '2026-11-02T15:00:00+01:00', busy: ['SUMNER'] },
    ],
  };
}

export function sessionCases(state: DemoState, entry: TrainingCase): TrainingCase[] {
  return state.cases.filter(item => item.sessionId === entry.sessionId);
}

export function slotAvailable(state: DemoState, entry: TrainingCase, slotId: string): boolean {
  const slot = state.slots.find(item => item.id === slotId);
  if (!slot) return false;
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

export function transition(state: DemoState, caseId: string, action: 'book' | 'pass' | 'fail' | 'acknowledge' | 'proof' | 'archive' | 'skill' | 'decline', slotId?: string): DemoState {
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
  if (action === 'book') {
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
