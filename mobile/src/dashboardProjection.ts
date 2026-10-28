/** Read-only adapter for backend PR #53's GET /dashboard/process-quality contract. No network access. */
export type AttentionAction = 'reschedule' | 'trainer_review' | 'participant_acknowledgement' | 'archive_review';
export type DashboardCase = {
  caseId: string; participantKey: string; trainerKey: string; status: string; revision: string;
  topicId?: string; topicName?: string; mode?: 'group' | 'single'; targetLevel?: number;
  trainerPassed?: boolean; declined: boolean; attentionAction?: AttentionAction;
};
export type RequestContext = {
  requestId: string; requesterName: string; sourceTeam?: string; reason: string; deadlineDate: string;
};
export type ProcessQualityDashboard = {
  unscheduledRequests: (RequestContext & { revision: string; sessionId?: string; sessionRevision?: string; cases: DashboardCase[] })[];
  upcomingSessions: (RequestContext & { sessionId: string; startsAt: string; endsAt?: string; sessionRevision: string; cases: DashboardCase[] })[];
  attentionCases: (RequestContext & DashboardCase & { sessionId?: string })[];
};
export type DashboardNames = {
  participants?: Record<string, string>; trainers?: Record<string, string>; topics?: Record<string, string>;
};
export type DanielMember = {
  caseId: string; revision: string; participantKey: string; participantLabel: string;
  trainerKey: string; trainerLabel: string; status: string; statusLabel: string;
};
export type DanielSessionCard = {
  key: string; requestId: string; requestRevision?: string; sessionId?: string; sessionRevision?: string;
  title: string; modeLabel: string; requesterLabel: string; reasonLabel: string; deadlineLabel: string;
  participantLabel: string; trainerLabel: string; members: DanielMember[];
  timeLabel?: string;
};
export type DanielAttentionCard = {
  key: string; caseId: string; revision: string; requestId: string; sessionId?: string;
  title: string; participantLabel: string; reasonLabel: string; deadlineLabel: string;
  attentionAction?: AttentionAction; actionLabel: string; detailLabel: string;
};
export type DanielLandingViewModel = {
  unscheduledRequests: DanielSessionCard[]; upcomingSessions: DanielSessionCard[]; attentionCases: DanielAttentionCard[];
};

const reasonLabels: Record<string, string> = {
  new_training: 'Neue Schulung', retraining: 'Nachschulung', process_change: 'Prozessänderung',
};
const day = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const clock = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', hourCycle: 'h23' });
const deadline = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' });

