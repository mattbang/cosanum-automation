import { createHash, randomBytes } from 'node:crypto';
import type { SqlPool } from './database.ts';
import { inTransaction } from './database.ts';
import { normalizeEmail, type VerifiedClaims } from './identity.ts';
import type { Identity } from './service.ts';

export class ParticipantLinkError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function tokenHash(token: string): Buffer { return createHash('sha256').update(token, 'utf8').digest(); }

/** Links identify an assigned case but never replace a verified account or assignment check. */
export class HostedParticipantLinks {
  constructor(private readonly pool: SqlPool) {}

  async issue(input: {
    caseId: string; assignmentId: number; email: string; expiresAt: Date;
    createdBy: Pick<Identity, 'actorKey' | 'role' | 'verifiedEmail' | 'issuer' | 'subject'>;
  }): Promise<{ token: string; expiresAt: Date }> {
    if (input.createdBy.role !== 'process_quality') throw new ParticipantLinkError(403, 'Process & Quality authorization required');
    if (!input.createdBy.issuer || !input.createdBy.subject) throw new ParticipantLinkError(403, 'Verified owner identity required');
    if (!input.caseId || !Number.isInteger(input.assignmentId) || Number.isNaN(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now())
      throw new ParticipantLinkError(400, 'Invalid case, assignment, or link expiry');
    const email = normalizeEmail(input.email);
    if (!email) throw new ParticipantLinkError(400, 'Assigned email required');
    const token = randomBytes(32).toString('base64url');
    const hash = tokenHash(token);
    await inTransaction(this.pool, async db => {
      const assignment = await db.query<{ assignment_id: string }>(
        `SELECT a.assignment_id
           FROM workflow_assignments a JOIN workflow_cases c ON c.case_id = a.case_id
           JOIN workflow_assignments owner_assignment
             ON owner_assignment.case_id = c.case_id AND owner_assignment.role = 'process_quality'
            AND owner_assignment.actor_key = c.owner_key AND owner_assignment.active
           JOIN verified_identities owner_identity
             ON owner_identity.actor_key = c.owner_key AND owner_identity.role = 'process_quality'
            AND owner_identity.issuer = $5 AND owner_identity.subject = $6
            AND owner_identity.email_normalized = $7 AND owner_identity.active
          WHERE a.assignment_id = $1 AND a.case_id = $2 AND c.case_id = $2
            AND a.role = 'assigned_participant' AND a.active
            AND a.actor_key = c.participant_key
            AND c.owner_key = $4
            AND a.email_normalized = $3
          FOR UPDATE OF a, owner_assignment, owner_identity`,
        [input.assignmentId, input.caseId, email, input.createdBy.actorKey, input.createdBy.issuer, input.createdBy.subject,
          normalizeEmail(input.createdBy.verifiedEmail)],
      );
      if (!assignment.rowCount) throw new ParticipantLinkError(409, 'Active participant assignment does not match this case and email');
      await db.query(
        `INSERT INTO hosted_participant_links
          (case_id, assignment_id, token_hash, email_normalized, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.caseId, input.assignmentId, hash, email, input.expiresAt, input.createdBy.actorKey],
      );
      await db.query(
        `INSERT INTO audit_events (actor_key, actor_role, actor_email, operation, case_id, outcome, details)
         VALUES ($1, $2, $3, 'participant_link.issue', $4, 'accepted', $5::jsonb)`,
        [input.createdBy.actorKey, input.createdBy.role, normalizeEmail(input.createdBy.verifiedEmail), input.caseId,
          JSON.stringify({ assignmentId: input.assignmentId, email, expiresAt: input.expiresAt.toISOString() })],
      );
    });
    return { token, expiresAt: input.expiresAt };
  }

  async revoke(linkId: string, actor: Pick<Identity, 'actorKey' | 'role' | 'verifiedEmail' | 'issuer' | 'subject'>): Promise<boolean> {
    if (actor.role !== 'process_quality') throw new ParticipantLinkError(403, 'Process & Quality authorization required');
    if (!actor.issuer || !actor.subject) throw new ParticipantLinkError(403, 'Verified owner identity required');
    return inTransaction(this.pool, async db => {
      const owner = await db.query<{ link_id: string }>(
        `SELECT l.link_id
           FROM hosted_participant_links l
           JOIN workflow_cases c ON c.case_id = l.case_id AND c.owner_key = $2
           JOIN workflow_assignments a ON a.case_id = c.case_id AND a.role = 'process_quality'
            AND a.actor_key = c.owner_key AND a.active
           JOIN verified_identities i ON i.actor_key = c.owner_key AND i.role = 'process_quality'
            AND i.issuer = $3 AND i.subject = $4 AND i.email_normalized = $5 AND i.active
          WHERE l.link_id = $1 AND l.revoked_at IS NULL
          FOR UPDATE OF l, a, i`,
        [linkId, actor.actorKey, actor.issuer, actor.subject, normalizeEmail(actor.verifiedEmail)],
      );
      if (!owner.rowCount) return false;
      const revoked = await db.query<{ case_id: string }>(
        `UPDATE hosted_participant_links SET revoked_at = now()
          WHERE link_id = $1 AND revoked_at IS NULL RETURNING case_id`, [linkId],
      );
      if (!revoked.rowCount) return false;
      await db.query(
        `INSERT INTO audit_events (actor_key, actor_role, actor_email, operation, case_id, outcome, details)
         VALUES ($1, $2, $3, 'participant_link.revoke', $4, 'accepted', $5::jsonb)`,
        [actor.actorKey, actor.role, normalizeEmail(actor.verifiedEmail), revoked.rows[0]!.case_id, JSON.stringify({ linkId })],
      );
      return true;
    });
  }

  async claim(token: string, claims: VerifiedClaims): Promise<Identity> {
    if (!token || token.length > 256) throw new ParticipantLinkError(401, 'Participant link required');
    if (!claims.issuer || !claims.subject || !claims.email || claims.emailVerified !== true)
      throw new ParticipantLinkError(401, 'Verified account required');
    const email = normalizeEmail(claims.email);
    return inTransaction(this.pool, async db => {
      const match = await db.query<{
        link_id: string; case_id: string; assignment_id: string; email_normalized: string;
        expires_at: Date; revoked_at: Date | null; claimed_issuer: string | null; claimed_subject: string | null;
        actor_key: string; assignment_active: boolean; assignment_issuer: string | null; assignment_subject: string | null;
      }>(
        `SELECT l.link_id, l.case_id, l.assignment_id, l.email_normalized, l.expires_at,
                l.revoked_at, l.claimed_issuer, l.claimed_subject,
                a.identity_issuer AS assignment_issuer, a.identity_subject AS assignment_subject,
                a.actor_key, a.active AS assignment_active
           FROM hosted_participant_links l
           JOIN workflow_assignments a ON a.assignment_id = l.assignment_id AND a.case_id = l.case_id
           JOIN workflow_cases c ON c.case_id = l.case_id AND c.participant_key = a.actor_key
          WHERE l.token_hash = $1 AND a.role = 'assigned_participant' AND a.email_normalized = l.email_normalized
          FOR UPDATE OF l, a`,
        [tokenHash(token)],
      );
      const link = match.rows[0];
      if (!link || link.revoked_at || link.expires_at.getTime() <= Date.now() || !link.assignment_active)
        throw new ParticipantLinkError(401, 'Participant link is invalid, expired, or revoked');
      if (link.email_normalized !== email) throw new ParticipantLinkError(403, 'Verified account does not match assigned participant');
      if (link.claimed_issuer && (link.claimed_issuer !== claims.issuer || link.claimed_subject !== claims.subject))
        throw new ParticipantLinkError(403, 'Participant link is already bound to another verified account');
      if (link.assignment_issuer && (link.assignment_issuer !== claims.issuer || link.assignment_subject !== claims.subject))
        throw new ParticipantLinkError(403, 'Participant assignment is already bound to another verified account');

      const prior = await db.query<{ actor_key: string; role: Identity['role']; email_normalized: string; active: boolean }>(
        'SELECT actor_key, role, email_normalized, active FROM verified_identities WHERE issuer = $1 AND subject = $2 FOR UPDATE',
        [claims.issuer, claims.subject],
      );
      if (prior.rowCount && (prior.rows[0]!.actor_key !== link.actor_key || prior.rows[0]!.role !== 'assigned_participant' || prior.rows[0]!.email_normalized !== email || !prior.rows[0]!.active))
        throw new ParticipantLinkError(403, 'Verified account is already mapped to another identity');

      await db.query(
        `UPDATE hosted_participant_links SET claimed_issuer = $2, claimed_subject = $3, last_claimed_at = now()
          WHERE link_id = $1`, [link.link_id, claims.issuer, claims.subject],
      );
      await db.query(
        `UPDATE workflow_assignments SET identity_issuer = $2, identity_subject = $3, email_normalized = $4
          WHERE assignment_id = $1 AND (identity_issuer IS NULL OR (identity_issuer = $2 AND identity_subject = $3))`,
        [link.assignment_id, claims.issuer, claims.subject, email],
      );
      await db.query(
        `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role)
         VALUES ($1, $2, $3, true, $4, 'assigned_participant')
         ON CONFLICT (issuer, subject) DO UPDATE SET updated_at = now()
         WHERE verified_identities.actor_key = EXCLUDED.actor_key
           AND verified_identities.role = EXCLUDED.role
           AND verified_identities.email_normalized = EXCLUDED.email_normalized`,
        [claims.issuer, claims.subject, email, link.actor_key],
      );
      await db.query(
        `INSERT INTO audit_events (actor_key, actor_role, actor_email, operation, case_id, outcome, details)
         VALUES ($1, 'assigned_participant', $2, 'participant_link.claim', $3, 'accepted', $4::jsonb)`,
        [link.actor_key, email, link.case_id, JSON.stringify({ linkId: link.link_id, issuer: claims.issuer, subject: claims.subject })],
      );
      return { actorKey: link.actor_key, role: 'assigned_participant', verifiedEmail: email };
    });
  }
}
