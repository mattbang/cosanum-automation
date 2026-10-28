# Training API foundation

The service keeps the existing workflow evaluator as its action contract and adds PostgreSQL persistence for requests, sessions, person cases, role assignments, verified identities, participant links, evidence, Google resource mappings, and append-only workflow/audit history. Requester name, source team, reason, and deadline are request-level fields. Request retries must preserve them.

## Local development

```sh
cd server
npm ci
npm run check
npm test
npm run dev
```

`npm test` includes a disposable PGlite integration test that executes the migration and repository SQL in an embedded PostgreSQL engine. Its single-connection setup covers transactional persistence and stale-revision arbitration; it does not replace multi-connection race testing against the target PostgreSQL service.

With a disposable PostgreSQL database, set `DATABASE_URL` and run `npm run migrate`. Migration files are checksum-recorded; changing an already applied migration is rejected. Migrations are forward-only: use expand/backfill/contract changes, roll the service back to a prior Cloud Run revision when needed, and restore a database backup to a separate instance for recovery. Do not down-migrate or rewrite append-only evidence, event, or audit history. `server/migrations/001_backend_foundation.sql` installs append-only triggers for events, audit records, and evidence. Use a database role for the application that cannot update or delete those history tables. The app does not run migrations on startup.

## HTTP and persistence contracts

- `POST /requests` creates a request, its sessions, person cases, and role assignments atomically. Retries reuse the request ID and must preserve the exact request-level source/deadline fields and case/session set.
- `GET /cases/{caseId}` returns a case only to a verified identity assigned to that case.
- `POST /actions` accepts `{ actionId, caseId, idempotencyKey, payload? }`. The client must reuse the same stable key when retrying an uncertain request. Client-supplied evidence is ignored.
- `POST /participant-links` issues a short-lived, one-time-displayed link token for an active participant assignment. A request case may carry `participantEmail`; link issuance requires that exact stored address and locks the current active owner assignment and the exact active issuer/subject identity from the bearer. `POST /participant-links/claim` accepts the link token with a separately verified bearer identity. `POST /participant-links/{id}/revoke` revokes only that token and locks the same exact owner assignment and identity; it does not revoke the participant assignment itself. The token is never an identity credential.
- `PostgresWorkflowGateway` locks a shared session and its person cases in stable order, rechecks the current identity and assignment, rejects stale revisions, duplicate keys, and already-booked sessions, calls an injected executor, and commits session state plus independent per-person status/evidence/events/audit records atomically. A group booking must confirm one shared event ID and an invited status for every person case in that session. Linked-case updates are accepted only from Process & Quality or the system role and only for cases in that session. The executor must use the same idempotency key for external work, verify contract postconditions and forbidden states, and return only after external state has been read back. No Google executor is wired in this foundation.
- `PostgresWorkflowRepository.createRequest` persists request-level origin/deadline fields, sessions, person cases, immutable case/session attributes, and exact role assignments in one transaction. Replaying the same request is accepted; reusing its ID with different request fields, attributes, or assignments is rejected. `participantEmail` is optional for synthetic work, but required before a hosted participant link can be issued.
- `PostgresIdentityProvider` accepts only claims returned by an injected token verifier and requires a registered active identity with verified email. The verifier must validate signature, issuer, audience, expiry, and email verification.
- `HostedParticipantLinks` issues 256-bit random secrets while persisting only their SHA-256 hashes. Claims require a live non-revoked link, an active assignment, a verified account email matching the assigned participant, and a stable issuer/subject binding. The link never grants access on its own.
- Google adapters receive an explicit logical-resource mapping and injectable HTTP transport. They have no token provider or resource mapping configured by default. `GoogleResourceMappings` resolves only enabled mappings for a specific environment.

The current HTTP entrypoint deliberately wires no identity verifier, identity provider, request store, link service, workflow gateway, or Google adapter. Protected routes return `503` until those exact dependencies are configured; the schema and repository are foundations, not connected acceptance. `/health` reports database availability separately from identity and Google connectivity.

Proof creation and the verified `proof_id`/`proof_version` transition are not implemented. Those columns are reserved in the case schema, but there is no proof-creation/registration route or trusted proof verifier yet. The required registration contract and checks are specified in `docs/CONNECTED_HANDOFF.md`. Consequently `verifyArchive` and `applySkillUpdate` cannot pass their proof-scope gates through this API. Keep those actions disabled and issue #49 open until a reviewed proof registration step verifies the source evidence and persists the exact proof ID/version.

## Cloud Run handoff

`server/Dockerfile` and `server/deploy/cloud-run-service.yaml` are deployment templates. Replace the project, region, instance, repository, image tag, and runtime service account placeholders. Provision Cloud SQL, a Secret Manager value named `cosanum-api-database-url`, and the required least-privilege IAM bindings separately. The secret's PostgreSQL URL must use the Cloud SQL Unix socket path `/cloudsql/PROJECT:REGION:INSTANCE` as its `host` parameter. Apply migrations through a reviewed one-off job before routing traffic.

The service template does not grant public Cloud Run invocation. Keep that IAM boundary explicit. Do not point the template at the historical root clasp project or the Apps Script deployment. No OAuth flow, Google API scope, cloud service, deployment, or connected write was created by this work.
