import type { SqlPool } from './database.ts';
import { inTransaction } from './database.ts';
import type { Identity } from './service.ts';

export type CreateRequestInput = {
  id: string;
  requesterName: string;
  sourceTeam?: string;
  reason: 'new_training' | 'retraining' | 'process_change';
  deadlineDate: string;
  sessions: Array<{ sessionId: string; startsAt?: string; endsAt?: string; attributes?: Record<string, unknown> }>;
  cases: Array<{ caseId: string; sessionId: string; participantKey: string; participantEmail?: string; trainerKey: string; ownerKey: string; attributes?: Record<string, unknown> }>;
};

export class WorkflowConflictError extends Error {}
export class WorkflowInputError extends Error {}

function sameIdSet(actual: unknown, expected: string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function timestampKey(value?: string | Date | null): string {
  if (!value) return '';
  const time = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(time.valueOf())) throw new WorkflowConflictError('Session times must be valid timestamps');
  return time.toISOString();
}

/** Creates request, session, case, and role-assignment rows atomically; retries must retain the original request-level fields. */
export class PostgresWorkflowRepository {
  constructor(private readonly pool: SqlPool) {}

  async createRequest(input: CreateRequestInput, actor: Identity): Promise<{ requestId: string; caseIds: string[]; replayed: boolean }> {
    if (actor.role !== 'process_quality') throw new WorkflowConflictError('Process & Quality authorization required');
    if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !input.id.trim() ||
        typeof input.requesterName !== 'string' || !input.requesterName.trim() ||
        (input.sourceTeam !== undefined && typeof input.sourceTeam !== 'string') || typeof input.deadlineDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.deadlineDate) ||
        !['new_training', 'retraining', 'process_change'].includes(input.reason) ||
        !Array.isArray(input.cases) || input.cases.length === 0 || !Array.isArray(input.sessions) || input.sessions.length === 0 ||
        input.sessions.some(item => !item || typeof item.sessionId !== 'string' || !item.sessionId ||
          (item.startsAt !== undefined && typeof item.startsAt !== 'string') || (item.endsAt !== undefined && typeof item.endsAt !== 'string') ||
          (item.attributes !== undefined && (!item.attributes || typeof item.attributes !== 'object' || Array.isArray(item.attributes)))) ||
        input.cases.some(item => !item || typeof item.caseId !== 'string' || !item.caseId ||
          typeof item.sessionId !== 'string' || !item.sessionId || typeof item.participantKey !== 'string' || !item.participantKey ||
          (item.participantEmail !== undefined && typeof item.participantEmail !== 'string') ||
          (item.attributes !== undefined && (!item.attributes || typeof item.attributes !== 'object' || Array.isArray(item.attributes))) ||
          typeof item.trainerKey !== 'string' || !item.trainerKey || typeof item.ownerKey !== 'string' || !item.ownerKey))
      throw new WorkflowInputError('Invalid request, deadline, session, or case data');
    if (input.cases.some(entry => entry.ownerKey !== actor.actorKey))
      throw new WorkflowConflictError('Case owner must match the authenticated Process & Quality identity');
    const dateCheck = new Date(`${input.deadlineDate}T00:00:00Z`);
    if (Number.isNaN(dateCheck.valueOf()) || dateCheck.toISOString().slice(0, 10) !== input.deadlineDate)
      throw new WorkflowInputError('Deadline must be a real calendar date');
    const sessionIds = new Set(input.sessions.map(session => session.sessionId));
    if (sessionIds.size !== input.sessions.length || input.cases.some(entry => !sessionIds.has(entry.sessionId)))
      throw new WorkflowInputError('Every case must reference a unique session supplied with this request');

    return inTransaction(this.pool, async db => {
      const requestManifest = {
        sessionIds: input.sessions.map(session => session.sessionId).sort(),
        caseIds: input.cases.map(entry => entry.caseId).sort(),
      };
      const inserted = await db.query(
        `INSERT INTO workflow_requests (request_id, requester_name, source_team, reason, deadline_date, attributes)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (request_id) DO NOTHING`,
        [input.id, input.requesterName.trim(), input.sourceTeam?.trim() || null, input.reason, input.deadlineDate, JSON.stringify(requestManifest)],
      );
      const priorRequest = await db.query<{
        requester_name: string; source_team: string | null; reason: CreateRequestInput['reason']; deadline_date: string;
        attributes: { sessionIds?: unknown; caseIds?: unknown };
      }>('SELECT requester_name, source_team, reason, deadline_date::text AS deadline_date, attributes FROM workflow_requests WHERE request_id = $1 FOR UPDATE', [input.id]);
      const request = priorRequest.rows[0];
      if (!request || request.requester_name !== input.requesterName.trim() || request.source_team !== (input.sourceTeam?.trim() || null) ||
          request.reason !== input.reason || String(request.deadline_date).slice(0, 10) !== input.deadlineDate ||
          !sameIdSet(request.attributes?.sessionIds, requestManifest.sessionIds) || !sameIdSet(request.attributes?.caseIds, requestManifest.caseIds))
        throw new WorkflowConflictError('Request ID already exists with different origin, deadline, sessions, or cases');

      for (const session of input.sessions) {
        await db.query(
          `INSERT INTO workflow_sessions (session_id, request_id, starts_at, ends_at, attributes)
           VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (session_id) DO NOTHING`,
          [session.sessionId, input.id, session.startsAt ?? null, session.endsAt ?? null, JSON.stringify(session.attributes ?? {})],
        );
        const persisted = await db.query<{ request_id: string; starts_at: Date | null; ends_at: Date | null; attributes: Record<string, unknown> }>(
          'SELECT request_id, starts_at, ends_at, attributes FROM workflow_sessions WHERE session_id = $1', [session.sessionId],
        );
        const saved = persisted.rows[0];
        if (!saved || saved.request_id !== input.id || timestampKey(saved.starts_at) !== timestampKey(session.startsAt) || timestampKey(saved.ends_at) !== timestampKey(session.endsAt) ||
            stableJson(saved.attributes) !== stableJson(session.attributes ?? {}))
          throw new WorkflowConflictError(`Session ID ${session.sessionId} already exists with different data`);
      }

      for (const entry of input.cases) {
        await db.query(
          `INSERT INTO workflow_cases (case_id, request_id, session_id, participant_key, trainer_key, owner_key, attributes)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (case_id) DO NOTHING`,
          [entry.caseId, input.id, entry.sessionId, entry.participantKey, entry.trainerKey, entry.ownerKey, JSON.stringify(entry.attributes ?? {})],
        );
        const persisted = await db.query<{ request_id: string; session_id: string; participant_key: string; trainer_key: string; owner_key: string; attributes: Record<string, unknown> }>(
          'SELECT request_id, session_id, participant_key, trainer_key, owner_key, attributes FROM workflow_cases WHERE case_id = $1', [entry.caseId],
        );
        const saved = persisted.rows[0];
        if (!saved || saved.request_id !== input.id || saved.session_id !== entry.sessionId || saved.participant_key !== entry.participantKey || saved.trainer_key !== entry.trainerKey || saved.owner_key !== entry.ownerKey ||
            stableJson(saved.attributes) !== stableJson(entry.attributes ?? {}))
          throw new WorkflowConflictError(`Case ID ${entry.caseId} already exists with different assignments`);
        for (const assignment of [
          { role: 'assigned_participant', actorKey: entry.participantKey, email: entry.participantEmail?.trim().toLocaleLowerCase('en-US') || null },
          { role: 'assigned_trainer', actorKey: entry.trainerKey, email: null },
          { role: 'process_quality', actorKey: entry.ownerKey, email: null },
        ]) {
          await db.query(
            `INSERT INTO workflow_assignments (case_id, role, actor_key, email_normalized)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [entry.caseId, assignment.role, assignment.actorKey, assignment.email],
          );
          const assignmentCheck = await db.query<{ assignment_id: string; email_normalized: string | null }>(
            'SELECT assignment_id, email_normalized FROM workflow_assignments WHERE case_id = $1 AND role = $2 AND actor_key = $3 AND active',
            [entry.caseId, assignment.role, assignment.actorKey],
          );
          if (!assignmentCheck.rowCount || assignmentCheck.rows[0]!.email_normalized !== assignment.email)
            throw new WorkflowConflictError(`Assignment for ${assignment.role} is inactive or differs from the existing record`);
        }
      }
      if (inserted.rowCount) {
        await db.query(
          `INSERT INTO audit_events (actor_key, actor_role, actor_email, operation, request_id, outcome, details)
           VALUES ($1, $2, $3, 'workflow.request.create', $4, 'accepted', $5::jsonb)`,
          [actor.actorKey, actor.role, actor.verifiedEmail, input.id,
            JSON.stringify({ caseIds: input.cases.map(entry => entry.caseId), sessionIds: input.sessions.map(session => session.sessionId) })],
        );
      }
      return { requestId: input.id, caseIds: input.cases.map(entry => entry.caseId), replayed: !inserted.rowCount };
    });
  }
}
