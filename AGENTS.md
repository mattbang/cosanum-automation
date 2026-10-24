# Cosanum Automation agent instructions

## Google account and deployment targets

Gate M moved active connected development to `cosanum.training.demo@gmail.com`. The private training app uses `data/dedicated-demo/.clasp.json` with `data/dedicated-demo/.clasprc.json`; its staged source and restricted manifest are in `data/dedicated-demo/apps-script/`. Verify the authorized account with `clasp show-authorized-user` and the target with `clasp status` before a push, version, or deployment. Keep the training web app owner-only. Its current connected status is recorded in `docs/private/FINAL_PR_HANDOFF.md`.

The root `.clasp.json` and `data/.clasprc.json` belong to Matt's **historical** prototype. `docs/private/history/matt-owned-prototype/INCREMENT_01_HANDOFF.md` documents that environment. Do not use this pair for new demo work, mail, or connected acceptance. Preserve historical files and evidence unless the user authorizes their retirement. Do not infer that an old deployment or installed trigger is inactive merely because Gate M created a new one; check live status.

The public synthetic mail tour is a separate project under the dedicated demo account. Its proposed source and single `script.send_mail` scope are in `mail-tour/` on draft PR #32. Never add these files or this scope to the owner-only training script to expose the public form.

For any Google consent, check Google's sign-in or consent domain, the selected account, app and developer, and the exact requested scopes. The user's earlier permission to pass the unverified-app warning applied to the known Matt-owned prototype and its already approved scopes; it does not grant a new app or mail scope. Stop if the account, app, developer, destination, or permissions differ, or if an action-time confirmation or handoff rule requires it. Do not bypass browser certificate or connection-security interstitials, and do not copy OAuth codes, tokens, client secrets, or credential-file contents into chat, logs, or the repository. Prefer the existing saved `clasp` authorization for routine checks; do not start a fresh OAuth flow just to inspect a deployment.

OAuth verification is a separate release task. Do not change Cloud projects or broaden scopes solely to suppress a development warning.
