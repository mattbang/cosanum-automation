import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { MemberClaims, MemberProfile, MemberSource, MemberTaskRef } from './types.ts';
import { MemberError } from './types.ts';

export type StoredMemberSession = {
  hash: string; familyHash: string; generation: number; personKey: string;
  claims: MemberClaims; createdAt: Date; expiresAt: Date;
};
export type StoredMemberChallenge = {
  hash: string; familyHash: string; generation: number; nonceHash: string; expiresAt: Date;
};
export interface MemberSessionStore {
  readonly kind: 'postgres' | 'local-synthetic';
  challenge(input: Omit<StoredMemberChallenge, 'generation'>): Promise<number>;
  consumeChallenge(hash: string, familyHash: string): Promise<StoredMemberChallenge | null>;
  create(session: StoredMemberSession): Promise<boolean>;
  read(hash: string): Promise<StoredMemberSession | null>;
  remove(hash: string): Promise<void>;
  logout(familyHash: string, generation: number): Promise<void>;
}
export interface MemberTokenVerifier { verify(credential: string): Promise<MemberClaims | null> }
export type MemberSessionView = { profile: MemberProfile; expiresAt: string; generation: number };
export const memberHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const validMemberSecret = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const secret = (): string => randomBytes(32).toString('base64url');
const authRequired = (): MemberError => new MemberError(401, 'Bitte erneut mit dem freigegebenen Google-Konto anmelden.');

export class MemberSessions {
  constructor(
    private readonly store: MemberSessionStore,
    private readonly verifier: MemberTokenVerifier,
    private readonly source: MemberSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get storeKind(): MemberSessionStore['kind'] { return this.store.kind; }

  async challenge(browser?: string) {
    const browserId = validMemberSecret(browser) ? browser : secret();
    const challengeId = secret(), nonce = secret();
    const generation = await this.store.challenge({
      hash: memberHash(challengeId), familyHash: memberHash(browserId), nonceHash: memberHash(nonce),
      expiresAt: new Date(this.now().getTime() + 10 * 60_000),
    });
    return { browserId, challengeId, nonce, generation };
  }

  async login(credential: unknown, browser: unknown, challenge: unknown) {
    if (typeof credential !== 'string' || credential.length > 16_384 || !credential ||
        !validMemberSecret(browser) || !validMemberSecret(challenge)) throw authRequired();
    const pending = await this.store.consumeChallenge(memberHash(challenge), memberHash(browser));
    if (!pending || pending.expiresAt.getTime() <= this.now().getTime()) throw authRequired();
    let claims: MemberClaims | null;
    try { claims = await this.verifier.verify(credential); }
    catch { claims = null; }
    if (!claims?.nonce || !validMemberSecret(claims.nonce) ||
        !timingSafeEqual(Buffer.from(memberHash(claims.nonce)), Buffer.from(pending.nonceHash))) throw authRequired();
    const profile = await this.source.profile(claims);
    const token = secret(), createdAt = this.now();
    const { nonce: _nonce, ...retainedClaims } = claims;
    const record: StoredMemberSession = {
      hash: memberHash(token), familyHash: pending.familyHash, generation: pending.generation,
      personKey: profile.personKey, claims: retainedClaims, createdAt,
      expiresAt: new Date(createdAt.getTime() + 8 * 60 * 60_000),
    };
    if (!await this.store.create(record)) throw authRequired();
    return { token, view: this.view(record, profile) };
  }

  private async authenticated(token: unknown, browser: unknown): Promise<StoredMemberSession> {
    if (!validMemberSecret(token) || !validMemberSecret(browser)) throw authRequired();
    const record = await this.store.read(memberHash(token));
    if (!record || record.familyHash !== memberHash(browser) || record.expiresAt.getTime() <= this.now().getTime()) throw authRequired();
    return record;
  }

  private async current<T extends { profile: MemberProfile }>(record: StoredMemberSession, operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      if (result.profile.personKey !== record.personKey || result.profile.email !== record.claims.email) throw authRequired();
      const stillCurrent = await this.store.read(record.hash);
      if (!stillCurrent || stillCurrent.generation !== record.generation ||
          stillCurrent.expiresAt.getTime() <= this.now().getTime()) throw authRequired();
      return result;
    } catch (error) {
      if (error instanceof MemberError && (error.status === 401 || error.status === 403)) await this.store.remove(record.hash);
      throw error;
    }
  }

