import { createServer } from 'node:http';
import { WorkflowService, ActionError, type ActionRequest, type IdentityProvider, type WorkflowGateway } from './service.ts';

// Local server starts with no authority and no connected gateway. Live wiring is a separate release gate.
const noIdentity: IdentityProvider = { async authenticate() { return null; } };
const noGateway: WorkflowGateway = { async load() { return null; }, async execute() { throw new Error('Connected gateway not configured'); } };
const service = new WorkflowService(noIdentity, noGateway);
const port = Number(process.env.PORT || 8787);
createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'GET' && request.url === '/health') { response.end(JSON.stringify({ status: 'local_only', connected: false })); return; }
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
}).listen(port, '127.0.0.1', () => console.log(`Synthetic API boundary listening on 127.0.0.1:${port}`));
