import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { ActionError, type Identity } from './service.ts';
import { inTransaction, type SqlPool } from './database.ts';

type CaseRow = QueryResultRow & {
  case_id: string; request_id: string; participant_key: string; revision: string;
  evidence_facts: Record<string, boolean>; assignment_id: string; actor_email: string;
};

type StoredResponse = QueryResultRow & { response_id: string; answer: string; typed_name: string; revision: string };

export type ParticipantResponseReceipt = {
  status: 'verified'; actionId: 'acceptParticipantAcknowledgement'; caseId: string;
  responseId: string; revision: string; replayed: boolean;
};

/** Records one immutable, verified participant acknowledgement for the exact assigned case. */
export class ParticipantResponses {
  constructor(private readonly pool: SqlPool) {}

  async submit(input: { caseId: string; idempotencyKey: string; answer: 'yes'; typedName: string }, actor: Identity): Promise<ParticipantResponseReceipt> {
    const caseId = input.caseId.trim();
    const key = input.idempotencyKey.trim();
    const typedName = input.typedName.trim();
    if (!caseId || !key || key.length > 200 || input.answer !== 'yes' || !typedName || typedName.length > 200)
      throw new ActionError(400, 'Case ID, stable idempotency key, affirmative answer, and typed name are required');
    if (actor.role !== 'assigned_participant' || !actor.issuer || !actor.subject || !actor.verifiedEmail)
      throw new ActionError(403, 'Verified participant identity required');

    return inTransaction(this.pool, async db => {
      const current = await db.query<CaseRow>(
        `SELECT c.case_id, c.request_id, c.participant_key, c.revision::text AS revision, c.evidence_facts,
                a.assignment_id, i.email_normalized AS actor_email
           FROM workflow_cases c
           JOIN workflow_assignments a ON a.case_id = c.case_id AND a.role = 'assigned_participant'
            AND a.actor_key = c.participant_key AND a.active
            AND a.identity_issuer = $2 AND a.identity_subject = $3
            AND a.email_normalized = lower(trim($4))
           JOIN verified_identities i ON i.issuer = $2 AND i.subject = $3
            AND i.email_normalized = lower(trim($4)) AND i.email_verified AND i.active
            AND i.actor_key = c.participant_key AND i.role = 'assigned_participant'
           JOIN hosted_participant_links l ON l.case_id = c.case_id AND l.assignment_id = a.assignment_id
            AND l.claimed_issuer = $2 AND l.claimed_subject = $3
            AND l.email_normalized = i.email_normalized AND l.revoked_at IS NULL AND l.expires_at > now()
          WHERE c.case_id = $1
          ORDER BY l.created_at DESC, l.link_id
          LIMIT 1
          FOR UPDATE OF c, a, i, l`,
        [caseId, actor.issuer, actor.subject, actor.verifiedEmail],
      );
      const row = current.rows[0];
      if (!row || actor.actorKey !== row.participant_key) throw new ActionError(403, 'Active verified participant assignment and claimed link required');
      if (row.evidence_facts?.trainerPass !== true) throw new ActionError(409, 'Verified trainer pass is required before acknowledgement');

      const existing = await db.query<StoredResponse>(
        `SELECT response_id, answer, typed_name, revision::text AS revision
           FROM participant_responses WHERE case_id = $1 AND idempotency_key = $2`, [caseId, key],
      );
      if (existing.rowCount) {
        const prior = existing.rows[0]!;
        if (prior.answer !== input.answer || prior.typed_name !== typedName)
          throw new ActionError(409, 'Idempotency key was already used with a different response');
        return { status: 'verified', actionId: 'acceptParticipantAcknowledgement', caseId,
          responseId: prior.response_id, revision: prior.revision, replayed: true };
      }
      const priorForCase = await db.query('SELECT 1 FROM participant_responses WHERE case_id = $1', [caseId]);
      if (priorForCase.rowCount) throw new ActionError(409, 'Participant acknowledgement was already recorded');

      const beforeRevision = row.revision;
      const revision = String(BigInt(beforeRevision) + 1n);
      const responseId = randomUUID();
      await db.query(
        `UPDATE workflow_cases
            SET evidence_facts = evidence_facts || $2::jsonb,
                status = 'acknowledged', revision = $3::bigint, updated_at = now()
          WHERE case_id = $1 AND revision = $4::bigint`,
        [caseId, JSON.stringify({ assignedParticipant: true, participantFormVerified: true, answeredYes: true }), revision, beforeRevision],
      );
      const event = await db.query<{ event_id: string }>(
        `INSERT INTO workflow_events
          (request_id, case_id, action_id, actor_key, actor_role, actor_email, idempotency_key, scope,
           before_revision, after_revision, outcome, details)
         VALUES ($1, $2, 'acceptParticipantAcknowledgement', $3, $4, $5, $6,
           jsonb_build_object('requestId', $1::text, 'sessionId', (SELECT session_id FROM workflow_cases WHERE case_id = $2::text), 'caseId', $2::text),
           $7::bigint, $8::bigint, 'accepted', $9::jsonb)
         RETURNING event_id`,
        [row.request_id, caseId, actor.actorKey, actor.role, row.actor_email, key, beforeRevision, revision,
          JSON.stringify({ responseId, source: 'hosted_participant_response' })],
      );
      await db.query(
        `INSERT INTO participant_responses
          (response_id, case_id, request_id, assignment_id, actor_key, actor_email, identity_issuer, identity_subject,
           idempotency_key, answer, typed_name, source_type, event_id, revision)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'hosted_participant_response', $12, $13::bigint)`,
        [responseId, caseId, row.request_id, row.assignment_id, actor.actorKey, row.actor_email,
          actor.issuer, actor.subject, key, input.answer, typedName, event.rows[0]!.event_id, revision],
      );
      for (const factKey of ['assignedParticipant', 'participantFormVerified', 'answeredYes']) {
        await db.query(
          `INSERT INTO case_evidence (case_id, fact_key, fact_value, source_type, source_id, source_version, observed_at)
           VALUES ($1, $2, true, 'hosted_participant_response', $3, $4, now())`, [caseId, factKey, responseId, revision],
        );
      }
      await db.query(
        `INSERT INTO audit_events
          (actor_key, actor_role, actor_email, operation, request_id, case_id, event_id, outcome, details)
         VALUES ($1, $2, $3, 'workflow.acceptParticipantAcknowledgement', $4, $5, $6, 'accepted', $7::jsonb)`,
        [actor.actorKey, actor.role, row.actor_email, row.request_id, caseId, event.rows[0]!.event_id,
          JSON.stringify({ responseId, revision, idempotencyKey: key, source: 'hosted_participant_response' })],
      );
      return { status: 'verified', actionId: 'acceptParticipantAcknowledgement', caseId, responseId, revision, replayed: false };
    });
  }
}
