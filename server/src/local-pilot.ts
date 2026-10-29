import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './app.ts';
import { createDatabasePool, inTransaction, verifyMigrations, type SqlPool } from './database.ts';
import { PostgresIdentityProvider, normalizeEmail, type BearerTokenVerifier, type VerifiedClaims } from './identity.ts';
import { HostedParticipantLinks } from './participant-links.ts';
import { PostgresProcessQualityDashboard } from './postgres-dashboard.ts';
import { PostgresWorkflowGateway } from './postgres-gateway.ts';
import { PostgresWorkflowRepository } from './postgres-workflows.ts';
import { ActionError, type Identity } from './service.ts';

/** A local, synthetic identity is deliberately unrelated to a real Google account. */
export type LocalPilotIdentity = {
  issuer: string;
  subject: string;
  email: string;
  actorKey: string;
  role: Exclude<Identity['role'], 'system'>;
  token: string;
};

export type LocalPilotConfig = {
  kind: 'cosanum-local-synthetic-v1';
  identities: LocalPilotIdentity[];
};

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ISSUER = 'https://cosanum-local.test';

function isInside(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return difference === '' || (difference !== '..' && !difference.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(difference));
}

function checkedConfigPath(path: string): string {
  if (!isAbsolute(path)) throw new Error('Local pilot config path must be absolute');
  return resolve(path);
}

function validateConfig(value: unknown): LocalPilotConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local pilot config');
  const input = value as Record<string, unknown>;
  if (input.kind !== 'cosanum-local-synthetic-v1' || !Array.isArray(input.identities) || input.identities.length < 2 || input.identities.length > 20)
    throw new Error('Invalid local pilot config');
  const identities: LocalPilotIdentity[] = [];
  const subjects = new Set<string>();
  const emails = new Set<string>();
  const actors = new Set<string>();
  const tokenHashes = new Set<string>();
  for (const item of input.identities) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid local pilot identity');
    const row = item as Record<string, unknown>;
    const email = typeof row.email === 'string' ? normalizeEmail(row.email) : '';
    if (row.issuer !== ISSUER || typeof row.subject !== 'string' || !/^[a-z][a-z0-9_-]{1,63}$/.test(row.subject) ||
        typeof row.actorKey !== 'string' || !/^[A-Z][A-Z0-9_-]{1,63}$/.test(row.actorKey) ||
        !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.test$/.test(email) ||
        !['process_quality', 'assigned_trainer', 'assigned_participant'].includes(String(row.role)) ||
        typeof row.token !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(row.token))
      throw new Error('Invalid local pilot identity');
    const tokenHash = createHash('sha256').update(row.token).digest('hex');
    if (subjects.has(row.subject) || emails.has(email) || actors.has(row.actorKey) || tokenHashes.has(tokenHash))
      throw new Error('Duplicate local pilot identity');
    subjects.add(row.subject);
    emails.add(email);
    actors.add(row.actorKey);
    tokenHashes.add(tokenHash);
    identities.push({ issuer: ISSUER, subject: row.subject, email, actorKey: row.actorKey,
      role: row.role as LocalPilotIdentity['role'], token: row.token });
  }
  if (!identities.some(identity => identity.role === 'process_quality') || !identities.some(identity => identity.role === 'assigned_participant'))
    throw new Error('Local pilot needs Process & Quality and participant identities');
  return { kind: 'cosanum-local-synthetic-v1', identities };
}

/** Rejects non-loopback endpoints, including libpq query parameter host overrides. */
export function validateLocalDatabaseUrl(connectionString: string): string {
  let parsed: URL;
  try { parsed = new URL(connectionString); }
  catch { throw new Error('Local pilot requires a loopback PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !['127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.search || parsed.hash || !parsed.pathname || parsed.pathname === '/')
    throw new Error('Local pilot requires a loopback PostgreSQL URL without connection options');
  return connectionString;
}

/** Reads only an owner-private regular file outside this repository. */
export async function loadLocalPilotConfig(path: string): Promise<LocalPilotConfig> {
  const selected = checkedConfigPath(path);
  const metadata = await lstat(selected);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || (typeof process.getuid === 'function' && metadata.uid !== process.getuid()))
    throw new Error('Local pilot config must be an owner-owned 0600 regular file');
  const [actual, repository] = await Promise.all([realpath(selected), realpath(REPOSITORY)]);
  if (isInside(repository, actual)) throw new Error('Local pilot config must be outside the repository');
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(selected, 'utf8')); }
  catch { throw new Error('Invalid local pilot config JSON'); }
  return validateConfig(parsed);
}

