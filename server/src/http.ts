import { createServer } from 'node:http';
import { createDatabasePool } from './database.ts';
import { WorkflowService, ActionError, type ActionRequest, type IdentityProvider, type WorkflowGateway } from './service.ts';

// Local server starts with no authority and no connected gateway. Live wiring is a separate release gate.
const noIdentity: IdentityProvider = { async authenticate() { return null; } };
const noGateway: WorkflowGateway = { async load() { return null; }, async execute() { throw new Error('Connected gateway not configured'); } };
const service = new WorkflowService(noIdentity, noGateway);
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL;
const database = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
let databaseReady = false;
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'GET' && (request.url === '/health' || request.url === '/')) {
    response.end(JSON.stringify({ status: databaseReady ? 'ready' : 'local_only', database: databaseReady ? 'available' : 'not_configured', authorization: 'disabled', google: 'mock_only', connected: false }));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/actions') { response.writeHead(404); response.end(JSON.stringify({ error: 'Not found' })); return; }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ActionRequest;
    const token = request.headers.authorization?.replace(/^Bearer /, '') || '';
    const result = await service.act(token, input);
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(error instanceof ActionError ? error.status : 400);
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid request' }));
  }
});

async function start() {
  if (database) {
    await database.query('SELECT 1');
    databaseReady = true;
  }
  server.listen(port, host, () => console.log(`Cosanum API boundary listening on ${host}:${port}; authorization disabled; connected=false`));
}

void start().catch(async error => {
  console.error(`API startup failed: ${error instanceof Error ? error.message : 'database unavailable'}`);
  await database?.end();
  process.exitCode = 1;
});
