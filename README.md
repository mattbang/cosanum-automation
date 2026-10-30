# Logistics training automation prototype

This project tests an end-to-end logistics training workflow with synthetic people and five representative topics. Process & Quality enters a need, checks skill prerequisites and calendars, books a session, collects a trainer result and each participant's own acknowledgement, then verifies an individual proof in both Google Drive and a local archive before updating the demo skill matrix.

**Source consolidation, 30 October 2026:** The [branch resolution roadmap](docs/BRANCH_RESOLUTION_2026-10-30.md) and [code review record](docs/INTEGRATION_REVIEW_2026-10-30.md) cover the mobile app, durable backend, participant page, shared D1 demo, notification intents and contributor tooling. The hosted shared demo remains the documented two-device path; PostgreSQL is a local pilot and service foundation. Device, connected-service, proof/archive and delivery acceptance remain open.

**Current status, 24 October 2026:** [PR #39](https://github.com/mattbang/cosanum-automation/pull/39) integrated the training-app source, and the dedicated demo account now runs owner-only version 6. The numbered deployment has not passed a fresh complete workflow run. The earlier personal-account prototype remains historical. The [feature register](docs/FEATURE_REGISTER.md) distinguishes implemented, deployed, and connected-accepted behavior.

## Start here

- [Contributor development](docs/CONTRIBUTOR_DEVELOPMENT.md): clean-checkout setup, local checks, and isolated Google test targets.
- [Project overview](docs/PROJECT_OVERVIEW.md): purpose, components, and data boundary.
- [Feature register](docs/FEATURE_REGISTER.md): supported status and next acceptance check for each feature.
- [Development plan](docs/DEVELOPMENT_PLAN.md): staged delivery and current dependencies.
- [Project structure](docs/PROJECT_STRUCTURE.md): active files, private records, evidence, and historical material.
- [Workflow assets](docs/WORKFLOW_ASSETS.md) and [GUI baseline](docs/GUI_DESIGN_BASELINE.md): reusable templates and interface direction.

The governing prototype specification and detailed roadmap stay local. They retain original decisions; the dedicated-account cutover and current checks are recorded in the private handoffs. Google Drive holds demo assets and the duplicate evidence archive, not the specification.

The [status update templates](docs/status-updates/README.md) define the daily, weekly, and monthly group reports and their GitHub archive and Teams publication workflow.

The [GUI design baseline](docs/GUI_DESIGN_BASELINE.md) records the agreed starting direction from the [Figma mockup](https://www.figma.com/design/z4Nppuwp1uSg7XTdWEY2b5/Cosanum-%C2%B7-Schulungsverwaltung-%E2%80%94-GUI-Konzept?node-id=0-1) and maps its nine screen concepts to the planned workflow.

## Release boundary

The private training web app remains owner-only. A source commit, Apps Script editor `@HEAD`, and a numbered `/exec` deployment are separate states. Version 6 has no mail scope; reminders and completion messages still require a reviewed permission grant and connected delivery test. The public synthetic role tour and its proposed mail sender are separate from the training app.

Use synthetic data only. Keep OAuth credentials, account-specific configuration, local evidence, and personal test identities out of the public repository. The [agent instructions](AGENTS.md) describe the active Google target and the historical one; the ignored local `docs/private/README.md` indexes account-specific evidence.

## Start developing

From a clean checkout with Node 24 and Python 3.11 or newer, run `npm run check` for credential-free local checks, then `npm run dev` and open `http://127.0.0.1:4173/` for the synthetic read-only Demo Hub. No package install or Google login is needed. The [contributor guide](docs/CONTRIBUTING.md) covers the expected result, common setup failures, the optional container, and the separate connected-verification handoff.

