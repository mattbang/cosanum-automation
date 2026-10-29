# Local backend and shared demo sprint · 29–30 October 2026

Cutoff: **06:00 Europe/Zurich, 30 October 2026**. The user will run the two-device case in the morning. This document records bounded local work and decisions; it does not claim connected Google or cloud acceptance.

## Architecture decision

- Run PostgreSQL 18.4 and the TypeScript backend on the laptop for persistence, authorization, concurrency, and audit validation.
- Keep the existing HTTPS shared Site with D1 room state as the **morning live two-device path**. The Expo app opens that Site in the system browser. Do not point the public Site at a laptop HTTP port or expose the local test API through an unaudited tunnel.
- Reconcile synthetic reference data as separate versioned people, topics, skills, and materials resources. Public files contain no account emails or private source IDs. Identity-to-role assignment stays server-side. Do not collapse these into one spreadsheet.
- A later cutover can make both clients use the PostgreSQL API after identity, CORS/origin, deployment, and Google resource gates are reviewed. The private owner-only Apps Script and its Google Sheet remain separate until an explicit single-writer migration.

## Atomic work packages and checks

| Package | Owned paths / action | Acceptance |
| --- | --- | --- |
| Local database | Docker container `cosanum-pg-local`, volume `cosanum-pg-local-data`, `127.0.0.1:55432`; credential file outside repo under `/private/tmp/cosanum-local-postgres/` | `pg_isready`; migration ledger contains `001_backend_foundation.sql` and `002_participant_responses.sql` |
| Native PostgreSQL guard | `server/scripts/native-postgres-guard.mjs` | Run `npm run test:native-postgres` in a fresh `cosanum_native_*` schema; observe separate connections, stale booking loser, response replay, and rollback |
| Local API composition | New server-local pilot entrypoint and targeted test; production `http.ts` stays fail-closed until reviewed dependencies exist | Loopback-only binding; synthetic owner/participant identities; request/case readback across process restart; wrong-role and duplicate denial; no Google or proof/skill claim |
| Reference resources | `contracts/demo-resources/v1/` with four separate resources and mapping notes | JSON parses; foreign keys and person/topic matrix pairs validate; public exports contain no email; legacy mobile/private fixture mismatches are explicit |
| Morning shared path | Existing hosted Site plus Expo system-browser handoff | Daniel and Matthew use their own assigned Google accounts on two devices; offer/response/early-start/report/ack/history are read back from one shared room |

## Decision boundaries

The shared Site currently uses four public demo topics and person keys `EMP-001` to `EMP-004`. The older mobile fixture uses five `TC_R*` topics and different person keys. Similar labels are not evidence of identical training definitions; map IDs and phase/level rules explicitly before using one source for both clients. The current public matrix is a fictitious baseline, while room outcomes live in D1. It is not an authoritative Google Sheet.

The local pilot may prove PostgreSQL transactions and API behavior. It does not prove a deployed service, Google account authorization, Calendar free/busy, event creation, Sheet exchange, automatic mail, push delivery, or real skill updates. Trusted proof registration and archive readback remain required before enabling `applySkillUpdate` in the backend.

## Morning handoff check

Record the exact Site version, device/browser, assigned account, and case link used. Start with one single-person Matthew case: Daniel chooses a topic and up to three offers; Matthew accepts one; Daniel starts early, records a result; Matthew confirms; both inspect history. Then use a fresh room for a decline/reschedule branch. Treat account mismatch, missing access, or a stale offer as visible failures, not automatic acceptance. Record local PostgreSQL evidence separately from this hosted D1 walkthrough.

## Validated local checkpoint

PostgreSQL 18.4 runs in a Docker container with a named data volume and a loopback-only port. Both migrations are recorded in the primary database. The native multi-connection integration passed in an isolated schema after correcting the `name[]` result encoding in its guard. A separate runtime role can read and write only the tables needed by the local pilot; attempts to update audit history or read unrelated Google resource mappings returned PostgreSQL `42501`.

The loopback API passed its focused PGlite tests and the full backend suite. A native HTTP smoke created a synthetic request/case, rejected an unassigned read and mismatched case owner, required a claimed participant link, exposed Daniel's unscheduled dashboard, and recorded exactly one request audit event for the single-person case. It also accepted a one-person “group” case with HCM4 and rejected a multi-person group before a database write. The API process and PostgreSQL container were stopped and restarted; both cases, assignments, dashboard entries, and audit history were read back. The smoke's attempted booking returned `409` at the evidence preflight, so native HTTP did not reach the disabled executor; the focused PGlite test reached its `503` response and confirmed no event/audit/evidence mutation. Calendar booking, live email/push, proof creation, and skill updates remain unverified. The shared Site source now uses four separate synthetic resources; its 13 tests, TypeScript check, production build, and loopback D1 two-role rehearsal pass locally. The existing public Site URL was updated to version 8 from source commit `e09867b0ff700e6b8edb33cebb72b28158196323`; Sites reported deployment `succeeded`. The hosted two-device Google sign-in and room flow still need the assigned-account morning test.
