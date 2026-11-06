import { MemberError, type MemberClaims, type MemberGrant, type MemberProfile, type MemberSource, type MemberTaskList, type MemberTaskRef } from './types.ts';
import { email, memberSchema, memberTableNames, projectMemberTasks, scopedFormIds, text, validEmail, validIdentifier, validateMemberTables,
  type FormMetadata, type LiveForm, type MemberCell, type MemberTables } from './tasks.ts';
export type { FormMetadata, MemberCell, MemberRow, MemberTables, MemberTableName } from './tasks.ts';

export type GoogleTrainingTransport = { get<T>(url: string): Promise<T> };
type ValueRange = { range?: string; values?: MemberCell[][] };
type BatchValues = { spreadsheetId?: string; valueRanges?: ValueRange[] };

/** Read-only Google client; transport intentionally exposes no mutation method. */
export class GoogleTrainingReader {
  constructor(private readonly transport: GoogleTrainingTransport, private readonly spreadsheetId: string) {
    if (!validIdentifier(spreadsheetId)) throw new MemberError(503, 'Die private Schulungsquelle ist nicht konfiguriert.');
  }

  async readTables(): Promise<MemberTables> {
    try {
      const schema = memberSchema();
      const query = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
      for (const name of memberTableNames) query.append('ranges', `'${name}'`);
      const response = await this.transport.get<BatchValues>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values:batchGet?${query}`);
      if (!response || response.spreadsheetId !== this.spreadsheetId || !Array.isArray(response.valueRanges) || response.valueRanges.length !== memberTableNames.length) throw new Error('Incomplete workbook');
      const tables = {} as MemberTables;
      for (const range of response.valueRanges) {
        const sheetName = typeof range.range === 'string' ? /^'?([A-Za-z]+)'?!/.exec(range.range)?.[1] : undefined;
        if (!memberTableNames.includes(sheetName as typeof memberTableNames[number]) || Object.hasOwn(tables, sheetName!)) throw new Error('Wrong or duplicate tab');
        const name = sheetName as typeof memberTableNames[number];
        const headers = schema[name];
        if (!Array.isArray(range.values) || !Array.isArray(range.values[0]) || range.values[0].length !== headers.length ||
            headers.some((header, index) => range.values![0][index] !== header)) throw new Error('Incompatible headers');
        tables[name] = [];
        for (const values of range.values.slice(1)) {
          if (!Array.isArray(values) || values.length > headers.length || values.some(value => !['string', 'number', 'boolean'].includes(typeof value))) throw new Error('Invalid row');
          if (values.every(value => value === '')) continue;
          if (values[0] === '' || values[0] === undefined) throw new Error('Orphan row');
          tables[name].push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
        }
      }
      return validateMemberTables(tables);
    } catch { throw new MemberError(503, 'Die privaten Google-Schulungsdaten sind derzeit nicht verfügbar.'); }
  }

  async readForm(formId: string): Promise<FormMetadata> {
    try {
      if (!validIdentifier(formId)) throw new Error('Invalid form ID');
      const metadata = await this.transport.get<FormMetadata>(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}?fields=formId,responderUri,settings.emailCollectionType`);
      if (!metadata || metadata.formId !== formId || typeof metadata.responderUri !== 'string' ||
          !metadata.settings || typeof metadata.settings.emailCollectionType !== 'string') throw new Error('Incomplete form metadata');
      return { formId: metadata.formId, responderUri: metadata.responderUri, settings: { emailCollectionType: metadata.settings.emailCollectionType } };
    } catch { throw new MemberError(503, 'Die aktuelle Google-Formularprüfung ist derzeit nicht verfügbar.'); }
  }
}

export type GoogleSheetMemberSourceOptions = {
  readTables: () => Promise<MemberTables>;
  readForm: (formId: string) => Promise<FormMetadata>;
  grants: MemberGrant[] | (() => Promise<MemberGrant[]> | MemberGrant[]);
  now?: () => Date;
};

