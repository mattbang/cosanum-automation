import type { QueryResultRow } from 'pg';
import type { ActionId } from '../../mobile/src/workflow.ts';
import contract from '../../contracts/workflow.v1.json' with { type: 'json' };
import { ActionError, type Evidence, type Identity, type Snapshot, type WorkflowGateway } from './service.ts';
import { inTransaction, type SqlExecutor, type SqlPool } from './database.ts';

export type ActionExecutionResult = {
  facts: Record<string, boolean>;
  values?: Record<string, string>;
  caseStatus?: NonNullable<Snapshot['status']>;
  state?: Record<string, unknown>;
  session?: { status?: string; calendarEventId?: string; attributes?: Record<string, unknown> };
  relatedCaseUpdates?: Array<{ caseId: string; status?: string; state?: Record<string, unknown>; facts?: Record<string, boolean>; values?: Record<string, string> }>;
  details?: Record<string, unknown>;
};
export type SessionCase = Snapshot;
export interface DurableActionExecutor {
  execute(input: {
    actionId: ActionId; snapshot: Snapshot; payload: Record<string, unknown>;
    actor: Identity; idempotencyKey: string; sessionCases: SessionCase[];
  }): Promise<ActionExecutionResult>;
}

type CaseRow = QueryResultRow & {
  request_id: string; session_id: string | null; case_id: string; proof_id: string | null; proof_version: string | null;
  participant_key: string; trainer_key: string; owner_key: string; revision: string | number;
  attributes: Record<string, unknown>;
  state: Record<string, unknown>; status: string;
  session_status: string | null; calendar_event_id: string | null; session_attributes: Record<string, unknown> | null;
  evidence_facts: Record<string, boolean>; evidence_values: Record<string, string>;
  requester_name: string; source_team: string | null; reason: Snapshot['request'] extends infer R ? R extends { reason: infer V } ? V : never : never;
  deadline_date: string | null;
};

function snapshotFrom(row: CaseRow): Snapshot {
  const scope = {
    requestId: row.request_id, sessionId: row.session_id ?? '', caseId: row.case_id,
    ...(row.proof_id ? { proofId: row.proof_id } : {}),
    ...(row.proof_version ? { proofVersion: row.proof_version } : {}),
  };
  return {
    scope,
    request: {
      requesterName: row.requester_name,
      ...(row.source_team ? { sourceTeam: row.source_team } : {}),
      reason: row.reason,
      ...(row.deadline_date ? { deadlineDate: String(row.deadline_date).slice(0, 10) } : {}),
    },
    attributes: row.attributes ?? {},
    state: row.state ?? {},
    status: row.status,
    ...(row.session_id ? { session: {
      status: row.session_status ?? 'planned',
      ...(row.calendar_event_id ? { calendarEventId: row.calendar_event_id } : {}),
      attributes: row.session_attributes ?? {},
    } } : {}),
    personKey: row.participant_key, trainerKey: row.trainer_key, ownerKey: row.owner_key,
    revision: String(row.revision),
    evidence: { facts: row.evidence_facts ?? {}, values: row.evidence_values ?? {} },
  };
}

async function currentAssignment(db: SqlExecutor, snapshot: Snapshot, actor: Identity, lock = false): Promise<boolean> {
  if (!actor.issuer || !actor.subject || !actor.verifiedEmail) return false;
  const assignmentRole = actor.role === 'system' ? 'process_quality' : actor.role;
  const result = await db.query(
    `SELECT 1
       FROM verified_identities i
       JOIN workflow_assignments a ON a.actor_key = i.actor_key
      WHERE i.issuer = $1 AND i.subject = $2 AND i.email_normalized = $3
        AND i.email_verified AND i.active AND i.actor_key = $4 AND i.role = $5
        AND a.case_id = $6 AND a.role = $7 AND a.actor_key = $4 AND a.active
        AND ((a.role = 'assigned_participant' AND a.identity_issuer = $1 AND a.identity_subject = $2)
          OR (a.role <> 'assigned_participant' AND (a.identity_issuer IS NULL OR (a.identity_issuer = $1 AND a.identity_subject = $2))))
      ${lock ? 'FOR SHARE OF i, a' : ''}`,
    [actor.issuer, actor.subject, actor.verifiedEmail.trim().toLocaleLowerCase('en-US'), actor.actorKey, actor.role,
      snapshot.scope.caseId, assignmentRole],
  );
  return result.rowCount === 1;
}