function named(names: Record<string, string> | undefined, key: string, kind: 'Person' | 'Trainer'): string {
  const value = names?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : `${kind} [${key}]`;
}
function topicLabel(cases: DashboardCase[], names: DashboardNames): string {
  const ids = [...new Set(cases.map(item => item.topicId).filter((id): id is string => Boolean(id)))];
  if (ids.length > 1) return 'Mehrere Themen';
  const id = ids[0];
  if (id) {
    const catalogueName = names.topics?.[id];
    return (typeof catalogueName === 'string' && catalogueName.trim() ? catalogueName.trim() : undefined)
      || cases.find(item => item.topicId === id && item.topicName?.trim())?.topicName?.trim() || `Thema ${id}`;
  }
  const labels = [...new Set(cases.map(item => item.topicName?.trim()).filter((label): label is string => Boolean(label)))];
  return labels.length > 1 ? 'Mehrere Themen' : labels[0] || 'Thema nicht hinterlegt';
}
function modeLabel(cases: DashboardCase[]): string {
  const modes = [...new Set(cases.map(item => item.mode).filter(Boolean))];
  return modes.length > 1 ? 'Gemischte Schulungsform' : modes[0] === 'group' ? 'Gruppe' : modes[0] === 'single' ? 'Einzeln' : 'Schulungsform nicht hinterlegt';
}
function deadlineLabel(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Abschlussfrist nicht verfügbar';
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? 'Abschlussfrist nicht verfügbar' : `Abschluss bis ${deadline.format(parsed)}`;
}
function utcInstant(value: string): Date | null {
  if (!value.endsWith('Z')) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
export function zurichSessionLabel(startsAt: string, endsAt?: string): string {
  const start = utcInstant(startsAt);
  if (!start) return 'Terminzeit nicht verfügbar';
  const end = endsAt ? utcInstant(endsAt) : null;
  if (!end || end.getTime() <= start.getTime()) return `${day.format(start)} · ab ${clock.format(start)} · Ende offen`;
  return day.format(start) === day.format(end)
    ? `${day.format(start)} · ${clock.format(start)}–${clock.format(end)}`
    : `${day.format(start)} ${clock.format(start)} – ${day.format(end)} ${clock.format(end)}`;
}
function statusLabel(item: DashboardCase): string {
  if (item.declined) return 'Einladung abgelehnt';
  if (item.status === 'open' || item.status === 'planning') return 'Termin offen';
  if (item.status === 'invited') return 'eingeladen';
  if (item.status === 'assessed') return item.trainerPassed === true ? 'Bestätigung offen' : item.trainerPassed === false ? 'nicht bestanden' : 'Beurteilung prüfen';
  return ({ acknowledged: 'bestätigt', proof_ready: 'Archivprüfung offen', archived_verified: 'Kompetenzstand offen', complete: 'abgeschlossen' } as Record<string, string>)[item.status] || `Status ${item.status}`;
}
function member(item: DashboardCase, names: DashboardNames): DanielMember {
  return {
    caseId: item.caseId, revision: item.revision, participantKey: item.participantKey,
    participantLabel: named(names.participants, item.participantKey, 'Person'),
    trainerKey: item.trainerKey, trainerLabel: named(names.trainers, item.trainerKey, 'Trainer'),
    status: item.status, statusLabel: statusLabel(item),
  };
}
function context(item: RequestContext): Pick<DanielSessionCard, 'requestId' | 'requesterLabel' | 'reasonLabel' | 'deadlineLabel'> {
  const name = item.requesterName.trim() || 'nicht hinterlegt';
  return {
    requestId: item.requestId,
    requesterLabel: `Angefragt von ${name}${item.sourceTeam?.trim() ? ` · ${item.sourceTeam.trim()}` : ''}`,
    reasonLabel: reasonLabels[item.reason] || `Grund nicht hinterlegt (${item.reason})`,
    deadlineLabel: deadlineLabel(item.deadlineDate),
  };
}
function sessionCard(item: RequestContext & { cases: DashboardCase[]; sessionId?: string; sessionRevision?: string; revision?: string; startsAt?: string; endsAt?: string }, names: DashboardNames): DanielSessionCard {
  const members = item.cases.map(entry => member(entry, names));
  const trainers = [...new Set(members.map(entry => entry.trainerKey))];
  return {
    key: `${item.requestId}:${item.sessionId || 'ohne-sitzung'}`, ...context(item),
    ...(item.revision ? { requestRevision: item.revision } : {}), ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.sessionRevision ? { sessionRevision: item.sessionRevision } : {}),
    title: topicLabel(item.cases, names), modeLabel: modeLabel(item.cases),
    participantLabel: members.map(entry => `${entry.participantLabel}: ${entry.statusLabel}`).join(' · ') || 'Keine zugeordneten Personen',
    trainerLabel: trainers.length > 1 ? 'Mehrere Trainer' : members[0]?.trainerLabel || 'Trainer nicht hinterlegt',
    members, ...(item.startsAt ? { timeLabel: zurichSessionLabel(item.startsAt, item.endsAt) } : {}),
  };
}
function attentionCard(item: ProcessQualityDashboard['attentionCases'][number], names: DashboardNames): DanielAttentionCard {
  const action = item.attentionAction;
  const actionLabel = action === 'reschedule' ? 'Erneut planen' : action === 'archive_review' ? 'Archiv prüfen' : 'Fall prüfen';
  const detailLabel = action === 'reschedule' ? item.declined ? 'Teilnahme abgesagt; Person einzeln neu planen' : 'Trainerbeurteilung nicht bestanden; erneute Planung erforderlich'
    : action === 'participant_acknowledgement' ? 'Bestätigung der teilnehmenden Person fehlt'
    : action === 'trainer_review' ? 'Trainerbeurteilung ohne gesichertes Ergebnis prüfen'
    : action === 'archive_review' ? 'Archivprüfung offen' : 'Handlungsbedarf prüfen';
  return {
    key: item.caseId, caseId: item.caseId, revision: item.revision, requestId: item.requestId,
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    title: topicLabel([item], names), participantLabel: named(names.participants, item.participantKey, 'Person'),
    reasonLabel: context(item).reasonLabel, deadlineLabel: deadlineLabel(item.deadlineDate),
    ...(action ? { attentionAction: action } : {}), actionLabel, detailLabel,
  };
}

/** Maps an already-authorized backend response; does not fetch, authenticate, or change the synthetic app state. */
export function mapProcessQualityDashboard(payload: ProcessQualityDashboard, names: DashboardNames = {}): DanielLandingViewModel {
  return {
    unscheduledRequests: payload.unscheduledRequests.map(item => sessionCard(item, names)),
    upcomingSessions: payload.upcomingSessions.map(item => sessionCard(item, names)),
    attentionCases: payload.attentionCases.map(item => attentionCard(item, names)),
  };
}
