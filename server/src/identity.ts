import type { QueryResultRow } from 'pg';
import type { SqlExecutor } from './database.ts';
import type { Identity, IdentityProvider } from './service.ts';

export type VerifiedClaims = { issuer: string; subject: string; email: string; emailVerified: boolean };
export interface BearerTokenVerifier { verify(token: string): Promise<VerifiedClaims | null> }

export function normalizeEmail(email: string): string { return email.trim().toLocaleLowerCase('en-US'); }

type IdentityRow = QueryResultRow & { actor_key: string; role: Identity['role']; email_normalized: string; email_verified: boolean; active: boolean };

/** Requires a real verifier to validate signature, issuer, audience, expiry, and verified-email claims. */
export class PostgresIdentityProvider implements IdentityProvider {
  constructor(private readonly db: SqlExecutor, private readonly verifier: BearerTokenVerifier) {}

  async authenticate(token: string): Promise<Identity | null> {
    if (!token) return null;
    const claims = await this.verifier.verify(token);
    if (!claims?.issuer || !claims.subject || !claims.email || claims.emailVerified !== true) return null;
    const email = normalizeEmail(claims.email);
    const result = await this.db.query<IdentityRow>(
      `SELECT actor_key, role, email_normalized, email_verified, active
         FROM verified_identities
        WHERE issuer = $1 AND subject = $2 AND email_normalized = $3`,
      [claims.issuer, claims.subject, email],
    );
    const identity = result.rows[0];
    if (!identity?.active || identity.email_verified !== true) return null;
    return { actorKey: identity.actor_key, role: identity.role, verifiedEmail: email, issuer: claims.issuer, subject: claims.subject };
  }
}
