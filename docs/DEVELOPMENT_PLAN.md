# Development plan

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
| 11 | Automatic synthetic skill update | A verified case applies its explicit target once; replay and concurrent Sheet edits do not cause an incorrect raise. |
| 12 | Two-day and five-day reminders | A simulated clock produces one reminder at each due point, with none for cancelled, absent, or completed cases. Use the [notification templates and delivery contract](NOTIFICATION_TEMPLATES.md). |
| 13 | Completion, exception notices, and audit view | A fully completed request sends one notice; open cases produce exceptions and remain searchable with evidence links. Use the [notification templates and delivery contract](NOTIFICATION_TEMPLATES.md). |
| 14 | Clean integrated replay and measurement | Group, individual, and failure cases replay from fresh synthetic data; observed time and manual actions are recorded. |

## Contributor development track

The [contributor development plan](CONTRIBUTOR_DEVELOPMENT.md) adds a cross-cutting track beside the numbered product increments. [#27](https://github.com/mattbang/cosanum-automation/issues/27) standardizes a clean checkout, synthetic read-only preview, local checks, and pull-request CI. [#28](https://github.com/mattbang/cosanum-automation/issues/28) establishes a separate, access-reviewed Google test environment for team connected work. Local checks can run during a Google authorization blocker; they do not satisfy an increment's connected acceptance check. A shared test environment may support later team replay, but it does not widen the owner-only v0.1 app or change member access requirements.

## Review gates

- **Scheduling:** after 05, demonstrate a valid free slot and one test-calendar invitation.
- **Evidence:** after 10, demonstrate a signed-off individual proof in both archives.
- **Skill:** after 11, demonstrate one justified level update without duplicate application.
- **Full demo:** after 14, run the group and individual paths plus the main exceptions.

Each change should be a focused branch or pull request. The handoff must state what changed, which checks passed, which connected services were tested, any demo side effects, and any concrete limitation. A local fake is useful for fast rule checks, but a feature that promises a Google integration is finished only after its connected acceptance check passes.

For Increment 07, the owner's personal Gmail account made `FormApp.setCollectEmail(true)` create a typed email field. The default Apps Script Cloud project returned `SERVICE_DISABLED` for Forms REST. This prototype therefore requires Daniel to select **Verified** in each Form's Google Settings and record that inspection in the admin UI; later setting changes cannot be detected automatically. A standard Cloud project migration is a separate reviewed deliverable before production identity claims.
