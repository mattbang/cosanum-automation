# Phone compatibility handoff

Scope: [board issue #10](https://github.com/mattbang/cosanum-automation/issues/10), the owner-only v0.1 Demo Hub and its existing Google Calendar and Form handoffs. This does not change member access or create an installed app.

## Local source changes

- The owner view now keeps navigation, request selection, current status, errors, and the next action within a narrow viewport. Controls have 44 px minimum height and a visible keyboard focus outline.
- Workflow tables become labeled case cards below 600 px. Their labels come from the table headers as rows are rendered, so the same actions and evidence links remain available without a sideways table scroll.
- Long IDs, links, and notes can wrap without widening the page. The public role tour already uses a one-column layout below 650 px.
- Trainer and participant Forms retain the required attendance/result/attestation and affirmative checkbox/typed-name fields. Existing server-side assigned-account and Form identity checks remain unchanged.

Local checks passed: `node scripts/test_demo_hub.mjs`, `node scripts/test_demo_tour.mjs`, `node scripts/test_trainer_assessment.mjs`, `node scripts/test_participant_acknowledgement.mjs`, `node scripts/test_forms_identity.mjs`, and `git diff --check`.

## Connected acceptance still required

After issue #5 publishes the reviewed owner-only source, record the exact commit, Apps Script deployment ID/version, Form IDs, Calendar event ID, date, device and browser versions, and screenshots in the private run record. Do not put account addresses, Form responses, or screenshots of personal records in this public file.

1. On iPhone/Safari and Android/Chrome, open the owner Demo Hub with the owner account. Check 320–430 px widths, portrait and landscape, keyboard focus, touch targets, and that the current task, status, error, and primary action fit without horizontal scrolling. Visit the trainer, participant, exception, and register views with a synthetic case.
2. Open the assigned Calendar invitation and trainer Form link on each mobile browser. Confirm the intended session/person, required attendance, result, and attestation fields, and submission from the assigned trainer account. Try a different test account and verify it cannot advance the case.
3. After the trainer result is accepted, open the participant Form link. Confirm the required affirmative checkbox and typed name, submit from the assigned participant account, then try a different test account. Verify only the assigned response advances that person's case and that supporting evidence remains reachable from the owner register.
4. Record observed failures and retest after fixes. Issue #10 remains open until this connected path and screenshots are complete.

Google-hosted Form and Calendar responder layouts are external to `Index.html`; their mobile behavior must be observed on the published links.
