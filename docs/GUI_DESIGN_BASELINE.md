# GUI design baseline — training prototype

**Status:** Starting point agreed on 23 October 2026. The [Figma mockup](https://www.figma.com/design/z4Nppuwp1uSg7XTdWEY2b5/Cosanum-%C2%B7-Schulungsverwaltung-%E2%80%94-GUI-Konzept?node-id=0-1) shows nine editable screen concepts on **Screens + Funktionen**. It is a design reference, not a working prototype or a replacement for the local training prototype specification and its F01–F12 acceptance criteria.

## What we are keeping

- A light, spacious workspace with Cosanum plum for identity and navigation, lilac for supporting surfaces, and coral for the main action and important emphasis. Use the Figma color and spacing variables as the starting values; check contrast in the implemented interface.
- German task language, a visible `[DEMO]` marker, clear page titles, and one obvious primary action on each view. Show only the information needed for the current decision; put detailed records behind a case or evidence view.
- A guided path from request through eligibility, appointment, booking, assessment, acknowledgement, and proof. Keep an overview for exceptions and a separate searchable register for audit work.
- Person-level status throughout group training. A shared event can contain several participant cases, each with its own RSVP, assessment, acknowledgement, proof, archive state, and outcome.
- Explicit pending, blocked, and failed states with a reason and the next permitted action. Status labels must come from persisted workflow state, not decorative sample counts.

The function panels beside the Figma screens are design annotations. They are not sidebars that must appear in the application. The nine concepts describe user tasks; implementation may combine adjacent steps into one route or use Google Forms for the trainer and participant views if the behavior remains clear.

## Screen and function contract

| Figma concept | Keep in the first demo | Build increments / requirements |
| --- | --- | --- |
| Overview | A concise entry point for a new request, active work, and cases needing Daniel's attention. Counts and alerts open the relevant case. | 01 for the shell; 12–13 for live open-case and notice states; F07, F12. |
| Request | One topic, group or individual mode, participant selection, and an explicit target/phase plan. Saving a draft sends no invitation. | 02–03; F01–F02. |
| Eligibility | Show current and target skill, qualified trainer choices, and a precise reason for each blocked person. Link to the demo Sheet for correction and recheck after a change; do not edit skills in the GUI. | 02–03; F01–F02. |
| Appointment | Show theory/practice duration and spaced Zurich-time proposals only after all required calendars return free/busy data. Explain fewer choices or an access error. | 03–04; F03. |
| Booking and RSVP | Review the chosen slot before booking, then show the Calendar event, per-person invitation response, and targeted rescheduling flags. Recheck availability at booking. | 05–06; F04. |
| Trainer report | The assigned trainer records each person's attendance, result, and note. Identity and submission time are retained; only attended and passed cases advance. A verified-email Google Form is the planned implementation. | 07; F05. |
| Personal acknowledgement | A person-specific German confirmation with affirmative checkbox and typed name; accept only the assigned signed-in Google account. Keep missing responses open and show reminder progress. A Google Form is the planned implementation. | 08 and 12; F06–F07. |
| Evidence and archive | One proof per participant, with Doc/PDF links and separate Drive/local verification states. Surface archive retry and matrix conflicts; do not show completion before the evidence gates pass. | 09–11; F08–F10. |
| Register and audit | Filter by topic, person, request, and open state; follow event, report, response, proof, archive, and skill-change links. Show completion and exception outcomes without allowing a manual bypass. | 12–14; F07, F11–F12. |

## Implementation rule

Keep the layout calm as real data arrives: prioritize the next action and the blocking reason, and reveal IDs, timestamps, and evidence links in the case detail or register. Use real workflow state for every badge and call to action. Sample names, counts, and status values in the mockup are illustrative. The local specification decides scheduling, identity, evidence, archive, and skill-update rules whenever a screen illustration is incomplete or differs from those rules.
