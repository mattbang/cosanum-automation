# Logistics training automation prototype

This project tests an end-to-end logistics training workflow with synthetic people and five representative topics. Process & Quality enters a need, checks skill prerequisites and calendars, books a session, collects a trainer result and each participant's own acknowledgement, then verifies an individual proof in both Google Drive and a local archive before updating the demo skill matrix.

**Current status, 24 October 2026:** one local release candidate combines the open training-app source changes. It is not the numbered Google web deployment and has not passed a fresh complete run. The active private demo is owned by a dedicated Google test account; the earlier personal-account prototype is historical. The [feature register](docs/FEATURE_REGISTER.md) distinguishes implemented, deployed, and connected-accepted behavior. This checkout's `main` may lag the candidate branch.

## Start here

- [Project overview](docs/PROJECT_OVERVIEW.md): purpose, components, and data boundary.
- [Feature register](docs/FEATURE_REGISTER.md): supported status and next acceptance check for each feature.
- [Development plan](docs/DEVELOPMENT_PLAN.md): staged delivery and current dependencies.
- [Project structure](docs/PROJECT_STRUCTURE.md): active files, private records, evidence, and historical material.
- [Workflow assets](docs/WORKFLOW_ASSETS.md) and [GUI baseline](docs/GUI_DESIGN_BASELINE.md): reusable templates and interface direction.

The governing prototype specification and detailed roadmap stay local. They retain original decisions; the dedicated-account cutover and current checks are recorded in the private handoffs. Google Drive holds demo assets and the duplicate evidence archive, not the specification.

The [status update templates](docs/status-updates/README.md) define the daily, weekly, and monthly group reports and their GitHub archive and Teams publication workflow.

The [GUI design baseline](docs/GUI_DESIGN_BASELINE.md) records the agreed starting direction from the [Figma mockup](https://www.figma.com/design/z4Nppuwp1uSg7XTdWEY2b5/Cosanum-%C2%B7-Schulungsverwaltung-%E2%80%94-GUI-Konzept?node-id=0-1) and maps its nine screen concepts to the planned workflow.

## Release boundary

The private training web app remains owner-only. A source commit, Apps Script editor `@HEAD`, and a numbered `/exec` deployment are separate states. The current candidate has no mail scope; reminders and completion messages still require a reviewed permission grant and connected delivery test. The public synthetic role tour and its proposed mail sender are separate from the training app.

Use synthetic data only. Keep OAuth credentials, account-specific configuration, local evidence, and personal test identities out of the public repository. The [agent instructions](AGENTS.md) describe the active Google target and the historical one; the ignored local `docs/private/README.md` indexes account-specific evidence.
