# Private Google training member access

This member entrance implements trainer and participant access for issues #69 and #70. It reads the current private Google training workbook. It does not use the separate public demo's sample rooms. The existing owner-only Apps Script application retains administration and all training writes.

Source and local synthetic verification are implemented. New hosting, Google identity configuration, private source access and connected member acceptance remain release work. No new cloud service, Google consent, member grant or Apps Script deployment is created by this source change.

## What each account sees

An explicit private grant binds a current People person key to `assigned_trainer`, `assigned_participant`, or both. The current People row supplies the exact assigned email and display alias. A Google sign-in by itself grants no training access. Inactive, unknown, ambiguous and mismatched accounts are rejected.

Trainers see their assigned sessions and the participant context required for their own reports. Participants see their own cases, including planning tasks and completed history. Only a verified grant with both roles exposes the role tabs. Every list read and action rechecks the current grant, People identity, assignment and workflow gate. The browser receives a minimal projection, not raw workbook rows, evidence ledgers or administration links.

Reports and confirmations open the existing native Google Forms after a fresh server check. The server checks saved and live responder URL agreement, verified email collection and the canonical workflow gate. No Form URL is included in task lists. The page shows a short-lived handoff and never claims a submission succeeded. Google Forms and the original Apps Script handlers remain responsible for the verified respondent, evidence and resulting state. Missing metadata or source access blocks the action. Direct or copied Form links do not bypass those existing submission checks.

The read projection evaluates the canonical `Schema.gs`, `Booking.gs`, `FormsIdentity.gs`, `TrainerAssessment.gs` and `ParticipantAcknowledgement.gs` in a read-only VM. Include these release-matched files in the image. Before activation, compare their schema and gates with the live owner deployment, especially after another Apps Script release. No Apps Script method is exposed for member administration.

## Login and logout

Google Identity Services loads only after the user selects sign-in. The official Google library verifies the token signature, issuer, audience, expiry, verified email and a one-use server challenge nonce. Gmail or authoritative Workspace email can bind by its exact configured People address. Other third-party Google account emails require an explicit Google `subject` pin in the grant. A role name, case ID or email supplied by the browser is never an authorization claim. See Google's [ID-token verification guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

The server issues an opaque cookie with an absolute eight-hour expiry. Production cookies use the `__Host-` prefix, Secure, HttpOnly and SameSite Strict. PostgreSQL stores token, browser-family and challenge hashes; identity claims exclude the login nonce. Google ID tokens and training data never enter localStorage, sessionStorage, IndexedDB or URLs. POSTs require the exact configured Origin, JSON and `X-Member-Request: 1`; no wildcard CORS is provided.

Logout revokes the browser family's generation in a transaction. It invalidates sibling-tab sessions, rejects login started before logout and suppresses late page responses. An older logout retry cannot revoke a later explicit login. A noncredential logout intent cookie persists until its exact server revocation is confirmed, including after a failed request or reload. A shared exclusive Web Lock serializes marker writes and compare/clear across tabs; the network request runs outside the lock. Browsers without working `navigator.locks` remain blocked before session restore or sign-in. Clearing private content is immediate; server confirmation controls whether login can resume. Other browsers and the Google account's own session remain separate.

## Same-origin routes

| Route | Contract |
| --- | --- |
| `GET /member/` | Member page; four self-hosted assets only |
| `GET /member/config` | Public client ID and noncredential logout-cookie name |
| `POST /member/auth/challenge` | One-use nonce; binds a browser family and generation |
| `POST /member/session` | `{credential}` Google token, verified once; sets app cookie |
| `GET /member/session` | Current verified profile, expiry and generation |
| `GET /member/tasks` | Current profile, own minimal tasks and check timestamp |
| `POST /member/tasks/open` | `{role,caseId,sessionId,action}`; rechecks scope and returns a Form handoff |
| `POST /member/logout` | `{generation,logoutId}`; confirms that exact family-generation revocation |

Serve page and API from the same reviewed HTTPS origin. Static and API responses use `no-store`. The member page has a restricted CSP and no-referrer policy. The old invitation page and legacy database workflow endpoints are separate foundations; the production entrypoint still leaves those protected endpoints unconfigured.

## Private runtime configuration

Copy [member-config.example.json](../deploy/member-config.example.json) to an absolute path outside the repository. The example deliberately has `approved: false`, inactive fictitious members and unusable placeholders. Runtime requires a regular file owned by the runtime UID with mode `0400` or `0600`; it rejects symlinks, repository paths, an unapproved config, an inexact/non-HTTPS origin, duplicate grants and unrecognized roles. Set `COSANUM_MEMBER_CONFIG` to the private path only after the reviewed values and activation are approved.

