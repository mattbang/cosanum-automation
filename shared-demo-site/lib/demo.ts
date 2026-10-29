export type Stage = 'draft' | 'invited' | 'confirmed' | 'in_progress' | 'trainer_reported' | 'completed' | 'cancelled' | 'needs_reschedule';
export type TrainingRequest = { id:string; topic:string; participant:string; requestedBy:string; source:string; reason:string; deadline:string; targetLevel:number };
export type DemoCase = {
  request?: TrainingRequest;
  id: string;
  topic: string;
  participant: string;
  offers: string[];
  rejectedOffers: string[];
  acceptedOffer: string | null;
  stage: Stage;
  report: string;
  result: 'passed' | 'failed' | null;
  targetLevel: number;
  participantConfirmed: boolean;
  events: { at: string; actor: 'Daniel' | 'Teilnehmer:in'; label: string }[];
};
export type SkillStatus = { level: number; status: string };
export type SkillMatrix = Record<string, Record<string, SkillStatus>>;
export type DemoState = { active: DemoCase | null; history: DemoCase[]; skillMatrix?: SkillMatrix; requests?: TrainingRequest[] };
export type DemoAction =
  | { type: 'invite'; requestId?:string; topic: string; participant: string; offers: string[]; targetLevel: number }
  | { type: 'reschedule'; offers: string[] }
  | { type: 'reject_offer'; offer: string }
  | { type: 'accept_offer'; offer: string }
  | { type: 'start_early' }
  | { type: 'cancel' }
  | { type: 'report'; report: string; result: 'passed' | 'failed' }
  | { type: 'confirm_participation' };

export const TOPICS = ['Wareneingang', 'Kommissionierung', 'Qualitätskontrolle', 'Prozessänderung'];
export const PARTICIPANTS = ['Matthew · Mitarbeiter 1', 'Annina · Mitarbeiter 2', 'Marko · Mitarbeiter 3'];
export const LIVE_PARTICIPANT = PARTICIPANTS[0];
export const DEMO_SKILL_MATRIX: SkillMatrix = {
  [PARTICIPANTS[0]]: {
    Wareneingang: { level: 1, status: 'Grundschulung abgeschlossen' },
    Kommissionierung: { level: 0, status: 'Noch nicht geschult' },
    Qualitätskontrolle: { level: 1, status: 'Grundschulung abgeschlossen' },
    Prozessänderung: { level: 0, status: 'Schulung geplant' },
  },
  [PARTICIPANTS[1]]: {
    Wareneingang: { level: 2, status: 'Training abgeschlossen' },
    Kommissionierung: { level: 3, status: 'Training abgeschlossen' },
    Qualitätskontrolle: { level: 1, status: 'Auffrischung vorgesehen' },
    Prozessänderung: { level: 0, status: 'Noch nicht geschult' },
  },
  [PARTICIPANTS[2]]: {
    Wareneingang: { level: 3, status: 'Training abgeschlossen' },
    Kommissionierung: { level: 2, status: 'Training abgeschlossen' },
    Qualitätskontrolle: { level: 2, status: 'Training abgeschlossen' },
    Prozessänderung: { level: 1, status: 'Nachschulung vorgesehen' },
  },
};

export function currentSkillMatrix(state: DemoState): SkillMatrix {
  return Object.fromEntries(PARTICIPANTS.map(person => [person, { ...DEMO_SKILL_MATRIX[person], ...(state.skillMatrix?.[person] || {}) }]));
}

export function initialState(): DemoState { return { active: null, history: [], skillMatrix: currentSkillMatrix({ active: null, history: [] }), requests:[{ id:'REQ-DEMO-01', topic:TOPICS[0], participant:LIVE_PARTICIPANT, requestedBy:'Annina', source:'CCS / Leitstand', reason:'Nachschulung', deadline:new Date(Date.now()+10*86400000).toISOString().slice(0,10), targetLevel:2 }] }; }

