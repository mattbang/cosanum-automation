# Demo notification templates and delivery contract

**Status:** Implemented locally; connected delivery acceptance remains separate. Canonical copy is in [`apps-script/NotificationTemplates.gs`](../apps-script/NotificationTemplates.gs). [`apps-script/FormDispatch.gs`](../apps-script/FormDispatch.gs) prepares verified Forms, reconciles raw trainer and participant responses, then sends the two initial requests after the session ends. [`apps-script/FollowUp.gs`](../apps-script/FollowUp.gs) and [`apps-script/Audit.gs`](../apps-script/Audit.gs) reconcile participant responses before reminders and overdue notices. No new trigger runs until `installFormRequestProcessor()` is called; the reminder and audit processors have separate installers.

The messages are German plain text with visible `[DEMO]` subjects. Plain text works as the required `body` for `MailApp.sendEmail({to, subject, body, replyTo})`. If an HTML version is added later, retain this text fallback and escape all dynamic values before inserting them into HTML. Do not put participant names or Form links in subjects. Calendar invitations are created by Google Calendar and are separate from these messages.

## Message catalogue

| Purpose | Recipient source | Event and gate | Fields beyond shared fields |
| --- | --- | --- | --- |
| `trainer_assessment_request` | Assigned trainer's registered email | Session has ended and is still invited; this person's trainer report is still missing, and the assigned Form has verified email collection. One message per person/session case. | `trainer_name`, `person_name`, `training_date`, `session_id`, `trainer_form_url` |
| `acknowledgement_request` | Assigned participant's `People.email` | Session has ended, assigned trainer records **attended + passed**, any required theory is passed, no accepted acknowledgement exists, and the assigned Form has verified email collection. | `recipient_name`, `acknowledgement_url`, `session_id` |
| `acknowledgement_reminder_day_2` | Same participant | Local training date +2 in Europe/Zurich; still attended + passed, no accepted acknowledgement, session not cancelled. | `recipient_name`, `acknowledgement_url` |
| `acknowledgement_reminder_day_5` | Same participant | Local training date +5 under the same gates. | `recipient_name`, `acknowledgement_url` |
| `exception_notice` | Configured Daniel/P&Q inbox | A selected person's case enters or changes an actionable open state. After day +5, missing acknowledgement becomes an open exception. | `person_name`, `exception_reason`, `next_action`, `dashboard_url` |
| `completion_notice` | Configured Daniel/P&Q and CCS recipients, deduplicated | **Every** selected person's case has trainer pass and accepted acknowledgement for each required phase, an individual proof, verified Drive and local copies, and the configured demo skill update. | `participant_count`, `participants_summary`, `dashboard_url` |

All templates use `topic_name` and `request_id`. Trainer and participant messages also use `training_date`, formatted as a local date such as `23.10.2026`. The completion message uses the session date; a request with multiple theory/practice dates should supply a clear date summary in `training_date` rather than an arbitrary single date. The processor must pass display-ready **strings** for every field, including `participant_count` and a comma-separated `participants_summary`. `renderDemoEmail_(purpose, fields)` returns `{purpose, templateVersion, audience, subject, body}` and throws if a required field is blank, contains a control character, or a link is not HTTPS. It does not choose recipients or send mail.

Example normalized event evaluated by the request processor:

```json
{
  "purpose": "acknowledgement_request",
  "request_id": "REQ-DEMO-001",
  "session_id": "SES-DEMO-001",
  "case_id": "CASE-DEMO-001",
  "person_key": "demo-person-01",
  "recipient_email": "participant@example.com",
  "trainer_result": "passed",
  "attendance": "attended",
  "session_status": "held",
  "training_date_local": "2026-10-23",
  "occurred_at_utc": "2026-10-23T15:00:00Z",
  "fields": {
    "topic_name": "Wareneingang",
    "request_id": "REQ-DEMO-001",
    "session_id": "SES-DEMO-001",
    "recipient_name": "Alex Beispiel",
    "training_date": "23.10.2026",
    "acknowledgement_url": "https://docs.google.com/forms/d/e/example/viewform"
  }
}
```

The event is a **normalized workflow record**, not the raw Google trigger object. The processor rereads the current Sheet state under a script lock before sending; event fields alone are insufficient proof of eligibility. It resolves the recipient from the registered person or configured administrator role, not from a Form answer or prefilled URL. The private demo allowlist restricts outgoing addresses to chosen test accounts. Keep email addresses and generated Form URLs out of the public template file and source control.

The event adapter should obtain `request_id`, `session_id`, `case_id`, topic, and person from the request/session/case register; `training_date_local` from the actual session in `Europe/Zurich`; `recipient_email` from `People.email` or role configuration; and Form URLs from the published responder Forms assigned to that case. Exception reasons and next actions should come from a small coded state-to-copy map, not free-form Form text. The processor formats these values into `fields` only after checking the current records.

## Form and link handling

