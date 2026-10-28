# Notification intent outbox foundation

This local increment adds one durable intent type: `failed_assessment`, corresponding to the existing `exception_notice` template family. `NotificationIntents.reconcileFailedAssessment` may be called with a case ID and expected case revision. It rechecks the current active verified Process & Quality identity, active owner assignment, case revision, non-superseded state, `assessed` status, and persisted `trainerPass: false` inside one transaction. No client role, recipient, task, reason, or payload is trusted.

An eligible case produces one pending intent per case/task/revision/Process & Quality owner. Its recipient is the owner actor key and role, while its payload is fixed to `{"templateKey":"exception_notice","reasonCode":"trainer_failed"}`. The payload contains no participant name, email, free text, Form link, or other person's information. Creation and cancellation write audit rows in the same transaction. Exact replays return the existing intent. A stale expected revision returns conflict without writing. When a current revision is supplied after the source state or owner changes, older pending intents for that case are cancelled; if the case no longer qualifies, no new intent is created. A cancelled semantic key is never reopened.

The table is an intent ledger only. There is no HTTP route, sender, recipient email resolution, push token, scheduler, worker, retry loop, external API, or production wiring. It does not claim a notification was rendered, queued for delivery, sent, received, or read.

## Connected delivery remains separate

Before any delivery work, a reviewed processor must resolve the owner role to an authorized recipient, reread current case/evidence and cancellation state immediately before delivery, apply the exact `docs/NOTIFICATION_TEMPLATES.md` gates, render safe display fields, enforce recipient allowlists, and add a separate attempt ledger with reserved/sent/failed/unknown outcomes. Uncertain delivery must not be resent automatically. Push delivery additionally needs an approved token lifecycle and account/device binding. None of those capabilities is implemented by this migration or service.

## Local evidence

`cd server && npm test` covers PGlite migration, same-revision replay uniqueness, owner and role denial, a mixed-owner group case, recipient isolation, fixed PII-free payload, stale-revision rejection, cancellation after source-state change, and rollback of both intent and audit when the audit write fails. `npm run check` checks TypeScript. These are embedded local results only; the native PostgreSQL integration, delivery, scheduling, push, Google, and Cloud Run paths remain unverified.