  private view(record: StoredMemberSession, profile: MemberProfile): MemberSessionView {
    return { profile, expiresAt: record.expiresAt.toISOString(), generation: record.generation };
  }

  async restore(token: unknown, browser: unknown): Promise<MemberSessionView> {
    const record = await this.authenticated(token, browser);
    const result = await this.current(record, async () => ({ profile: await this.source.profile(record.claims) }));
    return this.view(record, result.profile);
  }

  async tasks(token: unknown, browser: unknown) {
    const record = await this.authenticated(token, browser);
    return this.current(record, () => this.source.tasks(record.claims));
  }

  async open(token: unknown, browser: unknown, task: MemberTaskRef) {
    const record = await this.authenticated(token, browser);
    const result = await this.current(record, async () => {
      const opened = await this.source.open(record.claims, task);
      return { ...opened, profile: await this.source.profile(record.claims) };
    });
    return { url: result.url, checkedAt: result.checkedAt };
  }

  async logout(browser: unknown, generation: unknown) {
    if (!Number.isSafeInteger(generation) || Number(generation) < 0 || Number(generation) >= Number.MAX_SAFE_INTEGER)
      throw new MemberError(400, 'Die Abmeldung konnte nicht zugeordnet werden.');
    if (validMemberSecret(browser)) await this.store.logout(memberHash(browser), Number(generation));
    return { signedOut: true as const };
  }
}

export class LocalSyntheticMemberSessionStore implements MemberSessionStore {
  readonly kind = 'local-synthetic' as const;
  private families = new Map<string, number>();
  private challenges = new Map<string, StoredMemberChallenge>();
  private sessions = new Map<string, StoredMemberSession>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  async challenge(input: Omit<StoredMemberChallenge, 'generation'>): Promise<number> {
    const generation = this.families.get(input.familyHash) ?? 0;
    this.families.set(input.familyHash, generation);
    for (const [key, value] of this.challenges) if (value.expiresAt <= this.now()) this.challenges.delete(key);
    const existing = [...this.challenges.values()].filter(value => value.familyHash === input.familyHash);
    for (const value of existing.slice(0, Math.max(0, existing.length - 7))) this.challenges.delete(value.hash);
    this.challenges.set(input.hash, { ...input, generation });
    return generation;
  }

  async consumeChallenge(hash: string, familyHash: string): Promise<StoredMemberChallenge | null> {
    const value = this.challenges.get(hash);
    if (!value || value.familyHash !== familyHash) return null;
    this.challenges.delete(hash);
    return structuredClone(value);
  }

  async create(session: StoredMemberSession): Promise<boolean> {
    if (this.families.get(session.familyHash) !== session.generation) return false;
    for (const [key, value] of this.sessions) if (value.expiresAt <= this.now()) this.sessions.delete(key);
    const existing = [...this.sessions.values()].filter(value => value.familyHash === session.familyHash);
    for (const value of existing.slice(0, Math.max(0, existing.length - 19))) this.sessions.delete(value.hash);
    this.sessions.set(session.hash, structuredClone(session));
    return true;
  }

  async read(hash: string): Promise<StoredMemberSession | null> {
    const value = this.sessions.get(hash);
    return value && value.expiresAt > this.now() && this.families.get(value.familyHash) === value.generation ? structuredClone(value) : null;
  }
  async remove(hash: string): Promise<void> { this.sessions.delete(hash); }
  async logout(familyHash: string, generation: number): Promise<void> {
    const current = this.families.get(familyHash);
    if (current === undefined || current > generation) return;
    if (current < generation) throw new MemberError(409, 'Die Abmeldung gehört nicht zur aktuellen Sitzung.');
    this.families.set(familyHash, current + 1);
    for (const [key, value] of this.sessions) if (value.familyHash === familyHash) this.sessions.delete(key);
    for (const [key, value] of this.challenges) if (value.familyHash === familyHash) this.challenges.delete(key);
  }
}