const CASE_STATUSES = ['open', 'planning', 'invited', 'assessed', 'acknowledged', 'proof_ready', 'archived_verified', 'complete'];
const SESSION_STATUSES = ['planned', 'invited', 'in_progress', 'completed', 'cancelled'];

function validBooleanFacts(facts: Record<string, boolean> | undefined): boolean {
  return !facts || Object.values(facts).every(value => typeof value === 'boolean');
}
function validTextValues(values: Record<string, string> | undefined): boolean {
  return !values || Object.values(values).every(value => typeof value === 'string');
}

async function recordHistory(
  db: SqlExecutor, snapshot: Snapshot, actor: Identity, actionId: ActionId, idempotencyKey: string,
  beforeRevision: string, afterRevision: string, details: Record<string, unknown>,
): Promise<string> {
  const event = await db.query<{ event_id: string }>(
    `INSERT INTO workflow_events
      (request_id, case_id, action_id, actor_key, actor_role, actor_email, idempotency_key,
       scope, before_revision, after_revision, outcome, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::bigint, $10::bigint, 'accepted', $11::jsonb)
     RETURNING event_id`,
    [snapshot.scope.requestId, snapshot.scope.caseId, actionId, actor.actorKey, actor.role, actor.verifiedEmail,
      idempotencyKey, JSON.stringify(snapshot.scope), beforeRevision, afterRevision, JSON.stringify(details)],
  );
  const eventId = event.rows[0]!.event_id;
  await db.query(
    `INSERT INTO audit_events
      (actor_key, actor_role, actor_email, operation, request_id, case_id, event_id, outcome, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted', $8::jsonb)`,
    [actor.actorKey, actor.role, actor.verifiedEmail, `workflow.${actionId}`, snapshot.scope.requestId,
      snapshot.scope.caseId, eventId, JSON.stringify({ idempotencyKey, beforeRevision, afterRevision })],
  );
  return eventId;
}

async function recordEvidence(db: SqlExecutor, caseId: string, evidence: ActionExecutionResult, eventId: string, revision: string): Promise<void> {
  for (const [factKey, factValue] of Object.entries(evidence.facts)) {
    await db.query(
      `INSERT INTO case_evidence (case_id, fact_key, fact_value, source_type, source_id, source_version, observed_at)
       VALUES ($1, $2, $3, 'workflow_action', $4, $5, now())`,
      [caseId, factKey, factValue, eventId, revision],
    );
  }
  for (const [valueKey, valueText] of Object.entries(evidence.values ?? {})) {
    await db.query(
      `INSERT INTO case_evidence (case_id, fact_key, value_key, value_text, source_type, source_id, source_version, observed_at)
       VALUES ($1, '', $2, $3, 'workflow_action', $4, $5, now())`,
      [caseId, valueKey, valueText, eventId, revision],
    );
  }
}

const LOAD_CASE = `SELECT c.request_id, c.session_id, c.case_id, c.proof_id, c.proof_version,
       c.participant_key, c.trainer_key, c.owner_key, c.revision::text AS revision,
       c.attributes, c.state, c.status, c.evidence_facts, c.evidence_values, r.requester_name, r.source_team, r.reason,
       r.deadline_date::text AS deadline_date, s.status AS session_status, s.calendar_event_id,
       s.attributes AS session_attributes
  FROM workflow_cases c JOIN workflow_requests r ON r.request_id = c.request_id
  LEFT JOIN workflow_sessions s ON s.session_id = c.session_id
 WHERE c.case_id = $1`;

