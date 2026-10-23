# Admin request and case audit template [DEMO]

The [interface mockup](workflow_mockup.html#case) shows the page. This file defines the data that page must expose. One request contains selected person cases; each case contains one or more required session phases. Daniel can filter by topic, person, request ID, status, and date. The default work queue shows only actionable open cases.

## Request header

| Field | Meaning |
| --- | --- |
| Request ID, creator, created time | Stable origin and creation audit. |
| Topic ID, display name, material version | The exact training content selected. |
| Mode, selected people, phase plan | Scope of the all-complete decision; selected people cannot disappear because they declined. |
| Request status | `draft`, `scheduled`, `open_exception`, or `complete`; derived from case gates, not a manual toggle. |
| Completion notice key and sent time | Visible only after every selected case is complete. |

## Person case and phase rows

Show `case_id`, `person_key`, registered email, previous skill level, explicit target, and next permitted action. For **each required phase**, show:

| Field group | Minimum fields and link |
| --- | --- |
| Session | `session_id`, phase, trainer, start/end in Europe/Zurich, location, Calendar event ID/link, cancelled/replacement relation. |
| RSVP | Guest response (`accepted`, `declined`, `tentative`, `needsAction`), last checked time, previous-business-day flag. Label RSVP as scheduling evidence only. |
| Trainer assessment | Attendance, result, note, verified trainer email, Form response ID/time, read-only evidence link, revision. |
| Participant acknowledgement | Affirmative answer, typed name, verified email, Form response ID/time, accepted/rejected reason, read-only evidence link. |

Below the phases, show proof ID/version, Doc/PDF links, local archive path, Drive/local SHA-256 and verification time, skill change ID with prior/target/applied time, and notification ledger states. A pending step must visibly say what is missing. Preserve older proof versions and assessment revisions in the timeline.

## Action mapping

| Current condition | Visible explanation | Allowed action |
| --- | --- | --- |
| Invalid progression, blank or `–` | Why the person cannot be selected | Open demo Sheet; correct source; re-read and recheck. |
| Calendar unavailable or conflicting | Which calendar failed or became busy | Check sharing or select a newly verified slot. |
| Invitation declined | Which person declined; other group guests remain booked | Plan a linked replacement session. |
| Invitation unanswered before session | RSVP still unknown, not absent | Contact person or wait; keep booking. |
| Absent, needs follow-up, or not assessed | Trainer's actual result and note | Arrange follow-up; never send confirmation request for this phase. |
| Confirmation missing after trainer pass | Days since original local date; day +2/+5 send states | Request a new link or record contact note; still await verified response. |
| Wrong account/session or duplicate Form response | Rejection reason and response ID | Investigate and request a valid response; no manual acceptance switch. |
| Drive or local archive pending/error | Copy, path, and hash state | Retry the failed archive step; re-verify bytes. |
| Matrix changed while waiting | Prior level no longer matches source snapshot | Daniel reviews source and decides on a new valid request or correction. |
| All evidence verified and skill applied | Every phase and archive gate passed | No manual action; processor sends one completion notice. |

## Audit event shape

Record an append-only event for each state transition or attempted external write: `event_id`, `request_id`, `case_id` when applicable, `session_id` when applicable, event type, old/new state, actor or service, occurred time in UTC, source record ID, idempotency key, and error/rejection reason. The skill change additionally records `person_key`, `topic_id`, `previous_level`, `target_level`, `proof_id`, applied time, and its own idempotency key. A changed Sheet level is a conflict event, not a silent overwrite.

The admin page may link to raw evidence but should never expose respondent edit links as audit links. Participant and trainer views show only their own assigned work; the admin evidence chain stays restricted to Daniel/P&Q.