Use a Google OAuth **web client** with the exact page origin registered. This is public client configuration, not a client secret. Do not reuse a clasp management credential or put an OAuth refresh token in this config. The server uses Application Default Credentials for its separately approved reader identity. Its request allowlist is GET-only and permits only the configured Sheets workbook and Forms metadata:

- `https://www.googleapis.com/auth/spreadsheets.readonly`
- `https://www.googleapis.com/auth/forms.body.readonly`

Enable the corresponding APIs and approve access to only the required workbook and Forms for that identity. Source access and actual granted scopes must be verified before accepting members. A Google API denial stays blocked; do not broaden to Drive, mail, Calendar, Forms responses or write scopes to make a check pass. The Forms metadata endpoint supports [the Forms body read-only scope](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/get). Form file-sharing requirements still need connected validation with the selected reader identity.

Grants are reloaded on each source operation. Deactivation therefore takes effect on the next read or handoff without restarting. A changed origin, web client or workbook fails closed until a reviewed restart. A mounted secret version should remain pinned for a release; rotating it requires a new reviewed revision and an explicit member-grant readback.

## Session database

Use a new dedicated PostgreSQL database/schema with a separate administrator and least-privilege runtime role. Member startup and migration reject unrelated relations or migration IDs rather than changing an existing training database. The member schema contains only `schema_migrations`, `member_browser_families`, `member_auth_challenges` and `member_sessions`. No case table or Google training record is imported.

As the migration administrator, provide the private `DATABASE_URL` and run:

```sh
cd server
npm run migrate:members
```

This applies **only** `004_member_sessions.sql` and records its checksum. Do not use the generic `npm run migrate` for the member database: that command retains the legacy foundation's full migration chain. Do not grant DDL or database ownership to the runtime. Apply [member-runtime-grants.psql](../deploy/member-runtime-grants.psql) with explicit `app_role` and `app_schema` values. Startup checks the checksum without DDL. Expired records are pruned on subsequent challenge/session creation; each family has bounded live challenge/session counts.

## Reviewable deployment candidate

Build the repository-root Docker context with `server/Dockerfile`. [member-portal-service.yaml](../deploy/member-portal-service.yaml) proposes a separate `cosanum-training-members` Cloud Run service, its own runtime identity and session database secret, and an owner-private config secret volume. Replace and review every placeholder before deployment. The existing owner Apps Script deployment must remain owner-only, and its manifest, triggers and clasp target do not change.

The template does not grant invocation IAM. Decide the member origin and approved invocation boundary explicitly; serving a public sign-in shell does not grant private training access. Provisioning hosting/database resources, creating the web client, granting reader access and admitting real members require the connected release approval. Keep secret versions pinned and validate file ownership/mode against [Cloud Run secret-volume behavior](https://docs.cloud.google.com/run/docs/configuring/services/secrets); the supplied second-generation Node image runs as root and the file mode is decimal 256 (`0400`).

`GET /health` reports only configured components and database availability. It deliberately reports connected acceptance as unverified. A green health response is not evidence of Google identity or source access.

## Verification and remaining acceptance

Local checks cover source scoping, role tampering, shared-session isolation, current grants/assignments, safe Form gates, cookie/Origin/nonce checks, expiry, revocation, cross-tab timing and stale replies. The browser rehearsal uses isolated synthetic Google identities and synthetic workbook rows; it blocks external Google requests. Native PostgreSQL tests exercise one-use challenges, separate-backend family locking, delayed login rejection and older-logout retry isolation with a restricted session role.

```sh
cd server
npm run check
npm test
npm run test:member-browser
# With an isolated disposable loopback PostgreSQL target:
npm run test:native-member-sessions
```

Also run `npm test`, `npm run check` and `npm run build` in `participant-web`, and the root `npm run check` for the preserved owner source. Browser evidence is synthetic and must not be presented as real account acceptance.

Before activating real users, verify the selected reader against the live workbook/schema and current Form metadata, then check two distinct participants sharing a session and two trainer scopes with real assigned accounts. Exercise wrong/unassigned and deactivated accounts, reassignment, role tampering, premature actions, source outage, refresh, sibling tabs, failed logout/reload and subsequent explicit login. Confirm the owner administration URL still rejects member accounts. Do not submit new training evidence as part of a read-only login rehearsal; any controlled Forms submission needs its own exact authorized test case.