const LOAD_SESSION_CASES = `SELECT c.request_id, c.session_id, c.case_id, c.proof_id, c.proof_version,
       c.participant_key, c.trainer_key, c.owner_key, c.revision::text AS revision,
       c.attributes, c.state, c.status, c.evidence_facts, c.evidence_values, r.requester_name, r.source_team, r.reason,
       r.deadline_date::text AS deadline_date, s.status AS session_status, s.calendar_event_id,
       s.attributes AS session_attributes
  FROM workflow_cases c JOIN workflow_requests r ON r.request_id = c.request_id
  LEFT JOIN workflow_sessions s ON s.session_id = c.session_id
 WHERE c.session_id = $1 AND c.request_id = $2 ORDER BY c.case_id`;

/** Persists verified state and history atomically after an injected, idempotent executor confirms its writes. */
export class PostgresWorkflowGateway implements WorkflowGateway {
  constructor(private readonly pool: SqlPool, private readonly executor: DurableActionExecutor) {}

  async load(caseId: string): Promise<Snapshot | null> {
    const result = await this.pool.query<CaseRow>(LOAD_CASE, [caseId]);
    return result.rows[0] ? snapshotFrom(result.rows[0]) : null;
  }

  async authorize(snapshot: Snapshot, actor: Identity): Promise<boolean> {
    const current = await this.load(snapshot.scope.caseId);
    if (!current || current.scope.requestId !== snapshot.scope.requestId || current.scope.sessionId !== snapshot.scope.sessionId ||
        current.personKey !== snapshot.personKey || current.trainerKey !== snapshot.trainerKey || current.ownerKey !== snapshot.ownerKey)
      return false;
    return currentAssignment(this.pool, current, actor);
  }