The acknowledgement link must open the **published responder form**, never the editor URL. Configure the Form to collect **verified** Google account email, require an affirmative participation checkbox and typed name, and capture the response ID and timestamp. A per-person or prefilled URL may carry request/session/case identifiers for convenience, but prefilled answers are editable and must not be treated as identity or proof. Match the verified respondent email to the assigned person and session in the register; reject wrong-account, wrong-session, duplicate, and non-affirmative responses. Only an accepted response closes the acknowledgement gate. If a participant cannot confirm, the reply path goes to a monitored administrator inbox for manual handling; it does not count as a confirmation.

Only send links the recipient can open. Restrict dashboard and evidence links to authorized administrators. The participant emails contain no skill level, assessment details, archive path, or other people's names. Completion and exception notices point to the dashboard, where authorized staff can inspect source evidence. Do not attach proofs to routine messages.

## Sending and retry contract for implementation

1. Use installable Form submit triggers for trainer and participant responses and time-driven processors for initial requests, due reminders, and pending notices. The initial request processor runs daily at about 09:00 Europe/Zurich, creates or rechecks case Forms, replays raw Form responses, and only then evaluates delivery. Before installing it, run the read-only `previewFormRequestBacklog()` and inspect every past invited session and recipient. Installation records an activation timestamp; the daily trigger ignores sessions that ended before that instant. Use `processFormRequestFor({sessionId, caseId})` for a deliberate, single historical synthetic case. These are hints to re-evaluate state, not authority to skip the gates. Time-driven triggers do not promise an exact minute, so compare persisted timestamps and local due dates.
2. Before sending, acquire a script lock, re-read the case/request, verify the gate, compute a stable send key, and reserve that key in a Sheet message ledger. Suggested keys: `trainer_report:<case_id>:<session_id>`, `ack_request:<case_id>:<session_id>`, `ack_day_2:<case_id>:<session_id>`, `ack_day_5:<case_id>:<session_id>`, `completion:<request_id>`, and `exception:<case_id>:<reason_code>:<state_transition_id>`. A template edit does not create a new send key; a linked replacement session can have its own assessment and acknowledgement messages.
3. Ledger fields: send key, purpose, template version, request/case/session IDs, recipient(s), due time (UTC), attempt time (UTC), sent time (UTC), state (`reserved`, `sent`, `failed`, `unknown`), and error summary. Record recipient addresses in the private demo Sheet only. Suppress duplicates by send key, including when Daniel and CCS resolve to the same demo inbox.
4. Render and validate before calling `MailApp.sendEmail`. Use a monitored `replyTo`; do not use `noReply` because the copy asks recipients to report discrepancies. Check the remaining daily recipient quota and surface a pending state if unavailable. Add the `https://www.googleapis.com/auth/script.send_mail` scope only when the sender is implemented and authorized.
   `.claspignore` includes `NotificationTemplates.gs`, `FormDispatch.gs`, `FollowUp.gs`, and `Audit.gs`; deploy and run a connected send check only after the account's mail scope is approved.
5. If `MailApp.sendEmail` returns, mark the ledger row `sent`. A crash between reservation, send, and ledger update leaves delivery uncertain. Recovery should treat a stale `reserved` row as `unknown` and require review before retrying; blindly resending could produce duplicates. A known pre-send validation failure can be retried after correction.
6. Completion is one notice for the whole request, sent only after the last selected person clears every evidence and skill gate. An exception remains separate while any case is open. Increment 13 uses one exception key per person and coded reason (`exception:<case_id>:<reason_code>`), suppressing repeated scans of that reason. A later distinct reason creates its own key. Returning to an earlier reason does not automatically resend it; Daniel can inspect the prior notice in the ledger.
7. Increment 13 reads the configured CCS address from the private `DEMO_CCS_EMAIL` script property. When unset it uses the owner address for both demo roles, then deduplicates recipients. Both addresses must match a `People.email` row in the ignored private fixture. The owner-only audit dashboard includes source links and archive paths; it cannot mark evidence complete. The daily notice trigger is installed only after the connected acceptance check.
8. The request processor uses stable keys `trainer_report:<case>:<session>` and `ack_request:<case>:<session>`. It checks the session end time, current trainer result, case-to-Form assignment, verified email setting, Calendar event, registered recipient, and quota. A stale reservation or uncertain `MailApp` call becomes `unknown` and never triggers an automatic resend. The request processor does not substitute a rejected or unverified Form response for accepted evidence.
9. Before a due reminder or overdue audit notice, the processor reads the assigned participant Form's raw responses and stores any unprocessed response through the normal identity, timing, and acknowledgement gates. An accepted response suppresses missing-confirmation mail. If Forms cannot be read, the reminder for that case and the entire audit notice run fail closed. The initial request processor also replays trainer and participant responses before dispatching their respective links. Reminders require a `sent` initial acknowledgement request in the ledger and at least 24 hours since that send, so independently timed daily triggers cannot mail a reminder before or immediately after the first request.

### Google references

- [MailApp `sendEmail` and quota](https://developers.google.com/apps-script/reference/mail/mail-app)
- [Installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [Lock Service](https://developers.google.com/apps-script/reference/lock/)
- [Google Forms verified email setting](https://support.google.com/docs/answer/139706)
- [FormResponse identity and timestamp](https://developers.google.com/apps-script/reference/forms/form-response)
- [Sharing and prefilled responder links](https://support.google.com/docs/answer/2839588)
