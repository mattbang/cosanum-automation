import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import type { MemberTokenVerifier } from './sessions.ts';
import type { MemberClaims } from './types.ts';

type IdTokenClient = {
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): TokenPayload | undefined }>;
};

export class GoogleMemberTokenVerifier implements MemberTokenVerifier {
  constructor(
    private readonly clientId: string,
    private readonly client: IdTokenClient = new OAuth2Client(),
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('An approved Google web client is required');
  }

  async verify(credential: string): Promise<MemberClaims | null> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience: this.clientId });
      const payload = ticket.getPayload() as (TokenPayload & { nonce?: unknown }) | undefined;
      const now = this.now().getTime() / 1000;
      if (!payload || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
          payload.aud !== this.clientId || (payload.azp && payload.azp !== this.clientId) ||
          !payload.sub || !/^[A-Za-z0-9._-]{1,255}$/.test(payload.sub) ||
          payload.email_verified !== true || typeof payload.email !== 'string' ||
          payload.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
          !Number.isFinite(payload.exp) || payload.exp <= now ||
          !Number.isFinite(payload.iat) || payload.iat > now + 60 ||
          typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce)) return null;
      return {
        issuer: 'https://accounts.google.com', subject: payload.sub,
        email: payload.email.trim().toLocaleLowerCase('en-US'), emailVerified: true, nonce: payload.nonce,
        ...(payload.hd ? { hostedDomain: payload.hd.toLocaleLowerCase('en-US') } : {}),
      };
    } catch { return null; }
  }
}
