# Integration review · 30 October 2026

Baseline: `main` at `4b60cfc`. Candidate branch: `codex/branch-integration-review`. Source repairs: `1a4a178`. The [resolution roadmap](BRANCH_RESOLUTION_2026-10-30.md) defines dependencies, work packages and subsequent acceptance.

## Review scope and result

The lead reviewed the unique first-party workflow, role/identity, request/session/case, participant response, notification intent, local pilot, shared room, mobile adapter, contributor staging, and isolated mail sender changes across the thirteen open drafts. Vendored UI/starter libraries were not audited line by line. Integration preserved each current source head and resolved conflicts against the current release, rather than substituting older branch files wholesale.

An independent code reviewer inspected the integration repairs and CI workflow. It found the additional participant identity-registration race below, then reviewed that repair without further actionable P1/P2 findings in the inspected scope. The independent reviewer did not execute tests. Gemini Flash/Pro attempts did not reach source inspection because their CLI startup required local operations unavailable in the sandbox and the approval attempts ended; no Gemini findings or review approval are claimed.

## Findings repaired

| Finding | Failure condition and impact | Repair and evidence |
| --- | --- | --- |
| P1 · Request authority could become stale before creation | `server/src/postgres-workflows.ts` trusted the actor object after HTTP authentication, without rereading the exact active identity in the write transaction. Revocation between authentication and creation could still allow new request/case/assignment/audit rows. This is a local/foundation API gap; the production entrypoint remains unconfigured | Require issuer, subject, verified email and P&Q role; reread the exact active mapping with `FOR SHARE` through creation/replay. A PGlite regression failed before the fix and passes after it. A native separate-backend deactivation/create race confirms no request or audit write after the revocation wins |
| P2 · First hosted acknowledgement could regress a later case stage | `server/src/participant-responses.ts` required `trainerPass` but not the current assessed stage. A new acknowledgement could overwrite an already progressed case with `acknowledged` | Require `assessed` for a new response; preserve exact existing-receipt replay after later progress. Apply the same predicate in `participant-web/core.js`. Regression failed before the fix; it now denies new responses in open/invited/acknowledged/proof/archive/complete states and preserves status, revision and audit on exact retry |
| P2 · Concurrent identity registration could return a false successful claim | `server/src/participant-links.ts` selected an absent identity without a gap lock, then ignored a zero-row conditional upsert. A concurrent conflicting or inactive registration could leave accepted claim/audit and bound link/assignment even though the directory denied that person. Downstream checks prevented demonstrated cross-case access; this was false success and inconsistent binding | Require one exact active mapping from `RETURNING`; reject with 403 and roll back otherwise. Unit regression failed before the fix. Native two-backend races cover both another actor winning and an inactive exact mapping winning; link, assignment and accepted audit rollback are verified |
| P2 · An expired offer remained acceptable | `shared-demo-site/lib/demo.ts` checked the offer only when created, so a participant could accept it after its start | Revalidate the selected offer against the server's current time. The regression failed before the fix and now rejects acceptance at or after the start without changing the case |
| P2 · Linked request target could differ from the case target | The shared demo matched request topic/person but could retain a request for target 2 while planning its case at target 3 | Match the persisted request target as well. The regression failed before the fix and now rejects the mismatch. Direct synthetic planning retains its documented 1–3 range |

## Integration decisions

- #25 and #31 were already ancestors of `main` through release integration #39. The final #24 guard was patch-equivalent on `main`; recording its branch ancestry added no Apps Script content changes.
- #29's final documentation commit is superseded by the newer release/acceptance descriptions already on `main`. The contributor plan and tooling from #30/#33 are retained. Its ancestry is recorded with the current documentation, avoiding an old-status overwrite and duplicated contributor section.
- #48's latest mobile tree is preserved. The backend/participant/rehearsal/shared-demo stack (#53/#54/#55/#57) and notification ledger #56 are combined with that tree.
- #32 remains a separate dormant mail project. The newer public browser simulator is preserved byte for byte; no public send interaction is activated.
- The three checksum-tracked backend migrations are present. Existing local pilot databases with only 001/002 need an explicit admin migration step before starting this source; the least-privilege runtime must not run migration DDL. Native review schemas applied all three from scratch and replayed them.
- The held Pages navigation patch `dd3d699` is not an ancestor of the candidate. The owner-only Apps Script source and manifest are unchanged relative to the baseline. This integration performs no Site, Apps Script, Google resource or Pages deployment.
- New `module-checks.yml` adds backend type/tests with an explicit Chrome prerequisite, mobile checks, participant checks/build, resource validation and shared-demo checks/build. Existing contributor CI remains in place. Native PostgreSQL race evidence is local; the workflow does not claim a connected environment.

## Verification record

The final local checks below passed on the combined source. GitHub check results belong to the current integration PR head. Local attempts with a sandbox restriction or fixture mismatch are not counted as code passes.

| Check | Result at source-review checkpoint |
| --- | --- |
| Credential-free root suite | 24 Node script suites, Apps Script syntax and Python archive tests passed on the final combined tree |
| Mobile | 15/15 tests, TypeScript and Expo lint passed; current mobile tree preserved |
| Participant | 7/7 tests, static checks and the five-asset bundle build passed after the assessed-state readiness fix |
| Backend | 47/47 tests, including headless Chrome/PGlite rehearsal and three new regressions, and TypeScript passed after the final repair. One intermediate run exposed an expected-status assertion that was corrected to the new 403 authorization response |
| Native PostgreSQL | PostgreSQL 18.4, three migrations/replay, separate-backend deactivation/create, assignment/issue, owner/issue/revoke, conflicting/inactive registration/claim, group booking conflict, immutable response replay and rollback all passed in fresh `cosanum_native_review_*` schemas. Primary pilot schema was not migrated or reset |
| Shared demo | 15/15 unit tests passed, TypeScript and production build passed, packaged resources matched canonical v1, local D1 two-role rehearsal passed. No connected Google identity or phone acceptance inferred |
| Visual/model review | Shared demo home/calendar inspected at 390px; no clipping or overlap found in the inspected views. Existing lifecycle BPMN passed official OMG XSD, graph/lane/DI/grid/SVG checks; ADONIS-native acceptance remains open |
| GitHub CI | Require the integration PR checks on its current head before main integration; local checks above are distinct evidence |

## Acceptance intentionally remains open

Source integration does not close #47, #49, #50, #51, #52 or #58. Their next checks remain physical devices, assigned-account hosted acceptance, full durable service/deployment, mapped Google resources and scopes, trusted proof and archives, measured notification delivery, and an explicit single-writer cutover. The optional public sender's endpoint/consent/controlled-mail result and contributor private-forwarded-port/distinct-account smoke also remain open. See roadmap acceptance packages A1–A9.

Final local source readback confirms that all thirteen frozen heads are ancestors of the candidate, and Apps Script source has no diff from the baseline. `git diff --check` passes.
