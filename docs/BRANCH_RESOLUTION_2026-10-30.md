# Branch resolution and integration roadmap · 30 October 2026

This roadmap resolves the thirteen open draft pull requests against `main` at `4b60cfc`. It distinguishes source integration from feature acceptance. A merged foundation does not close an issue that still requires a deployed, connected, or physical-device result.

## Product expectations used for review

The existing development plan and issues #47–#52 and #58 define the target:

- Daniel's Process & Quality view shows requests awaiting planning, requester/source/reason/deadline, suitable materials and people, upcoming sessions, and specific attention items.
- A trainer and each participant act through their assigned identity and role. Current persisted state determines permitted actions; wrong accounts, expired/revoked links, stale updates, and missing evidence fail visibly.
- Individual and group sessions preserve separate person-topic cases, results, histories, and completion evidence. Group booking cannot silently omit a person.
- Scheduling respects availability and the applicable phase, qualification, and skill rules. Retries do not create duplicate events or responses.
- Trainer assessment, explicit participant acknowledgement, trusted proof registration, matching archives, and skill updates retain their required order. The hosted synthetic tour's room-level skill demonstration is not backend proof acceptance.
- Notifications require current recipients, consent where applicable, minimal content, deduplication, cancellation, and measured delivery/readback. An intent row is not delivery.
- Phone use must be usable and independently testable. Android test builds, iPhone browser behavior, a signed iPhone build, physical devices, and remote push each retain their own evidence.
- German demo materials, source registers, and BPMN models describe the implementation accurately. Synthetic baselines, room outcomes, connected records, and modelled behavior remain identifiable.

Current architecture: `shared-demo-site/` with D1 is the documented shared two-device demonstration path; Expo opens that HTTPS site. `server/` PostgreSQL is a local pilot and future service foundation. The owner-only Apps Script app remains a separate environment. A single-writer cutover requires its own reviewed migration and acceptance. See `docs/demo-day/OVERNIGHT_LOCAL_SPRINT.md`, `MOBILE_SOURCE_MAPPING.md`, and `server/docs/CONNECTED_HANDOFF.md` in PR #57.

## Pass 1 · Deliverables and dependencies

| Deliverable | Result required | Dependency |
| --- | --- | --- |
| Frozen inventory | Each open PR has a head SHA, base, unique changes, disposition, and acceptance owner | Current fetch and GitHub readback |
| Review record | Findings name file/line, failure condition, impact, repair or explicit remaining gate | Source inventory |
| Consolidated source | One isolated branch retains the useful work without reverting newer mobile/backend code | Review and conflict resolution |
| Verification record | Relevant checks run on the integrated tree; unrun or blocked checks are explicit | Consolidated source |
| PR resolution | Already incorporated drafts close as superseded; remaining drafts resolve through a reviewed integration | Evidence and source readback |
| Acceptance roadmap | Device, hosted identity, Google exchange, proof/archive, notifications, and cutover remain assigned to concrete checks | Existing issues and source contracts |

Review order follows newest activity when assessing intent. Integration follows dependency order. The root checkout contains unrelated uncommitted work and is not the integration workspace.

## Pass 2 · Bounded work packages

| Package | Paths / refs | Checks and acceptance |
| --- | --- | --- |
| R1 · Freeze and classify | Open PRs #24, #25, #29–#33, #48, #53–#57; `origin/main` | Compare ancestry, `git cherry`, and final file contents. Identify superseded work before deciding to merge. Preserve branch history |
| R2 · Review mobile | #48; `mobile/`, `contracts/` | Review adapters, per-person state, storage, deep links, notification permission and cancellation. Run mobile tests, TypeScript, and lint. Preserve build 3 source and its distinct test-build evidence |
| R3 · Review durable backend | #53; `server/src/`, migrations, native harness, deployment templates | Review active identity/assignment checks, session/case locking, request ownership, idempotency, postconditions, atomic audit, proof gates, and deployment defaults. Run typecheck and full backend tests. Native PostgreSQL uses a fresh isolated schema only when the local target is available |
| R4 · Review participant flow | #54/#55; `participant-web/`, `server/test/hosted-participant-rehearsal.test.ts` | Verify fragment cleanup, no persistent token storage, verified role/case readback, exact same-key retry, uncertainty handling, and acknowledgement-only behavior. Run frontend tests/check/build and headless loopback rehearsal |
| R5 · Review notification intent | #56; `003_notification_intents.sql`, `notification-intents.ts`, tests | Review current owner/state/revision, semantic uniqueness, cancellation, minimal payload, and atomic audit. Merge migration 003 with the latest native harness and local-pilot documentation |
| R6 · Review shared demo | #57; `shared-demo-site/`, `contracts/demo-resources/v1/`, demo-day models/docs | Review server-verified Google identity plus role capability, expiry/cookie recovery, revision compare-and-swap, request provenance, scheduling and skill transitions, public source parity. Run resource validation, unit tests, TypeScript/build, local D1 rehearsal; inspect changed visuals and validate changed models |
| R7 · Review contributor tooling | #29/#30/#33; `.devcontainer/`, `.github/`, `fixtures/`, staging/preflight scripts, contributor docs | Reconcile current docs. Use fictitious fixture for credential-free checks. Confirm private targets cannot collide with release/peer assets. Run local checks and target-preflight tests. Private forwarded-port and real contributor acceptance remain separate |
| R8 · Review isolated mail tour | #32; `mail-tour/`, tour preview, fake-MailApp tests | Review opt-in confirmation, one-use token/caps, recipient validation, no automatic activation from the public page, and separate scope/project. Run fake-mail tests. Resolve source only; endpoint 403, consent and controlled delivery remain explicit gates |
| R9 · Integrate and repair | `codex/branch-integration-review` based on current `origin/main` | Merge unique work in dependency order; resolve conflicts intentionally. Preserve current mobile head, shared-demo local pilot and resources, migration 003, and synthetic-only fixtures. Run `git diff --check` and the relevant combined checks after repairs |
| R10 · Resolve PRs | GitHub metadata and integration PR | State which source heads are included and which are superseded by #39. Do not equate PR closure with issue acceptance. Keep a reviewable integration record and use expected head SHA for a merge |