function event(actor: 'Daniel' | 'Teilnehmer:in', label: string, at: string) { return { at, actor, label }; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function validOffer(value: string, now: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > Date.parse(now) && parsed < Date.parse(now) + 30 * 86400000;
}

export function transition(state: DemoState, actor: 'host' | 'guest', action: DemoAction, now: string): DemoState {
  const current = state.active;
  if (action.type === 'invite') {
    assert(actor === 'host', 'Nur Daniel kann einladen.');
    assert(!current || ['completed', 'cancelled'].includes(current.stage), 'Bitte den aktiven Fall zuerst abschliessen.');
    assert(TOPICS.includes(action.topic), 'Unbekanntes Trainingsthema.');
    assert(action.participant === LIVE_PARTICIPANT, 'Für Annina und Marko ist noch kein Demo-Konto zugewiesen. Bitte Matthew wählen.');
    assert(action.offers.length >= 1 && action.offers.length <= 3, 'Bitte ein bis drei Termine wählen.');
    assert(new Set(action.offers).size === action.offers.length && action.offers.every(value => validOffer(value, now)), 'Termine müssen eindeutig und in den nächsten 30 Tagen liegen.');
    assert(Number.isInteger(action.targetLevel) && action.targetLevel >= 1 && action.targetLevel <= 3, 'Ungültiges Zielniveau.');
    const request = action.requestId ? state.requests?.find(item => item.id === action.requestId) : undefined;
    if (action.requestId) {
      assert(request && request.topic === action.topic && request.participant === action.participant, 'Die Anfrage passt nicht zu dieser Planung.');
      assert(![...(state.active ? [state.active] : []), ...state.history].some(item => item.request?.id === action.requestId && item.stage !== 'cancelled'), 'Diese Anfrage wurde bereits eingeplant.');
    }
    const next: DemoCase = {
      request, id: crypto.randomUUID(), topic: action.topic, participant: action.participant.trim(), offers: action.offers,
      rejectedOffers: [], acceptedOffer: null, stage: 'invited', report: '', result: null,
      targetLevel: action.targetLevel, participantConfirmed: false,
      events: [event('Daniel', 'Einladung mit Terminvorschlägen erstellt', now)],
    };
    return { ...state, active: next, history: current ? [current, ...state.history].slice(0, 20) : state.history };
  }
  assert(current, 'Es gibt noch keinen aktiven Fall.');
  if (action.type === 'reschedule') {
    assert(actor === 'host' && ['invited', 'confirmed', 'needs_reschedule'].includes(current.stage), 'Neue Termine können nur vor dem Training vorgeschlagen werden.');
    assert(action.offers.length >= 1 && action.offers.length <= 3 && new Set(action.offers).size === action.offers.length && action.offers.every(value => validOffer(value, now)), 'Bitte ein bis drei gültige neue Termine wählen.');
    return { ...state, active: { ...current, offers: action.offers, rejectedOffers: [], acceptedOffer: null, stage: 'invited', events: [...current.events, event('Daniel', 'Neue Termine vorgeschlagen; erneute Terminwahl nötig', now)] } };
  }
  if (action.type === 'reject_offer') {
    assert(actor === 'guest' && current.stage === 'invited', 'Dieser Vorschlag kann nicht mehr abgelehnt werden.');
    assert(current.offers.includes(action.offer), 'Unbekannter Terminvorschlag.');
    const rejectedOffers = [...new Set([...current.rejectedOffers, action.offer])];
    const stage = rejectedOffers.length === current.offers.length ? 'needs_reschedule' : 'invited';
    return { ...state, active: { ...current, rejectedOffers, stage, events: [...current.events, event('Teilnehmer:in', stage === 'needs_reschedule' ? 'Alle Vorschläge abgelehnt' : 'Einen Vorschlag abgelehnt', now)] } };
  }
  if (action.type === 'accept_offer') {
    assert(actor === 'guest' && current.stage === 'invited', 'Die Einladung ist nicht mehr offen.');
    assert(current.offers.includes(action.offer) && !current.rejectedOffers.includes(action.offer), 'Dieser Termin ist nicht verfügbar.');
    return { ...state, active: { ...current, acceptedOffer: action.offer, stage: 'confirmed', events: [...current.events, event('Teilnehmer:in', 'Termin bestätigt', now)] } };
  }
  if (action.type === 'start_early') {
    assert(actor === 'host' && current.stage === 'confirmed', 'Nur ein bestätigter Termin kann gestartet werden.');
    return { ...state, active: { ...current, stage: 'in_progress', events: [...current.events, event('Daniel', 'Training gestartet', now)] } };
  }
  if (action.type === 'cancel') {
    assert(actor === 'host' && ['invited', 'confirmed', 'in_progress', 'needs_reschedule'].includes(current.stage), 'Dieser Fall kann nicht mehr storniert werden.');
    return { ...state, active: { ...current, stage: 'cancelled', events: [...current.events, event('Daniel', 'Training abgesagt', now)] } };
  }
  if (action.type === 'report') {
    assert(actor === 'host' && current.stage === 'in_progress', 'Trainerbericht erst nach dem Start möglich.');
    assert(action.report.trim().length >= 5 && action.report.trim().length <= 1000, 'Bitte einen kurzen Trainerbericht eingeben.');
    assert(action.result === 'passed' || action.result === 'failed', 'Bitte ein Ergebnis wählen.');
    return { ...state, active: { ...current, report: action.report.trim(), result: action.result, stage: 'trainer_reported', events: [...current.events, event('Daniel', 'Trainerbericht eingereicht', now)] } };
  }
  if (action.type === 'confirm_participation') {
    assert(actor === 'guest' && current.stage === 'trainer_reported', 'Teilnahmebestätigung ist noch nicht möglich.');
    const completed = { ...current, participantConfirmed: true, stage: 'completed' as const, events: [...current.events, event('Teilnehmer:in', 'Teilnahme bestätigt und Fall abgeschlossen', now)] };
    const skillMatrix = currentSkillMatrix(state);
    const person = current.participant === 'Mitarbeiter:in 1' ? LIVE_PARTICIPANT : current.participant;
    if (skillMatrix[person]?.[current.topic]) {
      const old = skillMatrix[person][current.topic];
      skillMatrix[person][current.topic] = current.result === 'passed'
        ? { level: Math.max(old.level, current.targetLevel), status: 'Im Demo abgeschlossen' }
        : { ...old, status: 'Nachschulung nötig' };
    }
    return { ...state, active: completed, skillMatrix };
  }
  throw new Error('Unbekannte Aktion.');
}
