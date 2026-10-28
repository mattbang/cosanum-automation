import type { IncomingMessage, ServerResponse } from 'node:http';
import { ActionError, WorkflowService, type ActionRequest, type IdentityProvider, type WorkflowGateway } from './service.ts';
import { ParticipantLinkError, HostedParticipantLinks } from './participant-links.ts';
import { WorkflowConflictError, WorkflowInputError, PostgresWorkflowRepository, type CreateRequestInput } from './postgres-workflows.ts';
import type { BearerTokenVerifier } from './identity.ts';

export type ApiDependencies = {
  identities?: IdentityProvider;
  gateway?: WorkflowGateway;
  requests?: Pick<PostgresWorkflowRepository, 'createRequest'>;
  participantLinks?: Pick<HostedParticipantLinks, 'issue' | 'claim' | 'revoke'>;
  tokenVerifier?: BearerTokenVerifier;
};

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new ActionError(413, 'Request body too large');
    chunks.push(buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ActionError(400, 'Invalid JSON request body'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ActionError(400, 'JSON object required');
  return value as Record<string, unknown>;
}

function bearer(request: IncomingMessage): string {
  const value = request.headers.authorization || '';
  return /^Bearer\s+[^\s]+$/i.test(value) ? value.replace(/^Bearer\s+/i, '') : '';
}

export function createApiHandler(dependencies: ApiDependencies = {}) {
  const workflow = dependencies.identities && dependencies.gateway
    ? new WorkflowService(dependencies.identities, dependencies.gateway) : undefined;
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    try {
      if (request.method === 'POST' && path === '/actions') {
        if (!workflow) { send(response, 503, { error: 'Verified identity and workflow executor are not configured' }); return; }
        const input = await bodyOf(request);
        if (typeof input.actionId !== 'string' || typeof input.caseId !== 'string' || typeof input.idempotencyKey !== 'string' ||
            (input.payload !== undefined && (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload))))
          throw new ActionError(400, 'Action ID, case ID, idempotency key, and object payload required');
        const result = await workflow.act(bearer(request), input as unknown as ActionRequest);
        send(response, 200, result);
        return;
      }
      if (request.method === 'GET' && /^\/cases\/[^/]+$/.test(path)) {
        if (!workflow) { send(response, 503, { error: 'Verified identity and case store are not configured' }); return; }
        const caseId = decodeURIComponent(path.slice('/cases/'.length));
        send(response, 200, await workflow.read(bearer(request), caseId));
        return;
      }
      if (request.method === 'POST' && path === '/requests') {
        if (!dependencies.identities || !dependencies.requests) { send(response, 503, { error: 'Verified identity and request store are not configured' }); return; }
        const identity = await dependencies.identities.authenticate(bearer(request));
        if (!identity?.verifiedEmail) throw new ActionError(401, 'Verified identity required');
        const input = await bodyOf(request) as unknown as CreateRequestInput;
        const result = await dependencies.requests.createRequest(input, identity);
        send(response, result.replayed ? 200 : 201, result);
        return;
      }
      if (request.method === 'POST' && path === '/participant-links') {
        if (!dependencies.identities || !dependencies.participantLinks) { send(response, 503, { error: 'Verified identity and participant-link service are not configured' }); return; }
        const identity = await dependencies.identities.authenticate(bearer(request));
        if (!identity?.verifiedEmail) throw new ActionError(401, 'Verified identity required');
        const input = await bodyOf(request);
        const expiresAt = new Date(String(input.expiresAt || ''));
        const result = await dependencies.participantLinks.issue({
          caseId: String(input.caseId || ''), assignmentId: Number(input.assignmentId),
          email: String(input.email || ''), expiresAt, createdBy: identity,
        });
        send(response, 201, result);
        return;
      }
      if (request.method === 'POST' && /^\/participant-links\/[^/]+\/revoke$/.test(path)) {
        if (!dependencies.identities || !dependencies.participantLinks) { send(response, 503, { error: 'Verified identity and participant-link service are not configured' }); return; }
        const identity = await dependencies.identities.authenticate(bearer(request));
        if (!identity?.verifiedEmail) throw new ActionError(401, 'Verified identity required');
        const linkId = decodeURIComponent(path.slice('/participant-links/'.length).replace(/\/revoke$/, ''));
        const revoked = await dependencies.participantLinks.revoke(linkId, identity);
        send(response, revoked ? 200 : 404, { status: revoked ? 'revoked' : 'not_found' });
        return;
      }
      if (request.method === 'POST' && path === '/participant-links/claim') {
        if (!dependencies.tokenVerifier || !dependencies.participantLinks) { send(response, 503, { error: 'Verified identity and participant-link service are not configured' }); return; }
        const claims = await dependencies.tokenVerifier.verify(bearer(request));
        if (!claims?.emailVerified) throw new ActionError(401, 'Verified account required');
        const input = await bodyOf(request);
        const identity = await dependencies.participantLinks.claim(String(input.linkToken || ''), claims);
        send(response, 200, { status: 'claimed', actorKey: identity.actorKey, role: identity.role });
        return;
      }
      send(response, 404, { error: 'Not found' });
    } catch (error) {
      if (error instanceof ActionError || error instanceof ParticipantLinkError) {
        send(response, error.status, { error: error.message });
        return;
      }
      if (error instanceof WorkflowConflictError) {
        send(response, 409, { error: error.message });
        return;
      }
      if (error instanceof WorkflowInputError) {
        send(response, 400, { error: error.message });
        return;
      }
      send(response, 500, { error: 'Internal server error' });
    }
  };
}
