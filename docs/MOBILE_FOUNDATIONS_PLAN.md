# Mobile foundations and handoff

The owner-only Apps Script prototype remains the current connected training app. These changes prepare portable behavior for an Android/iPhone prototype without requiring a Google login for local validation. The GitHub project board tracks the work as #43 (contracts), #44 (person tasks), and #45 (repeatable checks).

| Stage | Implementation | Local acceptance | Limit |
| --- | --- | --- | --- |
| 1. Workflow contract | `contracts/workflow.v1.json` and pure evaluator | Six actions pass actor, scope, prerequisite, forbidden-fact, and cross-step negative cases | Detailed Google writes remain in Apps Script |
| 2. Person task | `contracts/current-task.v1.json`, read-only projection in `Audit.gs`, Hub display | Divergent people in one group, blocked missing trainer, conflict, complete, and no mutation | Projection never grants write access |
| 3. Repeatable checks | Offline runner, sanitized fixture, read-only connected checker | Twice-repeated offline suite; report includes source fingerprint and per-suite result | Connected checker is only used later with existing dedicated authorization and an exact case target |

Run `node scripts/run_local_tests.mjs --repeat 2` in a clean checkout. If `data/demo_fixture.json` is absent, the runner creates the ignored file from `fixtures/offline_fixture.json`. It never replaces an existing local fixture. The runner starts a localhost preview for one synthetic test; it does not open a browser, sign in, send mail, or call Google. The report is saved under ignored `data/test-runs/`.

After these stages are reviewed and integrated, create a separate Codex worktree from the integrated commit for the mobile prototype. Its first slice should use Expo, React Native, and TypeScript for an Android-first operator app, plus a responsive participant link view. Use synthetic in-memory or local fixture adapters first, then put Google Calendar and Sheets behind a TypeScript API adapter with server-side role and evidence checks. Keep the dedicated Apps Script deployment owner-only, the public mail tour separate, and connected authentication/release acceptance as later explicit gates.
