import { createServer } from 'node:http';
import { createDatabasePool, verifyMigrations } from './database.ts';
import { createApiHandler } from './app.ts';
import { createConfiguredMemberHandler } from './members/runtime.ts';
import { assertMemberSessionSchema } from './members/database.ts';

// Legacy workflow routes remain unconfigured; member access has a separate opt-in boundary.
const api = createApiHandler();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL;
const database = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
let databaseReady = false;
let memberHandler:
  Awaited<ReturnType<typeof createConfiguredMemberHandler>> | undefined;
const server = createServer(async (request, response) => {
  try {
    if (memberHandler && (await memberHandler(request, response))) return;
    if (memberHandler && request.method === 'GET' && request.url === '/') {
      response.writeHead(302, {
        Location: '/member/',
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (
      request.method === 'GET' &&
      (request.url === '/health' || request.url === '/')
    ) {
      response.writeHead(databaseUrl && !databaseReady ? 503 : 200, {
        'Cache-Control': 'no-store',
      });
      response.end(
        JSON.stringify({
          status: databaseReady ? 'ready' : 'local_only',
          database: databaseReady ? 'available' : 'not_configured',
          authorization: memberHandler ? 'member_sessions' : 'disabled',
          legacyWorkflowAuthorization: 'disabled',
          google: memberHandler ? 'sheets_forms_readonly' : 'mock_only',
          connected: false,
          memberAccess: memberHandler ? 'configured_unverified' : 'disabled',
        }),
      );
      return;
    }
    await api(request, response);
  } catch {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
  }
});

async function shutdown() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database?.end();
}
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});

async function start() {
  if (database) {
    await database.query('SELECT 1');
    databaseReady = true;
  }
  if (process.env.COSANUM_MEMBER_CONFIG) {
    if (!database)
      throw new Error(
        'A persistent session database is required for member access',
      );
    await assertMemberSessionSchema(database);
    await verifyMigrations(database, ['004_member_sessions.sql']);
    memberHandler = await createConfiguredMemberHandler(
      process.env.COSANUM_MEMBER_CONFIG,
      database,
    );
  }
  server.listen(port, host, () =>
    console.log(
      `Cosanum API listening on ${host}:${port}; legacy authorization disabled; member access ${memberHandler ? 'configured' : 'disabled'}; connected acceptance unverified`,
    ),
  );
}

void start().catch(async (error) => {
  console.error(
    `API startup failed: ${error instanceof Error ? error.message : 'database unavailable'}`,
  );
  await database?.end();
  process.exitCode = 1;
});
