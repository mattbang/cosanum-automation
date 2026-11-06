import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemberGrant, MemberRole } from './types.ts';

export type MemberRuntimeConfig = {
  version: 1; approved: true; origin: string; googleClientId: string; spreadsheetId: string; members: MemberGrant[];
};
const roles: MemberRole[] = ['assigned_trainer', 'assigned_participant'];

export function validateMemberConfig(value: unknown): MemberRuntimeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Member configuration must be an object');
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || data.approved !== true) throw new Error('Member access configuration has not been approved');
  let origin: URL;
  try { origin = new URL(String(data.origin)); }
  catch { throw new Error('An approved member HTTPS origin is required'); }
  if (origin.protocol !== 'https:' || origin.origin !== data.origin || origin.username || origin.password)
    throw new Error('An exact approved member HTTPS origin is required');
  if (typeof data.googleClientId !== 'string' || !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(data.googleClientId))
    throw new Error('An approved Google web client is required');
  if (typeof data.spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{20,160}$/.test(data.spreadsheetId))
    throw new Error('An approved private training workbook is required');
  if (!Array.isArray(data.members) || !data.members.length || data.members.length > 200)
    throw new Error('An explicit member grant list is required');
  const keys = new Set<string>(), subjects = new Set<string>();
  const members = data.members.map((item: unknown): MemberGrant => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid member grant');
    const grant = item as Record<string, unknown>;
    if (typeof grant.personKey !== 'string' || !/^[A-Z][A-Z0-9_-]{0,79}$/.test(grant.personKey) || keys.has(grant.personKey))
      throw new Error('Member person keys must be unique and valid');
    if (typeof grant.active !== 'boolean' || !Array.isArray(grant.roles) || !grant.roles.length ||
        grant.roles.some(role => !roles.includes(role)) || new Set(grant.roles).size !== grant.roles.length)
      throw new Error('Member roles and activation must be explicit');
    if (grant.subject !== undefined && (typeof grant.subject !== 'string' || !/^[A-Za-z0-9._-]{1,255}$/.test(grant.subject) || subjects.has(grant.subject)))
      throw new Error('Pinned Google subjects must be unique and valid');
    keys.add(grant.personKey);
    if (typeof grant.subject === 'string') subjects.add(grant.subject);
    return { personKey: grant.personKey, active: grant.active, roles: [...grant.roles] as MemberRole[],
      ...(typeof grant.subject === 'string' ? { subject: grant.subject } : {}) };
  });
  return { version: 1, approved: true, origin: origin.origin, googleClientId: data.googleClientId, spreadsheetId: data.spreadsheetId, members };
}

export async function loadMemberConfig(path: string): Promise<MemberRuntimeConfig> {
  if (!isAbsolute(path)) throw new Error('Member configuration must use an absolute private path');
  const selected = resolve(path), metadata = await lstat(selected);
  if (!metadata.isFile() || ![0o400, 0o600].includes(metadata.mode & 0o777) ||
      (typeof process.getuid === 'function' && metadata.uid !== process.getuid()))
    throw new Error('Member configuration must be an owner-private regular file');
  const [actual, repository] = await Promise.all([realpath(selected), realpath(fileURLToPath(new URL('../../../', import.meta.url)))]);
  const fromRepository = relative(repository, actual);
  if (!fromRepository || (!fromRepository.startsWith('..') && !isAbsolute(fromRepository)))
    throw new Error('Member configuration must remain outside the repository');
  let data: unknown;
  try { data = JSON.parse(await readFile(actual, 'utf8')); }
  catch { throw new Error('Member configuration is not valid JSON'); }
  return validateMemberConfig(data);
}
