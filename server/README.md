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

With a disposable PostgreSQL database, set `DATABASE_URL` and run `npm run migrate`. Migration files are checksum-recorded; changing an already applied migration is rejected. `server/migrations/001_backend_foundation.sql` installs append-only triggers for events, audit records, and evidence. Use a database role for the application that cannot update or delete those history tables. The app does not run migrations on startup.

## Backend contracts

- An action has `{ actionId, caseId, idempotencyKey, payload? }`. The client must reuse the same stable key when retrying an uncertain request. Client-supplied evidence is ignored.
- `PostgresWorkflowGateway` re-reads and locks the case revision, rejects stale revisions and duplicate keys, calls an injected executor, and commits evidence, the workflow event, and actor/scope audit record atomically. The executor must use the same idempotency key for external work and return only after external state has been read back. No Google executor is wired in this foundation.
- `PostgresWorkflowRepository.createRequest` persists request-level origin/deadline fields, sessions, cases, and exact role assignments in one transaction. Replaying the same request is accepted; reusing its ID with different request fields or assignments is rejected.
- `PostgresIdentityProvider` accepts only claims returned by an injected token verifier and requires a registered active identity with verified email. The verifier must validate signature, issuer, audience, expiry, and email verification.
- `HostedParticipantLinks` issues 256-bit random secrets while persisting only their SHA-256 hashes. Claims require a live non-revoked link, an active assignment, a verified account email matching the assigned participant, and a stable issuer/subject binding. The link never grants access on its own.
- Google adapters receive an explicit logical-resource mapping and injectable HTTP transport. They have no token provider or resource mapping configured by default. `GoogleResourceMappings` resolves only enabled mappings for a specific environment.

The current HTTP entrypoint deliberately wires no identity verifier, link service, workflow gateway, or Google adapter. `/actions` therefore rejects every caller; the schema and repository are foundations, not connected acceptance. `/health` reports database availability separately from identity and Google connectivity.

## Cloud Run handoff

`server/Dockerfile` and `server/deploy/cloud-run-service.yaml` are deployment templates. Replace the project, region, instance, repository, image tag, and runtime service account placeholders. Provision Cloud SQL, a Secret Manager value named `cosanum-api-database-url`, and the required least-privilege IAM bindings separately. The secret's PostgreSQL URL must use the Cloud SQL Unix socket path `/cloudsql/PROJECT:REGION:INSTANCE` as its `host` parameter. Apply migrations through a reviewed one-off job before routing traffic.

The service template does not grant public Cloud Run invocation. Keep that IAM boundary explicit. Do not point the template at the historical root clasp project or the Apps Script deployment. No OAuth flow, Google API scope, cloud service, deployment, or connected write was created by this work.
