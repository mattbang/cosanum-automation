# Development plan

Each increment below should end with a visible behavior and a repeatable acceptance check. Use synthetic data and test accounts. Keep source code local and versioned; keep credentials, individual evidence, and operational data outside this public repository.

| # | Deliverable | Acceptance check |
| --- | --- | --- |
| 01 | Deployable demo interface and five-topic synthetic catalogue | The test URL loads; five topics come from the demo Sheet; rerunning setup creates no duplicates. |
| 02 | Manual need entry and skill prerequisite gate | Valid next-level choices save; skipped, excluded, and unknown levels are blocked with reasons. |
| 03 | Group/individual mode, qualified trainer, and theory/practice plan | Group and individual trainers follow their rules; theory and practice durations and order are correct. |
| 04 | Calendar free/busy and varied slot proposals | Every selected calendar is checked; no proposed slot overlaps a busy period; missing access is shown as an error. |
| 05 | Booking and invitations | One selected proposal creates one correctly timed event; retry creates no duplicate. |
| 06 | RSVP monitoring | A declined group participant is flagged while the session remains for others; unanswered invitations are flagged before training. |
| 07 | Trainer assessment | Only an assigned trainer can record attendance and result; absent or unsuccessful participants remain open. |
| 08 | Individual participant acknowledgement | A verified account response closes only its assigned case; wrong-account and duplicate responses do not. |
| 09 | Individual proof document and PDF | Each successful participant receives a separate, visibly marked demo proof with source evidence links. |
| 10 | Matching Drive and local archive | The PDF is present in both places with matching hashes; missing or corrupt local copies leave the case pending. |
| 11 | Automatic synthetic skill update | A verified case applies its explicit target once; replay and concurrent Sheet edits do not cause an incorrect raise. |
| 12 | Two-day and five-day reminders | A simulated clock produces one reminder at each due point, with none for cancelled, absent, or completed cases. |
| 13 | Completion, exception notices, and audit view | A fully completed request sends one notice; open cases produce exceptions and remain searchable with evidence links. |
| 14 | Clean integrated replay and measurement | Group, individual, and failure cases replay from fresh synthetic data; observed time and manual actions are recorded. |

## Review gates

- **Scheduling:** after 05, demonstrate a valid free slot and one test-calendar invitation.
- **Evidence:** after 10, demonstrate a signed-off individual proof in both archives.
- **Skill:** after 11, demonstrate one justified level update without duplicate application.
- **Full demo:** after 14, run the group and individual paths plus the main exceptions.

Each change should be a focused branch or pull request. The handoff must state what changed, which checks passed, which connected services were tested, any demo side effects, and any concrete limitation. A local fake is useful for fast rule checks, but a feature that promises a Google integration is finished only after its connected acceptance check passes.
