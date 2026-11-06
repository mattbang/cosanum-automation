export type MemberRole = 'assigned_trainer' | 'assigned_participant';
export type MemberClaims = {
  issuer: 'https://accounts.google.com'; subject: string; email: string;
  emailVerified: true; nonce?: string; hostedDomain?: string;
};
export type MemberGrant = { personKey: string; roles: MemberRole[]; active: boolean; subject?: string };
export type MemberProfile = {
  personKey: string; displayName: string; email: string; initials: string; roles: MemberRole[];
};
export type MemberActionId = 'open_trainer_form' | 'open_participant_form';
export type MemberTaskRef = { role: MemberRole; caseId: string; sessionId: string; action: MemberActionId };
export type MemberTask = {
  id: string; role: MemberRole; caseId: string; sessionId: string; requestId: string;
  title: string; phase: 'theory' | 'practice' | 'planning'; startsAt?: string; endsAt?: string;
  counterpartName?: string; sourceMaterial?: string;
  state: 'ready' | 'blocked' | 'complete'; statusLabel: string; reason: string;
  action?: { id: MemberActionId; label: string };
};
export type MemberTaskList = { profile: MemberProfile; tasks: MemberTask[]; checkedAt: string };
export interface MemberSource {
  profile(claims: MemberClaims): Promise<MemberProfile>;
  tasks(claims: MemberClaims): Promise<MemberTaskList>;
  open(claims: MemberClaims, task: MemberTaskRef): Promise<{ url: string; checkedAt: string }>;
}
export class MemberError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
