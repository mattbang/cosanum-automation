import type { QueryResultRow } from 'pg';
import { inTransaction, type SqlPool } from '../database.ts';
import { MemberError, type MemberClaims } from './types.ts';
import type { MemberSessionStore, StoredMemberChallenge, StoredMemberSession } from './sessions.ts';

type ChallengeRow = QueryResultRow & { challenge_hash: string; family_hash: string; generation: string; nonce_hash: string; expires_at: Date };
type SessionRow = QueryResultRow & { session_hash: string; family_hash: string; generation: string; person_key: string; claims: MemberClaims; created_at: Date; expires_at: Date };

export class PostgresMemberSessionStore implements MemberSessionStore {
  readonly kind = 'postgres' as const;
  constructor(private readonly pool: SqlPool) {}

  async challenge(input: Omit<StoredMemberChallenge, 'generation'>): Promise<number> {
    return inTransaction(this.pool, async db => {
      await db.query('INSERT INTO member_browser_families (family_hash) VALUES ($1) ON CONFLICT DO NOTHING', [input.familyHash]);
      const current = await db.query<{ generation: string }>('SELECT generation::text FROM member_browser_families WHERE family_hash=$1 FOR UPDATE', [input.familyHash]);
      const generation = Number(current.rows[0]!.generation);
      await db.query('DELETE FROM member_auth_challenges WHERE expires_at <= now()');
      await db.query(`DELETE FROM member_auth_challenges WHERE challenge_hash IN (
        SELECT challenge_hash FROM member_auth_challenges WHERE family_hash=$1 ORDER BY created_at DESC, challenge_hash OFFSET 7)`, [input.familyHash]);
      await db.query(`INSERT INTO member_auth_challenges (challenge_hash,family_hash,generation,nonce_hash,expires_at)
        VALUES ($1,$2,$3,$4,$5)`, [input.hash, input.familyHash, generation, input.nonceHash, input.expiresAt]);
      return generation;
    });
  }

  async consumeChallenge(hash: string, familyHash: string): Promise<StoredMemberChallenge | null> {
    const result = await this.pool.query<ChallengeRow>(`DELETE FROM member_auth_challenges WHERE challenge_hash=$1 AND family_hash=$2
      RETURNING challenge_hash,family_hash,generation::text,nonce_hash,expires_at`, [hash, familyHash]);
    const row = result.rows[0];
    return row ? { hash: row.challenge_hash, familyHash: row.family_hash, generation: Number(row.generation), nonceHash: row.nonce_hash, expiresAt: row.expires_at } : null;
  }

  async create(session: StoredMemberSession): Promise<boolean> {
    return inTransaction(this.pool, async db => {
      const result = await db.query<{ generation: string }>('SELECT generation::text FROM member_browser_families WHERE family_hash=$1 FOR UPDATE', [session.familyHash]);
      if (!result.rows[0] || Number(result.rows[0].generation) !== session.generation) return false;
      await db.query('DELETE FROM member_sessions WHERE expires_at <= now()');
      await db.query(`DELETE FROM member_sessions WHERE session_hash IN (
        SELECT session_hash FROM member_sessions WHERE family_hash=$1 ORDER BY created_at DESC,session_hash OFFSET 19)`, [session.familyHash]);
      await db.query(`INSERT INTO member_sessions (session_hash,family_hash,generation,person_key,claims,created_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [session.hash, session.familyHash, session.generation, session.personKey, JSON.stringify(session.claims), session.createdAt, session.expiresAt]);
      return true;
    });
  }

  async read(hash: string): Promise<StoredMemberSession | null> {
    const result = await this.pool.query<SessionRow>(`SELECT s.session_hash,s.family_hash,s.generation::text,s.person_key,s.claims,s.created_at,s.expires_at
      FROM member_sessions s JOIN member_browser_families f ON f.family_hash=s.family_hash AND f.generation=s.generation
      WHERE s.session_hash=$1 AND s.expires_at>now()`, [hash]);
    const row = result.rows[0];
    return row ? { hash: row.session_hash, familyHash: row.family_hash, generation: Number(row.generation), personKey: row.person_key,
      claims: row.claims, createdAt: row.created_at, expiresAt: row.expires_at } : null;
  }

  async remove(hash: string): Promise<void> { await this.pool.query('DELETE FROM member_sessions WHERE session_hash=$1', [hash]); }

  async logout(familyHash: string, generation: number): Promise<void> {
    await inTransaction(this.pool, async db => {
      const result = await db.query<{ generation: string }>('SELECT generation::text FROM member_browser_families WHERE family_hash=$1 FOR UPDATE', [familyHash]);
      if (!result.rows[0] || Number(result.rows[0].generation) > generation) return;
      if (Number(result.rows[0].generation) < generation) throw new MemberError(409, 'Die Abmeldung gehört nicht zur aktuellen Sitzung.');
      await db.query('UPDATE member_browser_families SET generation=generation+1 WHERE family_hash=$1', [familyHash]);
      await db.query('DELETE FROM member_sessions WHERE family_hash=$1', [familyHash]);
      await db.query('DELETE FROM member_auth_challenges WHERE family_hash=$1', [familyHash]);
    });
  }
}