function authorizedProfile(tables: MemberTables, claims: MemberClaims, grants: MemberGrant[]): MemberProfile {
  if (!claims || claims.issuer !== 'https://accounts.google.com' || claims.emailVerified !== true ||
      !text(claims.subject).trim() || !validEmail(email(claims.email))) throw new MemberError(401, 'Bitte mit einem verifizierten Google-Konto anmelden.');
  if (!Array.isArray(grants)) throw new MemberError(503, 'Die persönlichen Zugriffsrechte sind derzeit nicht verfügbar.');
  const seen = new Set<string>();
  const subjects = new Set<string>();
  for (const grant of grants) {
    if (!grant || !validIdentifier(grant.personKey) || typeof grant.active !== 'boolean' || !Array.isArray(grant.roles) ||
        !grant.roles.length || grant.roles.some(role => !['assigned_trainer', 'assigned_participant'].includes(role)) ||
        new Set(grant.roles).size !== grant.roles.length || seen.has(grant.personKey) ||
        (grant.subject !== undefined && (typeof grant.subject !== 'string' || !grant.subject.trim() || subjects.has(grant.subject))) ||
        tables.People.filter(row => row.person_key === grant.personKey).length !== 1) {
      throw new MemberError(503, 'Die persönlichen Zugriffsrechte sind widersprüchlich.');
    }
    seen.add(grant.personKey);
    if (grant.subject) subjects.add(grant.subject);
  }
  const people = tables.People.filter(row => email(row.email) === email(claims.email));
  if (people.length !== 1) throw new MemberError(403, 'Dieses Google-Konto hat keinen persönlichen Schulungszugang.');
  const person = people[0];
  const grant = grants.find(item => item.personKey === person.person_key);
  if (!grant?.active || (grant.subject && grant.subject !== claims.subject)) throw new MemberError(403, 'Dieses Google-Konto hat keinen aktiven persönlichen Schulungszugang.');
  const domain = email(claims.email).split('@')[1];
  const googleAuthoritative = domain === 'gmail.com' || domain === 'googlemail.com' ||
    (!!claims.hostedDomain && claims.hostedDomain.toLowerCase() === domain);
  if (!googleAuthoritative && grant.subject !== claims.subject) throw new MemberError(403, 'Dieses Konto benötigt eine bestätigte persönliche Kontozuordnung.');
  const displayName = text(person.display_alias).trim();
  return { personKey: text(person.person_key), displayName, email: email(person.email),
    initials: displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => [...part][0]).join('').toUpperCase(),
    roles: [...grant.roles] };
}

export class GoogleSheetMemberSource implements MemberSource {
  private readonly now: () => Date;
  constructor(private readonly options: GoogleSheetMemberSourceOptions) { this.now = options.now ?? (() => new Date()); }

  private async snapshot(claims: MemberClaims): Promise<{ tables: MemberTables; profile: MemberProfile; now: Date }> {
    try {
      const [raw, grants] = await Promise.all([this.options.readTables(),
        typeof this.options.grants === 'function' ? this.options.grants() : this.options.grants]);
      const tables = validateMemberTables(raw);
      const profile = authorizedProfile(tables, claims, structuredClone(grants));
      const now = this.now();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Clock unavailable');
      return { tables, profile, now };
    } catch (error) {
      if (error instanceof MemberError) throw error;
      throw new MemberError(503, 'Der persönliche Schulungszugang kann derzeit nicht geprüft werden.');
    }
  }

  private async projection(tables: MemberTables, profile: MemberProfile, now: Date) {
    const live = new Map<string, LiveForm>();
    await Promise.all(scopedFormIds(tables, profile).map(async formId => {
      try { live.set(formId, { metadata: await this.options.readForm(formId) }); }
      catch { live.set(formId, { unavailable: true }); }
    }));
    try { return projectMemberTasks(tables, profile, live, now); }
    catch (error) {
      if (error instanceof MemberError) throw error;
      throw new MemberError(503, 'Die persönlichen Schulungsaufgaben sind derzeit nicht verfügbar.');
    }
  }

  async profile(claims: MemberClaims): Promise<MemberProfile> { return (await this.snapshot(claims)).profile; }

  async tasks(claims: MemberClaims): Promise<MemberTaskList> {
    const { tables, profile, now } = await this.snapshot(claims);
    const items = await this.projection(tables, profile, now);
    return { profile, tasks: items.map(item => item.task), checkedAt: now.toISOString() };
  }

  async open(claims: MemberClaims, ref: MemberTaskRef): Promise<{ url: string; checkedAt: string }> {
    if (!ref || !['assigned_trainer', 'assigned_participant'].includes(ref.role) || !validIdentifier(ref.caseId) ||
        !validIdentifier(ref.sessionId) || (ref.action !== 'open_trainer_form' && ref.action !== 'open_participant_form')) {
      throw new MemberError(403, 'Diese persönliche Aufgabe ist nicht freigegeben.');
    }
    const { tables, profile, now } = await this.snapshot(claims);
    if (!profile.roles.includes(ref.role) || ref.action !== (ref.role === 'assigned_trainer' ? 'open_trainer_form' : 'open_participant_form')) {
      throw new MemberError(403, 'Diese persönliche Aufgabe ist nicht freigegeben.');
    }
    const link = tables.SessionCases.find(row => row.session_id === ref.sessionId && row.case_id === ref.caseId);
    const session = tables.Sessions.find(row => row.session_id === ref.sessionId);
    if (!link || !session || (ref.role === 'assigned_participant' ? link.person_key !== profile.personKey : session.trainer_key !== profile.personKey)) {
      throw new MemberError(403, 'Diese persönliche Aufgabe ist nicht mehr zugewiesen.');
    }
    const items = await this.projection(tables, profile, now);
    const item = items.find(item => item.task.role === ref.role && item.task.caseId === ref.caseId && item.task.sessionId === ref.sessionId);
    if (item?.metadataUnavailable) throw new MemberError(503, 'Die aktuelle Google-Formularprüfung ist nicht verfügbar. Bitte später erneut versuchen.');
    if (!item?.url || item.task.state !== 'ready' || item.task.action?.id !== ref.action) {
      throw new MemberError(403, 'Diese Aufgabe ist derzeit nicht zur Abgabe freigegeben.');
    }
    return { url: item.url, checkedAt: now.toISOString() };
  }
}
