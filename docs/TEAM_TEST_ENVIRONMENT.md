# Contributor Google test environments

This is the access and ownership plan for [issue #28](https://github.com/mattbang/cosanum-automation/issues/28). The first connected trial uses **one isolated synthetic environment per contributor**. Two contributors can then test independently without sharing a mutable Sheet, script deployment, triggers, Forms, Calendar, or evidence folder. The current owner-only v0.1 deployment remains the release reference. This page defines the plan and a local preflight; it does not assert that either environment has been provisioned or verified.

## Ownership decision

| Resource | Contributor sandbox A | Contributor sandbox B | Protected v0.1 release |
| --- | --- | --- | --- |
| Apps Script and Cloud project | A owns a separate standalone script and associated Cloud project. A alone pushes and deploys it. | B owns a different script and Cloud project. B alone pushes and deploys it. | Existing dedicated demo owner retains its script and deployment. |
| Synthetic Sheet, Drive folder, Forms, proofs | Created in A's test Drive; IDs and evidence stay in A's private inventory. | Created in B's test Drive; never reuse A's IDs. | No share or reset from a contributor sandbox. |
| Calendar and test accounts | A's own primary calendar is the current booking target; A records its ID and uses four allowlisted synthetic accounts. | B's distinct owner account has a different primary calendar and four different test accounts. | Existing account and calendar allowlist remain separate. |
| Reviewer | Reviews the Git branch and a redacted run summary. Access to live assets is granted only for a named connected check. | Same. | Release verifier follows the existing private handoff. |

This avoids treating Apps Script editor access as view-only: editors can create versions and deployments, while installable triggers run as the account that created them. Google also separates Apps Script file access from Cloud project roles. [Google's collaboration guide](https://developers.google.com/apps-script/guides/collaborating) and [trigger guide](https://developers.google.com/apps-script/guides/triggers/installable) describe those behaviors. Shared drives can solve continuity for eligible Workspace teams, but availability and deployment-domain rules must be checked before choosing one; individual sandbox ownership is the initial path.

The private inventory must identify a recovery owner for each sandbox. If a contributor leaves, stop its triggers and deployments, preserve evidence, and transfer or recreate the sandbox through a reviewed handoff. Do not move the existing v0.1 script to a shared drive as part of this work.

## Local target preflight

Keep two JSON inventories in ignored `data/team-test/`: one for the proposed contributor target and one for the protected release. Neither file is a credential. The target inventory has `kind: "contributor-test-v1"`, the exact `sourceCommit`, `ownerEmail`, four `testAccounts`, a `fixtureFile` path inside ignored `data/team-test/`, an `assetIds` object, and `reviewedScopes`. The asset keys are `scriptId`, `cloudProjectNumber`, `spreadsheetId`, `driveFolderId`, and `calendarId`. `calendarId` records the owner account's **primary** calendar: current `apps-script/Booking.gs` uses `primary` and does not select an arbitrary calendar. Copy `reviewedScopes` from the reviewed `apps-script/appsscript.json`; do not broaden them to make a consent screen disappear. The protected inventory has `kind: "protected-release-v1"`, an `assetIds` array with at least those five release asset identifiers, and an `accountEmails` array containing the release owner and other protected test accounts. The [preflight test](../scripts/test_team_test_target.mjs) shows both shapes with fictional `example.test` accounts. Put live values only in ignored files and the private run record.

Run from the exact source checkout:

```sh
node scripts/check_team_test_target.mjs --target data/team-test/contributor-a.json --protected data/team-test/protected-release.json
```

When both inventories exist, append `--peer data/team-test/contributor-b.json` to check the two contributor targets against each other as well. The command reads only local files. It rejects a stale source commit, uncommitted Apps Script code, missing or duplicate target assets/accounts, a mismatch between the fixture's four People emails and the inventory, an incomplete fixture according to the current `setupDemo()` validator, overlap with the listed protected release or peer, and scope drift. It prints no IDs or addresses. **A pass is a structural preflight, not proof of Google ownership, permissions, or completeness of the protected inventory.** A reviewer must compare the private inventory with the real assets before any setup, reset, deployment, trigger, Form, or mail action.

After that review, create an ignored `clasp` staging tree with the exact checked-out source and that private fixture:

```sh
node scripts/stage_team_test_target.mjs --target data/team-test/contributor-a.json --protected data/team-test/protected-release.json --peer data/team-test/contributor-b.json
```

The command prints no IDs or addresses and makes no Google call. Inspect the generated `data/team-test/stage-contributor-a-<commit>/` tree privately before any `clasp push`. It contains `.clasp.json`, the tracked Apps Script source, and `PrivateFixture.gs` generated from the contributor fixture; it refuses to replace an existing staging tree. The fixture must retain the five-topic, four-person, twenty-skill schema expected by `setupDemo()` while replacing **all four** release-account addresses. The older `prepare_dedicated_demo.mjs` changes only the owner address and is not the team-sandbox staging path.

## Provision and connected trial

1. Record the proposed accounts, ownership, Cloud project choice, asset inventory, source commit, manifest scopes, and expected actions in a private run record. Have a second reviewer check that both contributor targets and the release target are distinct. Decide who can create, reset, deploy, and review each resource. Stop if any ID or permission is uncertain.
2. Each contributor signs into their own Google account and creates a separate standalone Apps Script project. Record that account's **primary** calendar ID; do not create a secondary calendar and assume the current booking code will use it. In that account's Drive root, create one folder with the exact `DEMO_SCHEMA.folderName` from `apps-script/Schema.gs`; inside it, create one empty Google Sheet with the exact `DEMO_SCHEMA.spreadsheetName`. The current `setupDemo()` finds those names and fills an empty Sheet, so record their IDs privately. Prepare an ignored contributor fixture with all four assigned test accounts, then run the inventory preflight **before** setup. A duplicate root folder or duplicate matching Sheet blocks setup. Use a personal `clasp` authorization and ignored target file for that account. Never copy an OAuth token, owner browser session, or release `.clasp.json`. Confirm the signed-in account, script title, developer, destination, and each requested scope against the reviewed manifest before consenting. Google [authorizes scripts per user](https://developers.google.com/apps-script/guides/services/authorization); a successful consent for one contributor says nothing about the other's account.
3. Stage the checked source and private fixture with the command above. One named owner at a time inspects and pushes their staged target, then checks the remote script ID before running code. Inspect the target inventory and expected Drive/Sheet changes again. Run `setupDemo()` once, confirm it returned the pre-recorded folder and Sheet IDs, rerun it to confirm reuse, and inspect the Sheet. Do not install recurring triggers, send mail, book events, or prepare Forms in this first smoke check. The current `resetDemoFixture()` rewrites only the three base fixture tabs; it is **not** a complete run reset and must not be used to clear another contributor's evidence.
4. Each owner opens only their own owner-only test web deployment and records one synthetic read path plus one bounded local-to-connected action selected in the private run plan. Test a wrong or unlisted account against the owner action and record the observed denial. A failure to access a needed resource is an acceptance failure, not a reason to widen the v0.1 deployment.
5. Preserve the exact script/source commit, deployment version, asset IDs, account roles, observed side effects, failures, retries, and evidence links privately. Publish only a redacted outcome on [#28](https://github.com/mattbang/cosanum-automation/issues/28). Two independently observed contributor trials and the wrong-account check are required before moving the card to Done.

## Reset and collision rules

There is no general-purpose connected reset in this slice. Before any later reset, export or snapshot the affected Sheet and evidence, identify the exact sandbox and rows/files to change, record the owner and rollback path, and obtain a second review of the target. Never reuse request IDs across retained evidence. A retry must inspect existing Form, event, proof, and message ledgers before creating anything; an `unknown` mail reservation requires manual delivery inspection. [Issue #8](https://github.com/mattbang/cosanum-automation/issues/8) can later design a bounded repeat-run flow from observed replay friction.

Use a single writer per sandbox for Apps Script pushes, deployments, schema changes, and trigger installation. Calendar booking, Form creation, archive writes, and mail require a named run and side-effect log. Installable triggers are owned by their creator, so a second contributor must not assume they can see or manage the first contributor's triggers. Local checks and PR review remain the default before any connected trial.

## Decision gates still open

- Name the two contributor accounts and a reviewer privately; confirm each can own the required Google assets and authorize the reviewed scopes.
- Decide whether a standard Cloud project or Workspace shared drive is needed for these accounts. Do not switch the protected release project's Cloud association just to alter an OAuth warning.
- Confirm the private release inventory is complete before the overlap preflight is treated as meaningful.
- Approve the first bounded connected smoke action and its expected side effects. Provisioning and sending remain separate actions after this plan review.

This environment supports team development; it does not grant trainers, participants, or member operators access to the product. That remains [issue #9](https://github.com/mattbang/cosanum-automation/issues/9). The six-scenario release replay in [issue #6](https://github.com/mattbang/cosanum-automation/issues/6) still runs against its own reviewed source and acceptance record.