  async execute(actionId: ActionId, snapshot: Snapshot, payload: Record<string, unknown>, actor: Identity, idempotencyKey: string): Promise<void> {
    await inTransaction(this.pool, async db => {
      const candidateResult = await db.query<CaseRow>(LOAD_CASE, [snapshot.scope.caseId]);
      if (!candidateResult.rows[0]) throw new ActionError(404, 'Case not found');
      const candidate = snapshotFrom(candidateResult.rows[0]);
      // All actions on a shared session acquire locks in the same order before locking individual cases.
      if (candidate.scope.sessionId) {
        const session = await db.query(
          'SELECT session_id FROM workflow_sessions WHERE session_id = $1 AND request_id = $2 FOR UPDATE',
          [candidate.scope.sessionId, candidate.scope.requestId],
        );
        if (!session.rowCount) throw new ActionError(409, 'Case session is missing');
        await db.query(
          'SELECT case_id FROM workflow_cases WHERE request_id = $1 AND session_id = $2 ORDER BY case_id FOR UPDATE',
          [candidate.scope.requestId, candidate.scope.sessionId],
        );
      } else {
        await db.query('SELECT case_id FROM workflow_cases WHERE case_id = $1 FOR UPDATE', [snapshot.scope.caseId]);
      }
      const currentResult = await db.query<CaseRow>(`${LOAD_CASE} FOR UPDATE OF c`, [snapshot.scope.caseId]);
      const row = currentResult.rows[0];
      if (!row) throw new ActionError(404, 'Case not found');
      const current = snapshotFrom(row);
      if (current.revision !== snapshot.revision || current.scope.requestId !== snapshot.scope.requestId || current.scope.sessionId !== snapshot.scope.sessionId ||
          current.scope.proofId !== snapshot.scope.proofId || current.scope.proofVersion !== snapshot.scope.proofVersion ||
          current.personKey !== snapshot.personKey || current.trainerKey !== snapshot.trainerKey || current.ownerKey !== snapshot.ownerKey)
        throw new ActionError(409, 'Case changed; reload before retrying');
      if (!await currentAssignment(db, current, actor, true)) throw new ActionError(403, 'Role or assignment mismatch');
      if (actionId === 'bookSession' &&
          (!current.session || current.status === 'invited' || current.session.status !== 'planned' || current.session.calendarEventId))
        throw new ActionError(409, 'Session is missing, no longer planned, or already has a verified booking');

      const duplicate = await db.query('SELECT 1 FROM workflow_events WHERE case_id = $1 AND idempotency_key = $2', [snapshot.scope.caseId, idempotencyKey]);
      if (duplicate.rowCount) throw new ActionError(409, 'This action was already recorded');

      const sessionRows = current.scope.sessionId
        ? await db.query<CaseRow>(LOAD_SESSION_CASES, [current.scope.sessionId, current.scope.requestId])
        : { rows: [row], rowCount: 1 };
      const sessionCases = sessionRows.rows.map(snapshotFrom);

      // The executor must use idempotencyKey for external requests and verify the resulting external state before returning.
      const result = await this.executor.execute({ actionId, snapshot: current, payload, actor, idempotencyKey, sessionCases });
      const action = contract.actions.find(item => item.id === actionId);
      if (!action) throw new ActionError(400, 'Unknown workflow action');
      if (result.caseStatus && !CASE_STATUSES.includes(result.caseStatus)) throw new ActionError(502, 'Executor returned an invalid case status');
      if (result.session?.status && !SESSION_STATUSES.includes(result.session.status)) throw new ActionError(502, 'Executor returned an invalid session status');
      if (result.session?.calendarEventId !== undefined && typeof result.session.calendarEventId !== 'string') throw new ActionError(502, 'Executor returned an invalid Calendar event ID');
      if (result.state && (typeof result.state !== 'object' || Array.isArray(result.state))) throw new ActionError(502, 'Executor returned invalid case state');
      if (result.session?.attributes && (typeof result.session.attributes !== 'object' || Array.isArray(result.session.attributes))) throw new ActionError(502, 'Executor returned invalid session attributes');
      if (!validBooleanFacts(result.facts) || !validTextValues(result.values)) throw new ActionError(502, 'Executor returned invalid evidence');
      const relatedUpdates = result.relatedCaseUpdates ?? [];
      const sessionCaseIds = new Set(sessionCases.map(item => item.scope.caseId));
      const relatedIds = new Set<string>();
      for (const update of relatedUpdates) {
        if (!update.caseId || update.caseId === current.scope.caseId || relatedIds.has(update.caseId) || !sessionCaseIds.has(update.caseId))
          throw new ActionError(502, 'Executor returned an out-of-session or duplicate case update');
        relatedIds.add(update.caseId);
        if (actor.role !== 'process_quality' && actor.role !== 'system') throw new ActionError(403, 'Only workflow coordinators may update linked session cases');
        if (update.status && !CASE_STATUSES.includes(update.status)) throw new ActionError(502, 'Executor returned an invalid linked-case status');
        if (update.state && (typeof update.state !== 'object' || Array.isArray(update.state))) throw new ActionError(502, 'Executor returned invalid linked-case state');
        if (!validBooleanFacts(update.facts) || !validTextValues(update.values)) throw new ActionError(502, 'Executor returned invalid linked-case evidence');
      }
      if (result.session && !current.scope.sessionId) throw new ActionError(502, 'Executor cannot update a missing session');
      if (actionId === 'bookSession') {
        const eventId = result.session?.calendarEventId;
        if (!result.session || result.session.status !== 'invited' || typeof eventId !== 'string' || !eventId.trim() ||
            result.caseStatus !== 'invited' || result.state?.calendarEventId !== eventId)
          throw new ActionError(502, 'Executor must confirm the shared booking and current case with one event ID');
        const expectedLinkedCaseIds = sessionCases.map(item => item.scope.caseId).filter(caseId => caseId !== current.scope.caseId).sort();
        const actualLinkedCaseIds = relatedUpdates.map(update => update.caseId).sort();
        if (expectedLinkedCaseIds.length !== actualLinkedCaseIds.length ||
            expectedLinkedCaseIds.some((caseId, index) => caseId !== actualLinkedCaseIds[index]) ||
            relatedUpdates.some(update => update.status !== 'invited' || update.state?.calendarEventId !== eventId))
          throw new ActionError(502, 'Executor must confirm every participant case with the shared booking event');
      }
      for (const fact of action.postconditions || []) {
        if (result.facts[fact] !== true) throw new ActionError(502, `Executor did not verify postcondition: ${fact}`);
      }
      for (const fact of action.forbids || []) {
        if (result.facts[fact] !== false) throw new ActionError(502, `Executor reported forbidden state: ${fact}`);
      }
      const evidence: Evidence = {
        facts: { ...current.evidence.facts, ...result.facts },
        values: { ...current.evidence.values, ...(result.values ?? {}) },
      };
      const nextRevision = String(BigInt(current.revision) + 1n);
      const updated = await db.query(
        `UPDATE workflow_cases
            SET evidence_facts = $2::jsonb, evidence_values = $3::jsonb,
                revision = $4::bigint, status = COALESCE($6, status),
                state = state || $7::jsonb, updated_at = now()
          WHERE case_id = $1 AND revision = $5::bigint`,
        [snapshot.scope.caseId, JSON.stringify(evidence.facts), JSON.stringify(evidence.values), nextRevision, current.revision,
          result.caseStatus ?? null, JSON.stringify(result.state ?? {})],
      );
      if (updated.rowCount !== 1) throw new ActionError(409, 'Case revision changed during action');

      if (result.session) {
        const sessionUpdated = await db.query(
          `UPDATE workflow_sessions SET status = COALESCE($3, status), calendar_event_id = COALESCE($4, calendar_event_id),
                  attributes = attributes || $5::jsonb, revision = revision + 1, updated_at = now()
            WHERE session_id = $1 AND request_id = $2`,
          [current.scope.sessionId, current.scope.requestId, result.session.status ?? null,
            result.session.calendarEventId ?? null, JSON.stringify(result.session.attributes ?? {})],
        );
        if (sessionUpdated.rowCount !== 1) throw new ActionError(409, 'Session changed during action');
      }
      const eventDetails = { ...(result.details ?? {}), ...(result.session ? { sessionId: current.scope.sessionId, sessionUpdate: result.session } : {}), relatedCaseIds: [...relatedIds] };
      const eventId = await recordHistory(db, current, actor, actionId, idempotencyKey, current.revision, nextRevision, eventDetails);
      await recordEvidence(db, current.scope.caseId, result, eventId, nextRevision);

      for (const linkedUpdate of relatedUpdates) {
        const linked = sessionCases.find(item => item.scope.caseId === linkedUpdate.caseId)!;
        const linkedFacts = { ...linked.evidence.facts, ...(linkedUpdate.facts ?? {}) };
        const linkedValues = { ...linked.evidence.values, ...(linkedUpdate.values ?? {}) };
        const linkedRevision = String(BigInt(linked.revision) + 1n);
        const linkedResult = await db.query(
          `UPDATE workflow_cases SET evidence_facts = $2::jsonb, evidence_values = $3::jsonb,
                  status = COALESCE($4, status), state = state || $5::jsonb, revision = $6::bigint, updated_at = now()
            WHERE case_id = $1 AND revision = $7::bigint`,
          [linked.scope.caseId, JSON.stringify(linkedFacts), JSON.stringify(linkedValues), linkedUpdate.status ?? null,
            JSON.stringify(linkedUpdate.state ?? {}), linkedRevision, linked.revision],
        );
        if (linkedResult.rowCount !== 1) throw new ActionError(409, 'Linked case revision changed during action');
        const linkedScope = { ...linked.scope };
        const linkedSnapshot = { ...linked, scope: linkedScope };
        const linkedKey = `${idempotencyKey}:linked:${linked.scope.caseId}`;
        const linkedEventId = await recordHistory(db, linkedSnapshot, actor, actionId, linkedKey, linked.revision, linkedRevision,
          { linkedToCaseId: current.scope.caseId, parentIdempotencyKey: idempotencyKey });
        await recordEvidence(db, linked.scope.caseId, { facts: linkedUpdate.facts ?? {}, values: linkedUpdate.values ?? {} }, linkedEventId, linkedRevision);
      }
    });
  }
}
