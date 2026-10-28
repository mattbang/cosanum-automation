import workflow from '../../contracts/workflow.v1.json' with { type: 'json' };
import { evaluate, type ActionId, type Role } from '../../mobile/src/workflow.ts';

export type Scope = { requestId: string; sessionId: string; caseId: string; proofId?: string; proofVersion?: string };
export type Identity = { actorKey: string; role: Role; verifiedEmail: string; issuer?: string; subject?: string };
export type Evidence = { facts: Record<string, boolean>; values: Record<string, string> };
export type RequestContext = { requesterName: string; sourceTeam?: string; reason: 'new_training' | 'retraining' | 'process_change'; deadlineDate?: string };
export type Snapshot = { scope: Scope; request?: RequestContext; personKey: string; trainerKey: string; ownerKey: string; revision: string; evidence: Evidence };
export type ActionRequest = { actionId: ActionId; caseId: string; idempotencyKey: string; payload?: Record<string, unknown> };
export type ActionResponse = { status: 'verified'; actionId: ActionId; caseId: string; revision: string };

export interface IdentityProvider { authenticate(token: string): Promise<Identity | null> }
export interface WorkflowGateway {
  load(caseId: string): Promise<Snapshot | null>;
  execute(actionId: ActionId, snapshot: Snapshot, payload: Record<string, unknown>, actor: Identity, idempotencyKey: string): Promise<void>;
  authorize?(snapshot: Snapshot, actor: Identity): Promise<boolean>;
}

export class ActionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function sameScope(a: Scope, b: Scope): boolean {
  return a.requestId === b.requestId && a.sessionId === b.sessionId && a.caseId === b.caseId &&
    a.proofId === b.proofId && a.proofVersion === b.proofVersion;
}

function assignedTo(identity: Identity, snapshot: Snapshot): boolean {
  const expectedActor = identity.role === 'assigned_trainer' ? snapshot.trainerKey :
    identity.role === 'assigned_participant' ? snapshot.personKey : snapshot.ownerKey;
  return identity.actorKey === expectedActor;
}

export class WorkflowService {
  constructor(private readonly identities: IdentityProvider, private readonly gateway: WorkflowGateway) {}

  async act(token: string, request: ActionRequest): Promise<ActionResponse> {
    const identity = await this.identities.authenticate(token);
    if (!identity || !identity.verifiedEmail) throw new ActionError(401, 'Verified identity required');
    const action = workflow.actions.find(item => item.id === request.actionId);
    if (!action || typeof request.caseId !== 'string' || !request.caseId.trim()) throw new ActionError(400, 'Unknown action or case');
    const idempotencyKey = typeof request.idempotencyKey === 'string' ? request.idempotencyKey.trim() : '';
    if (!idempotencyKey || idempotencyKey.length > 200) throw new ActionError(400, 'A stable idempotency key is required');
    const before = await this.gateway.load(request.caseId);
    if (!before) throw new ActionError(404, 'Case not found');
    if (before.scope.caseId !== request.caseId) throw new ActionError(409, 'Case scope mismatch');
    if (identity.role !== action.actor || !assignedTo(identity, before))
      throw new ActionError(403, 'Role or assignment mismatch');
    if (this.gateway.authorize && !await this.gateway.authorize(before, identity)) throw new ActionError(403, 'Role or assignment mismatch');
    const scope = Object.fromEntries(Object.entries(before.scope).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
    const preflight = evaluate(request.actionId, identity.role, scope, before.evidence.facts, before.evidence.values);
    if (!preflight.allowed) throw new ActionError(409, `Evidence gate blocked: ${preflight.missing.join(', ')}`);
    // The gateway owns the conditional write and must re-read its persisted revision immediately before mutation.
    await this.gateway.execute(request.actionId, before, request.payload ?? {}, identity, idempotencyKey);
    const after = await this.gateway.load(request.caseId);
    if (!after || !sameScope(before.scope, after.scope) || after.revision === before.revision)
      throw new ActionError(502, 'Write readback did not match case and revision');
    for (const fact of action.postconditions || []) {
      if (after.evidence.facts[fact] !== true) throw new ActionError(502, `Postcondition not verified: ${fact}`);
    }
    for (const fact of action.forbids || []) {
      if (after.evidence.facts[fact] !== false) throw new ActionError(502, `Forbidden state after action: ${fact}`);
    }
    return { status: 'verified', actionId: request.actionId, caseId: request.caseId, revision: after.revision };
  }

  async read(token: string, caseId: string): Promise<Snapshot> {
    const identity = await this.identities.authenticate(token);
    if (!identity || !identity.verifiedEmail) throw new ActionError(401, 'Verified identity required');
    if (!caseId) throw new ActionError(400, 'Case ID required');
    const snapshot = await this.gateway.load(caseId);
    if (!snapshot) throw new ActionError(404, 'Case not found');
    if (!assignedTo(identity, snapshot)) throw new ActionError(403, 'Role or assignment mismatch');
    if (this.gateway.authorize && !await this.gateway.authorize(snapshot, identity)) throw new ActionError(403, 'Role or assignment mismatch');
    return snapshot;
  }
}
