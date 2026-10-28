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
  details?: Record<string, unknown>;
};
export interface DurableActionExecutor {
  execute(input: {
    actionId: ActionId; snapshot: Snapshot; payload: Record<string, unknown>;
    actor: Identity; idempotencyKey: string;
  }): Promise<ActionExecutionResult>;
}

type CaseRow = QueryResultRow & {
  request_id: string; session_id: string | null; case_id: string; proof_id: string | null; proof_version: string | null;
  participant_key: string; trainer_key: string; owner_key: string; revision: string | number;
  attributes: Record<string, unknown>;
  state: Record<string, unknown>; status: string;
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

const LOAD_CASE = `SELECT c.request_id, c.session_id, c.case_id, c.proof_id, c.proof_version,
       c.participant_key, c.trainer_key, c.owner_key, c.revision::text AS revision,
       c.attributes, c.state, c.status, c.evidence_facts, c.evidence_values, r.requester_name, r.source_team, r.reason,
       r.deadline_date::text AS deadline_date
  FROM workflow_cases c JOIN workflow_requests r ON r.request_id = c.request_id
 WHERE c.case_id = $1`;

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
      const currentResult = await db.query<CaseRow>(`${LOAD_CASE} FOR UPDATE OF c`, [snapshot.scope.caseId]);
      const row = currentResult.rows[0];
      if (!row) throw new ActionError(404, 'Case not found');
      const current = snapshotFrom(row);
      if (current.revision !== snapshot.revision || current.scope.requestId !== snapshot.scope.requestId || current.scope.sessionId !== snapshot.scope.sessionId ||
          current.scope.proofId !== snapshot.scope.proofId || current.scope.proofVersion !== snapshot.scope.proofVersion ||
          current.personKey !== snapshot.personKey || current.trainerKey !== snapshot.trainerKey || current.ownerKey !== snapshot.ownerKey)
        throw new ActionError(409, 'Case changed; reload before retrying');
      if (!await currentAssignment(db, current, actor, true)) throw new ActionError(403, 'Role or assignment mismatch');

      const duplicate = await db.query('SELECT 1 FROM workflow_events WHERE case_id = $1 AND idempotency_key = $2', [snapshot.scope.caseId, idempotencyKey]);
      if (duplicate.rowCount) throw new ActionError(409, 'This action was already recorded');

      // The executor must use idempotencyKey for external requests and verify the resulting external state before returning.
      const result = await this.executor.execute({ actionId, snapshot: current, payload, actor, idempotencyKey });
      const action = contract.actions.find(item => item.id === actionId);
      if (!action) throw new ActionError(400, 'Unknown workflow action');
      const allowedStatuses = ['open', 'planning', 'invited', 'assessed', 'acknowledged', 'proof_ready', 'archived_verified', 'complete'];
      if (result.caseStatus && !allowedStatuses.includes(result.caseStatus)) throw new ActionError(502, 'Executor returned an invalid case status');
      if (result.state && (typeof result.state !== 'object' || Array.isArray(result.state))) throw new ActionError(502, 'Executor returned invalid case state');
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

      const event = await db.query<{ event_id: string }>(
        `INSERT INTO workflow_events
          (request_id, case_id, action_id, actor_key, actor_role, actor_email, idempotency_key,
           scope, before_revision, after_revision, outcome, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::bigint, $10::bigint, 'accepted', $11::jsonb)
         RETURNING event_id`,
        [current.scope.requestId, current.scope.caseId, actionId, actor.actorKey, actor.role, actor.verifiedEmail,
          idempotencyKey, JSON.stringify(current.scope), current.revision, nextRevision, JSON.stringify(result.details ?? {})],
      );
      await db.query(
        `INSERT INTO audit_events
          (actor_key, actor_role, actor_email, operation, request_id, case_id, event_id, outcome, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted', $8::jsonb)`,
        [actor.actorKey, actor.role, actor.verifiedEmail, `workflow.${actionId}`, current.scope.requestId,
          current.scope.caseId, event.rows[0]!.event_id, JSON.stringify({ idempotencyKey, beforeRevision: current.revision, afterRevision: nextRevision })],
      );

      for (const [factKey, factValue] of Object.entries(result.facts)) {
        await db.query(
          `INSERT INTO case_evidence (case_id, fact_key, fact_value, source_type, source_id, source_version, observed_at)
           VALUES ($1, $2, $3, 'workflow_action', $4, $5, now())`,
          [current.scope.caseId, factKey, factValue, event.rows[0]!.event_id, nextRevision],
        );
      }
      for (const [valueKey, valueText] of Object.entries(result.values ?? {})) {
        await db.query(
          `INSERT INTO case_evidence (case_id, fact_key, value_key, value_text, source_type, source_id, source_version, observed_at)
           VALUES ($1, '', $2, $3, 'workflow_action', $4, $5, now())`,
          [current.scope.caseId, valueKey, valueText, event.rows[0]!.event_id, nextRevision],
        );
      }
    });
  }
}
