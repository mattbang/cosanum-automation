import type { QueryResultRow } from 'pg';
import { ActionError, type Identity } from './service.ts';
import { inTransaction, type SqlPool } from './database.ts';

type CurrentCase = QueryResultRow & {
  request_id: string; session_id: string | null; case_id: string; owner_key: string;
  status: string; revision: string; state: Record<string, unknown>;
  evidence_facts: Record<string, unknown>; actor_email: string;
};
type IntentRow = QueryResultRow & { intent_id: string; semantic_key: string; status: 'pending' | 'cancelled' };

export type NotificationIntentReceipt = {
  status: 'pending' | 'cancelled' | 'not_eligible';
  intentId?: string;
  semanticKey?: string;
  sourceRevision: string;
  replayed: boolean;
  cancelledCount: number;
};

/** Persists an intent only; it has no sender, scheduler, token, or external-service dependency. */
export class NotificationIntents {
  constructor(private readonly pool: SqlPool) {}

  async reconcileFailedAssessment(input: { caseId: string; expectedRevision: string }, actor: Identity): Promise<NotificationIntentReceipt> {
    const caseId = input.caseId.trim();
    const expectedRevision = input.expectedRevision.trim();
    if (!caseId || !/^[1-9]\d{0,18}$/.test(expectedRevision) || BigInt(expectedRevision) > 9_223_372_036_854_775_807n)
      throw new ActionError(400, 'Case ID and positive expected revision are required');
    if (actor.role !== 'process_quality' || !actor.issuer || !actor.subject || !actor.verifiedEmail)
      throw new ActionError(403, 'Verified Process & Quality identity required');

    return inTransaction(this.pool, async db => {
      const current = await db.query<CurrentCase>(
        `SELECT c.request_id, c.session_id, c.case_id, c.owner_key, c.status,
                c.revision::text AS revision, c.state, c.evidence_facts,
                i.email_normalized AS actor_email
           FROM workflow_cases c
           JOIN workflow_assignments a ON a.case_id = c.case_id AND a.role = 'process_quality'
            AND a.actor_key = c.owner_key AND a.active
           JOIN verified_identities i ON i.actor_key = c.owner_key AND i.issuer = $2 AND i.subject = $3
            AND i.email_normalized = lower(trim($4)) AND i.email_verified AND i.active
            AND i.role = 'process_quality'
          WHERE c.case_id = $1
          FOR UPDATE OF c, a, i`,
        [caseId, actor.issuer, actor.subject, actor.verifiedEmail],
      );
      const row = current.rows[0];
      if (!row || actor.actorKey !== row.owner_key) throw new ActionError(403, 'Active verified owner assignment required');
      if (row.revision !== expectedRevision) throw new ActionError(409, 'Case changed; reload before preparing a notification intent');

      const superseded = typeof row.state?.supersededByCaseId === 'string' && row.state.supersededByCaseId.length > 0;
      const eligible = row.status === 'assessed' && row.evidence_facts?.trainerPass === false && !superseded;
      const cancelled = await db.query<{ intent_id: string }>(
        `UPDATE notification_intents
            SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'source_state_changed'
          WHERE case_id = $1 AND recipient_role = 'process_quality' AND recipient_actor_key = $2
            AND status = 'pending' AND (source_revision <> $3::bigint OR NOT $4::boolean)
          RETURNING intent_id`,
        [caseId, row.owner_key, row.revision, eligible],
      );
      const cancelledCount = cancelled.rowCount ?? cancelled.rows.length;
      if (cancelledCount) {
        await db.query(
          `INSERT INTO audit_events (actor_key, actor_role, actor_email, operation, request_id, case_id, outcome, details)
           VALUES ($1, 'process_quality', $2, 'notification.intent.cancel', $3, $4, 'accepted', $5::jsonb)`,
          [actor.actorKey, row.actor_email, row.request_id, caseId,
            JSON.stringify({ cancelledIntentIds: cancelled.rows.map(item => item.intent_id), reason: 'source_state_changed', sourceRevision: row.revision })],
        );
      }
      if (!eligible) return {
        status: 'not_eligible', sourceRevision: row.revision, replayed: false, cancelledCount,
      };

      const semanticKey = `failed_assessment:${caseId}:${row.revision}:${row.owner_key}`;
      const inserted = await db.query<IntentRow>(
        `INSERT INTO notification_intents
          (semantic_key, event_type, task_key, request_id, session_id, case_id, source_revision,
           recipient_role, recipient_actor_key, payload)
         VALUES ($1, 'failed_assessment', 'failed_assessment', $2, $3, $4, $5::bigint,
                 'process_quality', $6, '{"templateKey":"exception_notice","reasonCode":"trainer_failed"}'::jsonb)
         ON CONFLICT DO NOTHING
         RETURNING intent_id, semantic_key, status`,
        [semanticKey, row.request_id, row.session_id, caseId, row.revision, row.owner_key],
      );
      if (inserted.rowCount) {
        await db.query(
          `INSERT INTO audit_events (actor_key, actor_role, actor_email, operation, request_id, case_id, outcome, details)
           VALUES ($1, 'process_quality', $2, 'notification.intent.create', $3, $4, 'accepted', $5::jsonb)`,
          [actor.actorKey, row.actor_email, row.request_id, caseId,
            JSON.stringify({ intentId: inserted.rows[0]!.intent_id, semanticKey, sourceRevision: row.revision, taskKey: 'failed_assessment' })],
        );
        return {
          status: 'pending', intentId: inserted.rows[0]!.intent_id, semanticKey,
          sourceRevision: row.revision, replayed: false, cancelledCount,
        };
      }
      const prior = await db.query<IntentRow>(
        `SELECT intent_id, semantic_key, status FROM notification_intents
          WHERE semantic_key = $1`, [semanticKey],
      );
      const existing = prior.rows[0];
      if (!existing) throw new Error('Notification intent conflict has no matching semantic key');
      return {
        status: existing.status, intentId: existing.intent_id, semanticKey: existing.semantic_key,
        sourceRevision: row.revision, replayed: true, cancelledCount,
      };
    });
  }
}
