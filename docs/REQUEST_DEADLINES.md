---
{"id":"request-deadlines","type":"module-design","title":"Request deadlines and person-level overdue state","status":"active"}
---

# Request deadlines

The private owner app records a requested completion date and, where applicable, an already approved onboarding due date for an individual person case. The earlier date determines whether that person is overdue. Both sources remain visible. A shared session never makes one person's deadline or completion apply to another person.

## Date and workflow meaning

A deadline is a Gregorian `YYYY-MM-DD` calendar day in `Europe/Zurich`, inclusive through the end of that day. Remaining and overdue days are calendar days, calculated from date ordinals rather than elapsed 24-hour periods. Legacy requests without a date show **Frist nicht erfasst**; the app does not infer a deadline from a booking or reminder.

Deadline status is separate from the existing audit result. An incomplete case can be upcoming, due today, or overdue even while evidence or an archive is blocked. Cancellation and an approved exception remain distinct dispositions; neither satisfies training completion. This module reads an existing `cancelled` request/case or `exception_approved` case status and provides no command to grant either disposition.

Each new revision records the exact person cases it applies to. A shared reschedule captures only the currently editable cases, so cancelled and excepted peers and completed cases without a known completion time retain their prior dates and histories. Global stream revisions are validated before each person's applicable history is selected; that person's history can therefore have gaps in its revision numbers. Reopening a case does not retroactively apply revisions that excluded it.

Only the existing verified audit projection can establish completion. Its persisted skill-application timestamp determines whether completion was on time or late. Missing completion time is explicit and never counted as on-time completion. For a completed person, the applicable deadline is reconstructed from changes recorded on or before that completion timestamp. A later group reschedule therefore cannot rewrite that person's completion timing. Changes to the shared request date affect its remaining open cases; a person-policy date cannot be changed after that person's case ends.

## Sources and revision history

`DeadlineChanges` is an append-only Sheet ledger in schema 13. A stream is identified by request ID, case ID and source. Request dates use an empty case ID and source `request`; a person's approved-policy snapshot uses that exact case ID and source `policy`. Each row records its stable change ID, date, source reference, Process & Quality owner key, previous/current revision, reason, UTC time and authenticated actor. The first row preserves the original date. Revisions never overwrite earlier rows.

The trailing fourteenth column, `case_scope_json`, stores a sorted JSON array of the affected case IDs. A policy revision names only its exact case. Malformed, duplicate or foreign-request scopes and inconsistent case registries fail closed. A blank legacy shared scope retains its historical global behavior and is labelled explicitly in the history; it is not reconstructed from today's active cases. A legacy policy remains bound to its existing case ID. New writes always record scope. Exact replay returns the persisted scope and timestamp even if a peer ended after the first write; full-row readback includes that scope.

The owner enters the request date and source during intake. A legacy request can receive its first deadline through the deadline editor. A person-policy entry requires a named source including its rule version and an explicit owner confirmation that it is already approved. This is a manually recorded policy snapshot, not an automated policy lookup or independent verification of an onboarding rule. [#65](https://github.com/mattbang/cosanum-automation/issues/65) owns the policy register and rule calculation.

All browser commands pass through the [owner-session dispatcher](APP_SESSIONS.md). Under the script lock, the deadline command rereads the owner, exact request/case, current audit state and source revision. Stale revisions, invalid dates, missing reasons, ambiguous targets and changes to ended cases are rejected. Exact retries return the original row; reuse of a change ID with a different payload fails. The app confirms a save only after the same row is read back. A timeout after append can be retried with the original command and key.

Initial request/case creation and its deadline append are separate Sheet writes under one script lock. If the deadline write fails after request creation, the UI reports failure; retrying the unchanged draft key recovers the existing request and deadline without creating duplicates. Older internal callers may omit the initial deadline and retain an explicit unset state. A supplied malformed deadline or absent deadline tab is rejected before a new request is created.

## Owner interface

The request and person summaries show dates and current due state. The deadline editor displays each source, original/current date and revision history. Its shared date applies to open cases; selecting a person edits only that person's approved-policy snapshot. The overdue queue contains person cases whose current projection is overdue, sorted by overdue age. Its action selects the exact request, replaces stale register search/filter values and opens that case's evidence record.

The local preview includes fictional due-today and overdue examples and keeps all workflow writes blocked. These samples do not update Google or demonstrate connected persistence.

## Setup and verification boundary

Reading a schema-12 Sheet without `DeadlineChanges` remains supported and yields unset deadlines. An explicit reviewed `setupDemo_()` run creates the new empty tab through the existing setup path; it does not backfill dates or alter prior workflow evidence. Saving a deadline before that tab exists fails with a setup instruction. The [deployment allowlist](../.claspignore) includes `Deadlines.gs`; no manifest scope is added.

The scoped ledger is the first connected schema-13 definition: its earlier 13-column draft was never deployed. An existing 13-column or otherwise ambiguous header is rejected without mutation; there is no automatic migration that invents the historical audience.

Local verification:

```sh
node scripts/test_deadlines.mjs
node scripts/test_intake.mjs
node scripts/test_local_preview.mjs
node scripts/verify_deadline_ui.mjs
npm run check
```

The optional UI verifier uses Chrome in a fresh profile against a loopback read-only preview; set `COSANUM_CHROME_PATH` outside macOS. It checks exact-case navigation despite a stale filter, source history, a blocked save, browser exceptions and overflow at 1440/390 px. The date/persistence tests cover distinct group dates, Zurich midnight/DST, completion before/after due date, later group rescheduling, terminal dispositions, stale revisions, conflicting retries, lost responses and failed readback. The full root check requires committed Apps Script source because its contributor-target preflight pins the source commit.

Live schema setup, numbered deployment and a permitted update/readback on the dedicated target remain connected acceptance for [#66](https://github.com/mattbang/cosanum-automation/issues/66). They require coordination with the current connected replay owner. Reminder delivery belongs to [#68](https://github.com/mattbang/cosanum-automation/issues/68).
