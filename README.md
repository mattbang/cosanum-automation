# Cosanum Training Automation

A prototype for coordinating logistics training with Google Workspace. The current private demo app covers the five-topic catalogue, manual draft intake, the skill progression gate, and a persisted trainer and phase plan. Calendar scheduling, trainer assessment, individual acknowledgement, evidence archiving, and skill updates belong to later increments.

The [public project overview](docs/PROJECT_OVERVIEW.md) describes the goal and technology. The [development plan](docs/DEVELOPMENT_PLAN.md) breaks delivery into small, testable increments. The connected prototype is developed one verified feature at a time.

The [notification templates and delivery contract](docs/NOTIFICATION_TEMPLATES.md) define the German email copy, required fields, recipient rules, and retry behavior for the later communication increments.

The [workflow asset inventory](docs/WORKFLOW_ASSETS.md) links the interface mockups and templates for each handoff, including Calendar invitations, Google Forms, individual proof, archives, and the integrated demo checklist.

The [GUI design baseline](docs/GUI_DESIGN_BASELINE.md) records the agreed starting direction from the [Figma mockup](https://www.figma.com/design/z4Nppuwp1uSg7XTdWEY2b5/Cosanum-%C2%B7-Schulungsverwaltung-%E2%80%94-GUI-Konzept?node-id=0-1) and maps its nine screen concepts to the planned workflow.

Increment 03 adds group or individual mode, topic-qualified synthetic trainer choices, and linked 60-minute theory and 180-minute practice sessions where required. The [demo Sheet schema](docs/DEMO_SHEET_SCHEMA.md) documents version 4 and its migrations. The connected app remains private to the demo account; deployment details and Google asset IDs are in the ignored local handoff.

The detailed planning specification, real source documents, test-account details, and training evidence are kept outside the public repository. Demo records will be marked clearly and stored in a local archive with a matching Google Drive copy.

## Start developing

From a clean checkout with Node 24 and Python 3.11 or newer, run `npm run check` for credential-free local checks, then `npm run dev` and open `http://127.0.0.1:4173/` for the synthetic read-only Demo Hub. No package install or Google login is needed. The [contributor guide](docs/CONTRIBUTING.md) covers the expected result, common setup failures, the optional container, and the separate connected-verification handoff.
