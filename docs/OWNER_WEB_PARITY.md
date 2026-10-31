# Owner web app parity checkpoint — 31 October 2026

The owner-only Apps Script app remains the connected training workflow. Its audit, Google Calendar booking, verified trainer and participant Forms, proof, archive, and skill gates stay authoritative for the private demo.

This increment adds an owner overview with request counts, a bounded work queue, person-level next tasks and responsible actors, plus a read-only view of the private catalogue, source names, attained skill matrix, and booked sessions. Counts and badges come from the saved audit projection. The resource endpoint checks the demo owner and rejects missing, duplicate, or invalid matrix entries.

| Capability in the Android build or shared Site | Owner web app decision |
| --- | --- |
| Task-focused home, attention queue, person-level next task | Add from the private audit projection. The queue selects an existing request and performs no workflow write. |
| Topic and skill matrix, learning resources, example calendar | Show the private five-topic catalogue, source names, attained matrix, and actual booked sessions. Source names are not presented as material downloads; free slots still require the existing per-session Google check. |
| Requester, reason, deadline in a synthetic request | Keep outside the connected intake until the request schema, validation, and receiving role are agreed. The private request still selects topic, target level, and people. |
| Participant offer choice, early start, rescheduling, cancellation, and role room | Keep in the shared Site's separate synthetic room. The owner app retains its existing Google invitation and Forms handoff; an exception may call for a replacement plan, but this increment does not claim a connected rescheduling action. |
| Individual retries and device-local reminders | Keep in the Android prototype until attempts, evidence, and notification delivery have a private workflow contract. |

The Android build's local fixture and the shared Site's `TR-*` courses do not share IDs, phase rules, or persisted state with the private `TC_R*` Sheet. No synthetic completion or skill change is imported into the owner app. The owner-only manifest and mail scopes are unchanged.

Local verification covers the projection tests, the existing suite, and an offline preview at desktop and 390 px widths. Connected readback of the new resource endpoint and a numbered owner-only deployment are separate checks.
