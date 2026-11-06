import { GoogleAuth } from 'google-auth-library';
import type { SqlPool } from '../database.ts';
import { loadMemberConfig } from './config.ts';
import { GoogleMemberTokenVerifier } from './google-identity.ts';
import { createMemberHandler } from './http.ts';
import { PostgresMemberSessionStore } from './postgres-sessions.ts';
import { MemberSessions } from './sessions.ts';
import { GoogleSheetMemberSource, GoogleTrainingReader } from './source.ts';
import { MemberError } from './types.ts';

export const MEMBER_GOOGLE_READ_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/forms.body.readonly',
]);

export async function createConfiguredMemberHandler(configPath: string, pool: SqlPool) {
  const config = await loadMemberConfig(configPath);
  const auth = new GoogleAuth({ scopes: [...MEMBER_GOOGLE_READ_SCOPES] });
  const reader = new GoogleTrainingReader({
    async get<T>(address: string): Promise<T> {
      const url = new URL(address);
      const sheets = url.hostname === 'sheets.googleapis.com' && url.pathname === `/v4/spreadsheets/${config.spreadsheetId}/values:batchGet`;
      const forms = url.hostname === 'forms.googleapis.com' && /^\/v1\/forms\/[A-Za-z0-9_-]+$/.test(url.pathname);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || (!sheets && !forms))
        throw new MemberError(503, 'Die freigegebene Google-Quelle konnte nicht geprüft werden.');
      try {
        const client = await auth.getClient();
        const result = await client.request<T>({ url: url.href, method: 'GET', timeout: 15_000 });
        return result.data;
      } catch { throw new MemberError(503, 'Die freigegebenen Google-Daten sind derzeit nicht erreichbar.'); }
    },
  }, config.spreadsheetId);
  const source = new GoogleSheetMemberSource({
    readTables: () => reader.readTables(), readForm: (id: string) => reader.readForm(id),
    grants: async () => {
      const current = await loadMemberConfig(configPath);
      if (current.origin !== config.origin || current.googleClientId !== config.googleClientId || current.spreadsheetId !== config.spreadsheetId)
        throw new MemberError(503, 'Die Freigabe wurde geändert. Bitte Process & Quality kontaktieren.');
      return current.members;
    },
  });
  const sessions = new MemberSessions(new PostgresMemberSessionStore(pool), new GoogleMemberTokenVerifier(config.googleClientId), source);
  return createMemberHandler({ origin: config.origin, googleClientId: config.googleClientId, sessions });
}
