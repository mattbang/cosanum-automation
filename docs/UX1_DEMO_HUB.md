# UX1 Demo Hub handoff

The owner-only Apps Script page starts in **Demo Hub**. Its three scenario cards find a matching persisted request when one exists. A card with no matching request leads to a new manual intake. The cards never create a case or claim a result by themselves.

**Process & Quality** shows one task at a time: Bedarf, Phasenplan, Termin, Einladung, Trainerbericht, Bestätigung, Nachweis, Offene Fälle, and Skillstufe. Saving a draft opens planning; saving the plan opens booking. The existing controls and server actions remain in those tasks. A stepper click changes only the visible task. Buttons within a task retain their existing effects and permission gates.

**Ergebnisse & Register** retains the person-level audit filters and source links. The Hub uses the same read-only audit rows to show the next action and individual case status, including a group event with different outcomes per person. It reads request, session, accepted Form response, proof, archive receipt, and skill state. The view does not record progress as its own data. Refreshing the page reads the Sheet again and reconstructs a saved plan and booked events through `getSavedPhasePlan()`.

The local test `node scripts/test_demo_hub.mjs` checks display-state derivation, a split group outcome, navigation without a Google write call, and read-only plan recovery. Existing script tests should also pass. Connected acceptance still needs the dedicated owner deployment: complete request-to-booking through the new navigation; click every step and compare Sheet/Google asset counts before and after; refresh and confirm the same progress; inspect one group request with different person-case statuses. Deployment and Google mutations are outside this UX1 handoff.
