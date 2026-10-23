# Project overview

## Aim

Build a small, demonstrable training workflow for logistics operations. An administrator enters a training need, chooses a topic and participants, checks prerequisites and availability, and books a session. After delivery, the trainer records an assessment and each participant acknowledges their attendance. The system produces an individual proof record, verifies both archive copies, updates the demo skill record, and reports completion or an exception.

The first demo uses a small synthetic catalogue and test accounts. It does not make claims about real employee qualifications or production compliance.

## Planned components

The [GUI design baseline](GUI_DESIGN_BASELINE.md) records the parts of the nine-screen Figma mockup we will carry into the prototype. It maps each view to the workflow and keeps the local specification as the authority for behavior.

| Component | Role |
| --- | --- |
| Google Apps Script and HTML Service | Administrator interface and workflow orchestration |
| Google Sheets | Demo catalogue, skill levels, and case register |
| Google Calendar | Free/busy checks and session invitations |
| Google Forms | Account-linked trainer and participant responses |
| Google Docs and Drive | Individual proof generation and cloud evidence copy |
| Gmail | Reminders, completion, and exception notices |
| Local archive helper | Download, verify, and index the local evidence copy |

## Development slices

Each slice has a repeatable acceptance check before the next dependent feature is added:

1. Deployable demo shell and synthetic catalogue.
2. Manual request entry and prerequisite checks.
3. Trainer choice and theory/practice plan.
4. Free/busy queries and varied slot proposals.
5. Calendar booking and guest-status handling.
6. Trainer assessment and individual acknowledgement.
7. Individual proof generation and matching local/Drive archives.
8. Automatic synthetic skill update after proof verification.
9. Follow-up reminders, exception handling, and audit view.
10. Full replay of group, individual, and failure scenarios.

The detailed local roadmap divides these into smaller agent assignments. In the public repository, changes should be proposed as focused branches or pull requests with a visible result and the acceptance check run.

## Data boundary

No real employee matrix, source workbook, personal test addresses, archive records, or local agent state belongs in this public repository. Those are excluded by `.gitignore` and must be reviewed before any future publication.
