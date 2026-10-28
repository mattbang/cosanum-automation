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

No OAuth flow has been started. The browser interaction, consent screen, selected account, app/developer identity, and exact scopes require a separate reviewed action before creating or using credentials.

## 2. Database and audit gate

Before applying migration `001_backend_foundation.sql`, record:

- Cloud project, region, Cloud SQL instance, database name, and approved network path.
- Runtime service account and its minimum Cloud SQL client and Secret Manager access.
- Migration job identity and the separate application database role. The application role must read/write workflow tables and insert history, but must not update or delete `workflow_events`, `audit_events`, or `case_evidence`.
- Secret Manager secret name/version for the database URL. Keep the connection URL out of deployment output and logs; use the Cloud SQL socket path `/cloudsql/PROJECT:REGION:INSTANCE` in the secret value.
- Backup/restore owner, retention, and a tested recovery procedure for the audit and workflow data.

Run migrations as an explicit one-off release step. The API intentionally does not migrate the schema at startup.

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

## 5. Deployment evidence to add after approval

Keep these records separate from local tests:

- Build image digest and source commit.
- Migration run ID and resulting schema version.
- Cloud Run service/revision identity and IAM invocation policy.
- Verified account, app, developer, and exact scopes used for any Google consent.
- Read-only resource mapping check and action-by-action connected acceptance evidence.
- Rollback/disable procedure and named operator.

The current local and mocked tests do not establish Cloud SQL migration acceptance, account consent, Google resource access, Cloud Run readiness, or connected workflow acceptance.