## Frozen PR inventory and proposed disposition

| PR | Head | Dependency | Initial disposition |
| --- | --- | --- | --- |
| #57 | `f305358` | #55 | Review shared demo/local pilot and integrate unique source |
| #48 | `e835f6a` | main | Review current mobile source; integrate before backend stack |
| #55 | `d763503` | #54 | Review synthetic rehearsal and integrate |
| #54 | `6efc468` | #53 | Review frontend foundation and integrate |
| #53 | `fd9362b` | #48 | Review backend foundation and integrate with later pilot fixes |
| #56 | `0810fdd` | #53 | Review intent-only ledger; integrate with current backend |
| #24 | `bd0295b` | main | Final guard patch-equivalent on main; verify complete coverage and close as superseded |
| #29 | `ed6a9a4` | main | Conflicting documentation; compare with #39 before choosing any remaining text |
| #33 | `949db90` | #29 | Review and integrate unique contributor test-target tooling |
| #32 | `b3df0e9` | feature/demo-final | Review isolated dormant sender; retain live-delivery gate |
| #31 | `409d604` | #25 | Head is ancestor of main; close as incorporated through #39 |
| #30 | `95a83f7` | #25 | Review unique contributor checks and integrate |
| #25 | `2270c3f` | #24 | Verify source coverage through #31/#39; close as superseded if complete |

These are dispositions to verify, not completed merge claims.

## Acceptance after source consolidation

| Sequence | Outcome and exact next check | Owner / gate |
| --- | --- | --- |
| A1 | Record deployed Site version and complete assigned-account two-phone success, decline/reschedule, wrong-role, reload, and persisted outcome checks | #58 and #50; user/device/account participation |
| A2 | Install the published Android test build on a physical phone; record install, cold start, browser handoff and assigned session. Record iPhone browser independently and resolve Apple signing/distribution for a native install | #47; physical devices and Apple signing |
| A3 | Complete PostgreSQL server routes for the full intended lifecycle with trusted evidence and reviewed identity; choose hosting/origin configuration and resource ownership before a service deployment | #49/#50; deployed-service target and cost/ownership approval |
| A4 | Freeze explicit mappings between legacy five-topic/mobile IDs and the four-topic shared resource pack. Choose a single writer and migrate with reconciliation and rollback before either client treats PostgreSQL as authoritative | `docs/demo-day/MOBILE_SOURCE_MAPPING.md`; architecture/cutover review |
| A5 | Verify dedicated Google target, accounts, project, exact scopes and role/resource mappings; exercise free/busy, event, invite/response, Sheet exchange, conflict and uncertain retry with readbacks | #52; required Google consent/target gates |
| A6 | Register trusted person-specific proof/version; verify Drive and local copies and matching hashes; then test one justified skill update, duplicate replay, concurrency and missing/corrupt evidence | #49/#52 and existing owner-only evidence gates; no proof shortcut |
| A7 | Resolve recipients, notification attempt/uncertainty ledger, state reread immediately before delivery, consent/token lifecycle and exact current-task links; verify send/receipt/tap/cancellation separately | #51; provider/consent and connected delivery gates |
| A8 | Resolve optional public sender 403 and verify one controlled opt-in sequence before activating any public send interaction; complete contributor private-port and distinct-account smoke checks | #34/#28/#27; public sender and contributor acceptance |
| A9 | Run fresh individual/group/failure paths on the exact release; retain private evidence and inspect the recording. Record ADONIS-native import if that tool is used | Existing full-run/device gates and #58 |

Source cleanup can finish before A1–A9. None of those open acceptance checks should be marked complete from a merge, a synthetic test, or an old deployment.

## Execution record

- Integration baseline: `origin/main` `4b60cfc`; fetched 30 October 2026.
- Workspace: isolated managed worktree `branch-integration-review`; branch `codex/branch-integration-review`.
- Initial review finding: #31 is an ancestor of main; `git cherry origin/main origin/codex/form-identity-gate` reports the last guard patch as equivalent.
- Further source review, repairs, tests, and PR dispositions are recorded below as they complete.


### Source integration checkpoint

All thirteen frozen PR heads are now represented in the isolated candidate history. #25/#31 were already on main; #24 added ancestry without an Apps Script content change; #29's stale final text was resolved using the current release documentation. The remaining unique heads were merged, preserving the latest mobile tree and public browser simulator.

The [review record](INTEGRATION_REVIEW_2026-10-30.md) documents five repaired findings and their regressions, including native PostgreSQL races. An independent reviewer inspected the repairs and found no remaining actionable P1/P2 in that scope after the participant registration repair. Final local checks and GitHub CI determine whether this candidate can merge. Product acceptance A1–A9 remains open.