/** Creates the private file once; tokens are never printed or returned to the console. */
export async function initializeLocalPilotConfig(path: string): Promise<void> {
  const selected = checkedConfigPath(path);
  const [parent, repository] = await Promise.all([realpath(dirname(selected)), realpath(REPOSITORY)]);
  if (isInside(repository, parent)) throw new Error('Local pilot config must be outside the repository');
  const identity = (subject: string, email: string, actorKey: string, role: LocalPilotIdentity['role']): LocalPilotIdentity => ({
    issuer: ISSUER, subject, email, actorKey, role, token: randomBytes(32).toString('base64url'),
  });
  const config: LocalPilotConfig = {
    kind: 'cosanum-local-synthetic-v1',
    identities: [
      identity('daniel', 'daniel@cosanum.test', 'DANIEL', 'process_quality'),
      identity('matthew', 'matthew@cosanum.test', 'MATTHEW', 'assigned_participant'),
      identity('hcm4', 'hcm4@cosanum.test', 'HCM4', 'assigned_trainer'),
    ],
  };
  const handle = await open(selected, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
  } catch (error) {
    await handle.close();
    await unlink(selected).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

export async function seedLocalPilotIdentities(pool: SqlPool, source: LocalPilotConfig): Promise<void> {
  const config = validateConfig(source);
  await inTransaction(pool, async db => {
    for (const identity of config.identities) {
      await db.query(
        `INSERT INTO verified_identities (issuer, subject, email_normalized, email_verified, actor_key, role, active)
         VALUES ($1, $2, $3, true, $4, $5, true)
         ON CONFLICT DO NOTHING`,
        [identity.issuer, identity.subject, identity.email, identity.actorKey, identity.role],
      );
      const result = await db.query<{
        email_normalized: string; email_verified: boolean; actor_key: string; role: Identity['role']; active: boolean;
      }>('SELECT email_normalized, email_verified, actor_key, role, active FROM verified_identities WHERE issuer = $1 AND subject = $2',
        [identity.issuer, identity.subject]);
      const saved = result.rows[0];
      if (!saved || saved.email_normalized !== identity.email || saved.email_verified !== true || saved.actor_key !== identity.actorKey ||
          saved.role !== identity.role || saved.active !== true)
        throw new Error('Local pilot identity conflicts with an existing database identity');
    }
  });
}

function localVerifier(source: LocalPilotConfig): BearerTokenVerifier {
  const config = validateConfig(source);
  const entries = config.identities.map(identity => ({
    digest: createHash('sha256').update(identity.token).digest(),
    claims: { issuer: identity.issuer, subject: identity.subject, email: identity.email, emailVerified: true } satisfies VerifiedClaims,
  }));
  return {
    async verify(token) {
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) return null;
      const digest = createHash('sha256').update(token).digest();
      let match: VerifiedClaims | null = null;
      for (const entry of entries) if (timingSafeEqual(digest, entry.digest)) match = entry.claims;
      return match;
    },
  };
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

/** Local-only API composition. External writes cannot return evidence or modify case history. */
export function createLocalPilotHandler(pool: SqlPool, source: LocalPilotConfig) {
  const verifier = localVerifier(source);
  const api = createApiHandler({
    tokenVerifier: verifier,
    identities: new PostgresIdentityProvider(pool, verifier),
    gateway: new PostgresWorkflowGateway(pool, {
      async execute() { throw new ActionError(503, 'External Calendar, Sheets, mail, and skill actions are disabled in the local pilot'); },
    }),
    requests: new PostgresWorkflowRepository(pool),
    participantLinks: new HostedParticipantLinks(pool),
    processQualityDashboard: new PostgresProcessQualityDashboard(pool),
  });
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method === 'GET' && new URL(request.url || '/', 'http://localhost').pathname === '/health') {
      try {
        await pool.query('SELECT 1');
        respond(response, 200, { status: 'ready', mode: 'local_synthetic', database: 'ready', externalActions: 'disabled' });
      } catch {
        respond(response, 503, { status: 'unavailable', mode: 'local_synthetic', database: 'unavailable' });
      }
      return;
    }
    await api(request, response);
  };
}

export async function startLocalPilot(configPath: string, connectionString: string, port = 8788): Promise<{
  close(): Promise<void>;
  port: number;
}> {
  const config = await loadLocalPilotConfig(configPath);
  validateLocalDatabaseUrl(connectionString);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local pilot port');
  const pool = createDatabasePool(connectionString);
  try {
    await pool.query('SELECT 1');
    await verifyMigrations(pool);
    await seedLocalPilotIdentities(pool, config);
    const server = createServer(createLocalPilotHandler(pool, config));
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, '127.0.0.1', () => { server.off('error', rejectListen); resolveListen(); });
    });
    return {
      port: (server.address() as { port: number }).port,
      async close() {
        await new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = process.env.COSANUM_LOCAL_CONFIG || '';
  const command = process.argv[2] || 'serve';
  if (command === 'init') {
    initializeLocalPilotConfig(configPath).then(
      () => process.stdout.write('Private synthetic pilot config created.\n'),
      () => { process.stderr.write('Could not create private synthetic pilot config.\n'); process.exitCode = 1; },
    );
  } else if (command === 'serve') {
    startLocalPilot(configPath, process.env.DATABASE_URL || '', Number(process.env.PORT || 8788)).then(pilot => {
      process.stdout.write(`Local synthetic pilot ready at http://127.0.0.1:${pilot.port}\n`);
      const stop = () => { pilot.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }, () => { process.stderr.write('Local pilot could not start; check private config and loopback PostgreSQL.\n'); process.exitCode = 1; });
  } else {
    process.stderr.write('Usage: local-pilot.ts [init|serve]\n');
    process.exitCode = 1;
  }
}
