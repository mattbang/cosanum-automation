# Development plan

Der aktuelle Produktstand mit festen Feature-IDs und dem jeweils nächsten offenen Check steht im [Feature-Register](FEATURE_REGISTER.md). Aufgaben und Tagesfortschritt bleiben im [Kanban](https://github.com/users/mattbang/projects/1).

Each increment below should end with a visible behavior and a repeatable acceptance check. Use synthetic data and test accounts. Keep source code local and versioned; keep credentials, individual evidence, and operational data outside this public repository.

The [workflow asset inventory](WORKFLOW_ASSETS.md) links each step to its interface mockup, Calendar event, Form, proof, archive, checklist, and notification template. Use and update those canonical design inputs when building an increment so fields and wording are not recreated independently.

Use the [GUI design baseline](GUI_DESIGN_BASELINE.md) as the interface starting point for these increments. Its screen map covers the user-facing work from intake through audit; the functional acceptance checks below remain the delivery gates.

| # | Deliverable | Acceptance check |
| --- | --- | --- |
| 01 | Deployable demo interface and five-topic synthetic catalogue | The test URL loads; five topics come from the demo Sheet; rerunning setup creates no duplicates. |
| 02 | Manual need entry and skill prerequisite gate | Valid next-level choices save; skipped, excluded, and unknown levels are blocked with reasons. |
| 03 | Group/individual mode, qualified trainer, and theory/practice plan | Group and individual trainers follow their rules; theory and practice durations and order are correct. |
| 04 | Calendar free/busy and varied slot proposals | Every selected calendar is checked; no proposed slot overlaps a busy period; missing access is shown as an error. |
| 05 | Booking and invitations | One selected proposal creates one correctly timed event; retry creates no duplicate. |
| 06 | RSVP monitoring | A declined group participant is flagged while the session remains for others; unanswered invitations are flagged before training. |
| 07 | Trainer assessment | A manually inspected Google Form uses Verified email collection; its owner-check time is recorded before its link is released. Only the assigned trainer's later response can record attendance and result; absent or unsuccessful participants remain open. |
| 08 | Individual participant acknowledgement | A verified account response closes only its assigned case; wrong-account and duplicate responses do not. |
| 09 | Individual proof document and PDF | Each successful participant receives a separate, visibly marked demo proof with source evidence links. |
| 10 | Matching Drive and local archive | The PDF is present in both places with matching hashes; missing or corrupt local copies leave the case pending. |
| M | Dedicated demo account cutover, after 10 and before connected 11 | A new-owner script and owner-only deployment replay one bounded path from fresh synthetic data; the old account's assets remain intact. See the [Gate M acceptance milestone](https://github.com/mattbang/cosanum-automation/issues/19). |
| 11 | Automatic synthetic skill update | A verified case applies its explicit target once; replay and concurrent Sheet edits do not cause an incorrect raise. |
| 12 | Two-day and five-day reminders | A simulated clock produces one reminder at each due point, with none for cancelled, absent, or completed cases. Use the [notification templates and delivery contract](NOTIFICATION_TEMPLATES.md). |
| 13 | Completion, exception notices, and audit view | A fully completed request sends one notice; open cases produce exceptions and remain searchable with evidence links. Use the [notification templates and delivery contract](NOTIFICATION_TEMPLATES.md). |
| UX1 | Demo Hub and guided admin workflow, after M and 13 | The owner-only app shows scenario entry, one current Process & Quality task, and per-person results. Progress comes from saved records; navigation never changes workflow state. |
| UX2 | Group entry, role tour, and feedback, after UX1 | One starting link explains the roles and provides feedback. Trainers and participants act through their own assigned Google invitations and Forms; the role tour grants no access. |
| 14 | Automate verified-email Form settings | Forms REST sets and reads back `VERIFIED` for trainer and participant Forms; a changed or unreadable setting blocks release. Keep the manual inspection gate until the connected API check passes. |
| 15 | Searchable Drive proof metadata and checksum verification | Drive Advanced Service links the existing Doc and PDF to stable case/version IDs; the stored PDF's SHA-256 matches the local copy before completion. |
| 16 | Clean integrated replay, measurement, and screen recording | Group, individual, and failure cases replay from fresh synthetic data. Record observed time and manual actions; after one complete successful run, capture and verify screen footage of the entire path. |

## Contributor development track

The [contributor development plan](CONTRIBUTOR_DEVELOPMENT.md) records the contributor track; the Kanban holds its acceptance status. [#27](https://github.com/mattbang/cosanum-automation/issues/27) standardizes a clean checkout, synthetic read-only preview, local checks, and pull-request CI. [#28](https://github.com/mattbang/cosanum-automation/issues/28) establishes a separate, access-reviewed Google test environment for team connected work. Local checks can run during a Google authorization blocker; they do not satisfy an increment's connected acceptance check. A shared test environment may support later team replay, but it does not widen the owner-only v0.1 app or change member access requirements.

## Public synthetic tour and historical environment

The [public role tour](https://mattbang.github.io/cosanum-automation/demo-tour/) now presents a role-only, synthetic week of availability, a selected shared slot, and role-labelled email previews at the existing URL. [#34](https://github.com/mattbang/cosanum-automation/issues/34) tracks the separate, opt-in mail tour in [draft PR #32](https://github.com/mattbang/cosanum-automation/pull/32). Its local tests passed, but live delivery and the public endpoint have not passed connected verification; the current tour sends no mail. Address variants may label one inbox's sample messages but cannot represent separate verified Google identities. This visitor simulation does not satisfy the private app's assigned-account, controlled-mail, or replay checks.

**Owner-only release checkpoint, 24 October 2026:** [PR #39](https://github.com/mattbang/cosanum-automation/pull/39) integrated the operator/mobile work and final Form setup guard. The dedicated editor `@HEAD` has a connected, bounded Form identity check; its source was read back exactly and deployed as numbered `/exec` version 6. That version has not passed a fresh complete workflow run. Its restricted manifest has no `script.send_mail`; connected reminder and completion delivery remain separate release checks. The local private checkpoint records the source comparison, account verification, deployment readback, and remaining acceptance work.

Gate M established the dedicated owner while preserving the earlier environment as historical evidence. [#35](https://github.com/mattbang/cosanum-automation/issues/35) is the separate retirement decision and verification gate. Review its private audit before stopping old automation or access; retain historical records until the retirement scope is approved and checked. This follow-up does not reopen Gate M or alter the v0.1 release sequence.

## Review gates

- **Scheduling:** after 05, demonstrate a valid free slot and one test-calendar invitation.
- **Evidence:** after 10, demonstrate a signed-off individual proof in both archives.
- **Dedicated account:** after M, demonstrate a clean connected path under `cosanum.training.demo@gmail.com` before accepting 11.
- **Skill:** after 11, demonstrate one justified level update without duplicate application.
- **Guided demo:** after UX1 and UX2, a new tester can start from one link, understand the next role handoff, find a result and feedback by request ID, and see separate statuses for people in one group event. The admin app remains owner-only.
- **Full demo:** after 16, run the group and individual paths plus the main exceptions and retain a complete successful screen recording that shows the role handoffs privately.

## Later bounded UX and access work

- **UX3 — Configurable test runs:** After the fixed-roster demo, add run and scenario IDs, validated unique Google addresses, role and per-topic synthetic skill data, schema migration, and isolation between testers. An entered address never establishes respondent identity.
- **ACCESS1 — Independent Process & Quality operators:** After a separate identity design, verify allowed and unlisted accounts at the server before widening admin access. The first group release uses the dedicated demo coordinator; no owner password is shared.

Each change should be a focused branch or pull request. The handoff must state what changed, which checks passed, which connected services were tested, any demo side effects, and any concrete limitation. A local fake is useful for fast rule checks, but a feature that promises a Google integration is finished only after its connected acceptance check passes.

For Increment 07, the original personal Gmail account made `FormApp.setCollectEmail(true)` create a typed email field. The default Apps Script Cloud project returned `SERVICE_DISABLED` for Forms REST. Gate M moved the demo to a dedicated owner and standard Cloud project. The dedicated editor `@HEAD` later passed a bounded Forms REST setting and assigned/wrong-account check. Version 6 is deployed on the dedicated owner-only `/exec` path, but its fresh Forms and browser checks remain open; the earlier editor result alone does not establish acceptance of version 6.
