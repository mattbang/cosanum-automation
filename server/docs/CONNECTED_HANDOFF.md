# Connected backend handoff

This checklist is the boundary between the local backend foundation and any connected pilot. The repository contains no credential values, OAuth client, Cloud service, deployed URL, or live Google resource mapping. Fill in the actual values in an approved private release record; do not put secrets in this file, chat, source control, or logs.

## 1. Google identity and resource gate

Record and verify all of the following before wiring a token verifier or Google adapter:

- Selected account email and account owner. The current demo account of record is `cosanum.training.demo@gmail.com`; confirm that this remains the intended account for the API project.
- Google Cloud project ID and number, project owner, OAuth app name, developer identity, OAuth client ID, and the verified token issuer and audience expected by the backend.
- Exact requested Google scopes, listed individually with read/write purpose and action. Do not inherit historical prototype consent or add a mail scope. Stop if the account, app, developer, resource owner, or scope list differs from the approved record.
- Exact Calendar and spreadsheet resource IDs, logical mapping key, environment, and intended range for each resource. Populate mappings disabled first, review them, then explicitly enable each approved mapping.
- The identity verifier implementation and validation evidence for signature, issuer, audience, expiry, and `email_verified`. It must use an approved provider/library and must not accept decoded-but-unverified JWT claims.
- The allowed identity directory entries: issuer, subject, normalized verified email, actor key, role, and active status. Never map a role from client payload. Seed only reviewed operator/trainer/participant identities.
- The case assignment rows linking each participant and trainer actor key to the exact person case. Record each participant's verified assigned email on that assignment before link issuance; the link service rejects an email mismatch and binds the verified issuer/subject to that specific assignment. Trainer and owner identities also need verified directory entries.
- Revocation semantics: the participant-link endpoint revokes that hosted token only. Deactivating a participant assignment is a separate operator/database action and must be reflected in the authorization check; do not describe token revocation as assignment revocation.

No OAuth flow has been started. The browser interaction, consent screen, selected account, app/developer identity, and exact scopes require a separate reviewed action before creating or using credentials.

## 2. Database and audit gate

Before applying migration `001_backend_foundation.sql`, record:

- Cloud project, region, Cloud SQL instance, database name, and approved network path.
- Runtime service account and its minimum Cloud SQL client and Secret Manager access.
- Migration job identity and the separate application database role. The application role must read/write workflow tables and insert history, but must not update or delete `workflow_events`, `audit_events`, or `case_evidence`.
- Secret Manager secret name/version for the database URL. Keep the connection URL out of deployment output and logs; use the Cloud SQL socket path `/cloudsql/PROJECT:REGION:INSTANCE` in the secret value.
- Backup/restore owner, retention, and a tested recovery procedure for the audit and workflow data.

Run migrations as an explicit one-off release step. The API intentionally does not migrate the schema at startup.

Migrations are forward-only; there is no down-migration for the append-only history tables. Use expand/backfill/contract releases, and roll application traffic back to a prior Cloud Run revision if a release fails. For data recovery, restore a verified backup to a separate instance and review the cutover; do not delete or rewrite evidence, workflow events, or audit history.

## 3. Hosting and access boundary

Complete and review the placeholders in `deploy/cloud-run-service.yaml`: project, region, Cloud SQL instance, Artifact Registry repository, immutable image tag, runtime service account, and secret name/version. The template permits ingress at the network layer but does not grant Cloud Run invocation to the public.

Choose and document one invocation model before hosting participant links:

1. Keep Cloud Run IAM authenticated and grant `roles/run.invoker` only to the intended participant/trainer principals; or
2. Permit unauthenticated Cloud Run invocation while requiring the backend's verified OIDC bearer token and exact case assignment on every protected route.

Do not select a model implicitly. With the current entrypoint, all protected routes return `503` because no verifier, identity repository, request repository, link service, or workflow executor is wired. Keep the service in that state until these items and the action-specific evidence adapters are reviewed.

## 4. Workflow executor acceptance

For every action enabled in the API, document its server-derived evidence sources and its Google/SQL write sequence. Each executor must:

