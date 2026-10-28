import type { QueryResultRow } from 'pg';
import type { SqlExecutor } from './database.ts';
import { ActionError, type Identity } from './service.ts';

export type DashboardCase = { caseId: string; status: string; revision: string };
export type ProcessQualityDashboard = {
  unscheduledRequests: Array<{
    requestId: string; requesterName: string; sourceTeam?: string; reason: string;
    deadlineDate: string; revision: string; cases: DashboardCase[];
  }>;
  upcomingSessions: Array<{
    requestId: string; sessionId: string; startsAt: string; endsAt?: string;
    requesterName: string; sourceTeam?: string; reason: string; deadlineDate: string;
    sessionRevision: string; cases: DashboardCase[];
  }>;
  attentionCases: Array<{
    requestId: string; sessionId?: string; caseId: string; requesterName: string;
    sourceTeam?: string; reason: string; deadlineDate: string; status: string;
    revision: string;
  }>;
};

type DashboardRow = QueryResultRow & {
  request_id: string; requester_name: string; source_team: string | null; reason: string;
  deadline_date: string; request_revision: string; session_id: string | null;
  starts_at: Date | null; ends_at: Date | null; calendar_event_id: string | null; session_status: string | null;
  session_revision: string | null; case_id: string; case_status: string;
  case_revision: string; case_state: Record<string, unknown>;
};

function dateText(value: string | Date): string { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function optional(value: string | null): { sourceTeam?: string } { return value ? { sourceTeam: value } : {}; }

/** Read-only projection; every row is re-scoped to the currently active verified P&Q identity and case assignment. */
export class PostgresProcessQualityDashboard {
  constructor(private readonly db: SqlExecutor) {}

  async read(identity: Identity): Promise<ProcessQualityDashboard> {
    if (identity.role !== 'process_quality' || !identity.issuer || !identity.subject || !identity.verifiedEmail)
      throw new ActionError(403, 'Process & Quality authorization required');
    const result = await this.db.query<DashboardRow>(
      `SELECT r.request_id, r.requester_name, r.source_team, r.reason,
              r.deadline_date::text AS deadline_date, r.revision::text AS request_revision,
              s.session_id, s.starts_at, s.ends_at, s.calendar_event_id, s.status AS session_status,
              s.revision::text AS session_revision,
              c.case_id, c.status AS case_status, c.revision::text AS case_revision, c.state AS case_state
         FROM verified_identities i
         JOIN workflow_assignments a ON a.actor_key = i.actor_key
         JOIN workflow_cases c ON c.case_id = a.case_id AND c.owner_key = i.actor_key
         JOIN workflow_requests r ON r.request_id = c.request_id
         LEFT JOIN workflow_sessions s ON s.session_id = c.session_id AND s.request_id = c.request_id
        WHERE i.issuer = $1 AND i.subject = $2 AND i.email_normalized = $3
          AND i.email_verified AND i.active AND i.role = 'process_quality'
          AND a.role = 'process_quality' AND a.active AND a.actor_key = i.actor_key
        ORDER BY r.deadline_date, r.request_id, s.starts_at NULLS LAST, s.session_id NULLS LAST, c.case_id`,
      [identity.issuer, identity.subject, identity.verifiedEmail.trim().toLocaleLowerCase('en-US')],
    );
    const dashboard: ProcessQualityDashboard = { unscheduledRequests: [], upcomingSessions: [], attentionCases: [] };
    const requests = new Map<string, ProcessQualityDashboard['unscheduledRequests'][number]>();
    const sessions = new Map<string, ProcessQualityDashboard['upcomingSessions'][number]>();
    for (const row of result.rows) {
      const state = row.case_state || {};
      const superseded = typeof state.supersededByCaseId === 'string' && state.supersededByCaseId.length > 0;
      const future = row.starts_at !== null && row.starts_at.getTime() >= Date.now();
      const scheduled = future && Boolean(row.session_id) && Boolean(row.calendar_event_id) && Boolean(row.session_status) &&
        ['invited', 'in_progress'].includes(row.session_status) && row.case_status !== 'complete';
      const fields = {
        requestId: row.request_id, requesterName: row.requester_name, ...optional(row.source_team),
        reason: row.reason, deadlineDate: dateText(row.deadline_date),
      };
      const item: DashboardCase = { caseId: row.case_id, status: row.case_status, revision: String(row.case_revision) };
      if (!superseded && ['open', 'planning'].includes(row.case_status) && !scheduled) {
        let request = requests.get(row.request_id);
        if (!request) {
          request = { ...fields, revision: String(row.request_revision), cases: [] };
          requests.set(row.request_id, request);
        }
        request.cases.push(item);
      }
      if (!superseded && scheduled && row.session_id && row.starts_at && row.session_revision) {
        const key = `${row.request_id}\u0000${row.session_id}`;
        let session = sessions.get(key);
        if (!session) {
          session = {
            ...fields, sessionId: row.session_id, startsAt: row.starts_at.toISOString(),
            ...(row.ends_at ? { endsAt: row.ends_at.toISOString() } : {}),
            sessionRevision: String(row.session_revision), cases: [],
          };
          sessions.set(key, session);
        }
        session.cases.push(item);
      }
      if (!superseded && (state.declined === true || ['assessed', 'proof_ready'].includes(row.case_status))) {
        dashboard.attentionCases.push({
          ...fields, ...(row.session_id ? { sessionId: row.session_id } : {}),
          caseId: row.case_id, status: row.case_status, revision: String(row.case_revision),
        });
      }
    }
    dashboard.unscheduledRequests = [...requests.values()];
    dashboard.upcomingSessions = [...sessions.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.sessionId.localeCompare(b.sessionId));
    return dashboard;
  }
}
