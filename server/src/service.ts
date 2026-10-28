import workflow from '../../contracts/workflow.v1.json' with { type: 'json' };
import { evaluate, type ActionId, type Role } from '../../mobile/src/workflow.ts';

export type Scope = { requestId: string; sessionId: string; caseId: string; proofId?: string; proofVersion?: string };
export type Identity = { actorKey: string; role: Role; verifiedEmail: string };
export type Evidence = { facts: Record<string, boolean>; values: Record<string, string> };
export type RequestContext = { requesterName: string; sourceTeam?: string; reason: 'new_training' | 'retraining' | 'process_change'; deadlineDate?: string };
export type Snapshot = { scope: Scope; request?: RequestContext; personKey: string; trainerKey: string; ownerKey: string; revision: string; evidence: Evidence };
export type ActionRequest = { actionId: ActionId; caseId: string; idempotencyKey: string; payload?: Record<string, unknown> };
export type ActionResponse = { status: 'verified'; actionId: ActionId; caseId: string; revision: string };

export interface IdentityProvider { authenticate(token: string): Promise<Identity | null> }
export interface WorkflowGateway {
  load(caseId: string): Promise<Snapshot | null>;
  execute(actionId: ActionId, snapshot: Snapshot, payload: Record<string, unknown>, actor: Identity, idempotencyKey: string): Promise<void>;
}

export class ActionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function sameScope(a: Scope, b: Scope): boolean {
  return a.requestId === b.requestId && a.sessionId === b.sessionId && a.caseId === b.caseId &&
    a.proofId === b.proofId && a.proofVersion === b.proofVersion;
}

export class WorkflowService {
  constructor(private readonly identities: IdentityProvider, private readonly gateway: WorkflowGateway) {}

  async act(token: string, request: ActionRequest): Promise<ActionResponse> {
    const identity = await this.identities.authenticate(token);
    if (!identity || !identity.verifiedEmail) throw new ActionError(401, 'Verified identity required');
    const action = workflow.actions.find(item => item.id === request.actionId);
    if (!action || !request.caseId) throw new ActionError(400, 'Unknown action or case');
    const idempotencyKey = request.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) throw new ActionError(400, 'A stable idempotency key is required');
    const before = await this.gateway.load(request.caseId);
    if (!before) throw new ActionError(404, 'Case not found');
    if (before.scope.caseId !== request.caseId) throw new ActionError(409, 'Case scope mismatch');
    const expectedActor = action.actor === 'assigned_trainer' ? before.trainerKey :
      action.actor === 'assigned_participant' ? before.personKey : before.ownerKey;
    if (identity.role !== action.actor || identity.actorKey !== expectedActor)
      throw new ActionError(403, 'Role or assignment mismatch');
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
    return { status: 'verified', actionId: request.actionId, caseId: request.caseId, revision: after.revision };
  }
}
