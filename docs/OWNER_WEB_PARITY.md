# Owner web app parity checkpoint — 31 October 2026

The owner-only Apps Script app remains the connected training workflow. Its audit, Google Calendar booking, verified trainer and participant Forms, proof, archive, and skill gates stay authoritative for the private demo.

This increment adds an owner overview with request counts, a bounded work queue, person-level next tasks and responsible actors, plus a read-only view of the private catalogue, source names, attained skill matrix, and booked sessions. Counts and badges come from the saved audit projection. The resource endpoint checks the demo owner and rejects missing, duplicate, or invalid matrix entries.

| Capability in the Android build or shared Site | Owner web app decision |
| --- | --- |
| Task-focused home, attention queue, person-level next task | Add from the private audit projection. The queue selects an existing request and performs no workflow write. |
| Topic and skill matrix, learning resources, example calendar | Show the private five-topic catalogue, source names, attained matrix, and actual booked sessions. Source names are not presented as material downloads; free slots still require the existing per-session Google check. |
| Requester, reason, deadline in a synthetic request | Request deadlines now have a local owner-app implementation under [#66](REQUEST_DEADLINES.md), with a separate append-only ledger and person-level overdue view. Connected setup/readback remains open. Requester and request-reason fields still need their own private workflow contract. |
| Participant offer choice, early start, rescheduling, cancellation, and role room | Keep in the shared Site's separate synthetic room. The owner app retains its existing Google invitation and Forms handoff; an exception may call for a replacement plan, but this increment does not claim a connected rescheduling action. |
| Individual retries and device-local reminders | Keep in the Android prototype until attempts, evidence, and notification delivery have a private workflow contract. |

The Android build's local fixture and the shared Site's `TR-*` courses do not share IDs, phase rules, or persisted state with the private `TC_R*` Sheet. No synthetic completion or skill change is imported into the owner app. The owner-only manifest and mail scopes are unchanged.

Local verification covers the projection tests, the existing suite, and an offline preview at desktop and 390 px widths. Connected readback of the new resource endpoint and a numbered owner-only deployment are separate checks.

## UI refinement — 6 November 2026

The owner interface now uses a shared type scale, spacing tokens, the approved plum and lilac surfaces, and a darker coral primary button with 5.06:1 text contrast. A compact navigation bar and view-specific headings make the current task clearer. The overview gives the new-request action priority and keeps saved counts, person-level responsibilities, and case details readable. Workflow steps scroll horizontally on smaller screens. The new-request action clears the previous selection and draft key before opening intake.

Keyboard navigation includes a skip link, visible control focus, and programmatic current-view and current-step states. Overview loading uses placeholders instead of invented counts; read errors offer a retry, and empty overview and search results explain the next step. The offline adapter permits only the internal skip link while retaining its external-link and workflow-write blocks. Typography uses a local Manrope preference with the platform sans-serif fallback; no external font requests are added.

The design audit follows [AI Design Skills](https://github.com/elayadesign/ai-design-skills) and its linked [existing-project redesign skill](https://github.com/elayadesign/redesign-skill), adapted to the established product workflow and [GUI baseline](GUI_DESIGN_BASELINE.md). Local synthetic browser review covers overview, resources, register, intake, and eligibility at 320, 390, 820, and 1440 px, plus loading, empty, and failed-read states. It checks overflow, button labels, keyboard focus, draft reset, and reduced motion. These checks do not establish connected Google acceptance or a deployed UI revision.

Deployment checkpoint, 6 November: source `056f8c8` is deployed as owner-only version 10 on the existing dedicated web app. Fresh editor and immutable-version readbacks match all 26 staged file hashes; a separate deployment readback confirms version 10 and the unchanged deployment inventory. The actual in-app browser passed owner login, account menu/profile/preferences, topics/matrix/register reads, refresh restoration, logout and signed-out refresh. The manifest scopes and owner-only audience are unchanged. A new full training-case replay remains separate acceptance work.

The subsequent local repair loads the invitation-response and skill tables through read-only calls on navigation. Individual skill callbacks reread state without starting batch processing, preserve case-specific failures, and clear stale rows while reading. The batch button states that it processes all eligible cases; the stepper supplies the view numbering. Regression tests and a 31-case synthetic browser review cover these repairs. The earlier missing Drive and Calendar runtime grants are resolved under the unchanged manifest. Live invitation navigation read two Calendar responses without errors, and the skill step read its saved applied case without running batch processing.

The explicit owner session flow now includes a top-right initials badge, verified read-only identity, density/motion preferences and app logout. Session tokens expire after eight hours and are revoked server-side for the same browser family. Missing Google grants keep the workflow unmounted and show an official confirmation link. Broader member access remains outside this owner-only release. See [APP_SESSIONS.md](APP_SESSIONS.md) for the contract and background-trigger compatibility.