- Use the supplied stable idempotency key for every external write. Do not use Sheets append semantics for an action that can be retried.
- Re-read the exact external object after mutation and derive postcondition facts from that readback.
- Return only facts/values supported by that readback; client payloads are not evidence.
- Preserve request, session, person-case, proof, and proof-version scope and reject stale revisions or revoked assignments.
- Exercise wrong-account, wrong-case, expired/revoked-link, duplicate, stale-revision, provider-error, and readback-mismatch cases with synthetic tests before enabling the action.

Proof registration remains an explicit missing step. The schema reserves `proof_id` and `proof_version`, but no trusted proof registrar writes them yet. The next implementation must keep proof actions disabled until all of these checks are in place:

1. The endpoint accepts only the case ID and a stable request idempotency key. It reads the canonical request, case, person, topic, session, and phase evidence from persisted state; it does not accept proof IDs, source hashes, response IDs, or artifact IDs as client evidence.
2. An injected trusted verifier checks that every required phase has the original accepted trainer and participant responses for the same request, person, topic, and case. It derives the proof ID, version, and source hash from that verified source set.
3. The verifier reads back the exact registered Google Doc and PDF. Drive search by proof ID must return exactly those two IDs, with matching request/case/proof/version properties, names, MIME types, and parent folder. The PDF must be readable and its Drive checksum must match the downloaded PDF bytes.
4. The verifier checks both local archive copies: the local PDF hash must match Drive, and the DOCX plus manifest must match the same request/case/proof/version/source hash. The archive receipt must name the same source response IDs, session IDs, Doc/PDF IDs, and checksums. See `docs/PROOF_METADATA.md` and `scripts/archive_proof.py` for the current source checks; connector output or a client-provided receipt alone is not proof.
5. After external readbacks complete, a short PostgreSQL transaction locks the selected case, rechecks the expected revision and exact active actor identity/assignment, enforces case-scoped proof/version and idempotency uniqueness, inserts an immutable proof-registration/version row in a new migration, updates the case's current `proof_id`/`proof_version` pointer, and appends workflow evidence, event, and audit rows atomically. Never overwrite an older proof version or its source/receipt record. An exact retry returns the original registration; a changed source hash, proof version, case, or stale revision fails closed.
6. Proof generation and archive workers must append an attempt event before each external write, then append its result/readback or error with the same stable idempotency key. Preserve failed and retried attempts; a timeout or provider error is not evidence that no write occurred. The registration endpoint itself is read-only against Google/Drive/local sources and does not generate or repair artifacts.
7. A later `applySkillUpdate` transition must re-read the current skill level and compare it with the case's original level after the archive receipt has been verified; a changed level is a conflict event, never an overwrite. Every proof/action attempt and older version remains in the append-only timeline.
8. Tests cover wrong request/case/person/topic, missing or duplicate Drive assets, property mismatch, unreadable files, checksum mismatch across Drive/local copies, source-response drift, stale revision, exact retry, conflicting retry, attempt-log retention across provider timeout/retry, changed live skill level, and rollback after any failed persistence step. Synthetic receipts and verifiers may test fail-closed behavior only; they must not set proof/archive/skill verified facts for live workflow use.

This is a contract for later implementation, not current functionality or connected acceptance. No route or verifier is wired in this foundation. Synthetic verifier tests may check transaction and fail-closed behavior, but they cannot mark a case `proofVerified` for live workflow use. `verifyArchive` and `applySkillUpdate` remain disabled until real source/Drive/local readbacks and the registration transaction are independently reviewed.

## 5. Deployment evidence to add after approval

Keep these records separate from local tests:

- Build image digest and source commit.
- Migration run ID and resulting schema version.
- Cloud Run service/revision identity and IAM invocation policy.
- Verified account, app, developer, and exact scopes used for any Google consent.
- Read-only resource mapping check and action-by-action connected acceptance evidence.
- Rollback/disable procedure and named operator.

The current local and mocked tests do not establish Cloud SQL migration acceptance, account consent, Google resource access, Cloud Run readiness, or connected workflow acceptance.
