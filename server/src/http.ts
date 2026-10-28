import { createServer } from 'node:http';
import { createDatabasePool } from './database.ts';
import { createApiHandler } from './app.ts';

// The deployed entrypoint intentionally provides no token verifier, identity directory, or workflow executor.
const api = createApiHandler();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL;
const database = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
let databaseReady = false;
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (request.method === 'GET' && (request.url === '/health' || request.url === '/')) {
    response.writeHead(databaseUrl && !databaseReady ? 503 : 200, { 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ status: databaseReady ? 'ready' : 'local_only', database: databaseReady ? 'available' : 'not_configured', authorization: 'disabled', google: 'mock_only', connected: false }));
    return;
  }
  await api(request, response);
});

async function start() {
  if (database) {
    await database.query('SELECT 1');
    databaseReady = true;
  }
  server.listen(port, host, () => console.log(`Cosanum API listening on ${host}:${port}; authorization disabled; connected=false`));
}

void start().catch(async error => {
  console.error(`API startup failed: ${error instanceof Error ? error.message : 'database unavailable'}`);
  await database?.end();
  process.exitCode = 1;
});
