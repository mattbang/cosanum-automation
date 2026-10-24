# Public synthetic E-Mail-Rundgang

This is a **separate Apps Script project** for the public demo. It must not be copied into the private training script. It contains no Sheet, Calendar, Drive, Form, case, or skill access. The only explicit OAuth scope is `script.send_mail`.

The visitor selects the same role set and synthetic free hour used by [`../docs/demo-tour/index.html`](../docs/demo-tour/index.html). The server checks these values again. A request sends one confirmation email. Opening its link only displays a page; the visitor must press **Demo-Nachrichten senden**. The link is usable once and is cached for up to 20 minutes. The sender then submits 7, 9, or 11 role-labelled messages for one, two, or three participants. Every subject starts `[DEMO]` and names the simulated recipient role. No real training data or actionable Form links appear in the messages.

Safeguards: five requests per Zurich calendar day across the script, one per case-insensitive address per day, recipient quota checked before confirmation and before the sequence, script lock on reservations, and a durable token-hash receipt. A failed or interrupted send stays **unknown** and is never automatically retried. Script Properties store day counters, hashed addresses, and token-hash receipts for 30 days; the exact address and scenario exist only in the short-lived Script Cache. Google may evict Cache entries early. `MailApp.sendEmail` returning means submission to MailApp, not proven inbox delivery.

## Local validation

Run `node scripts/test_mail_tour.mjs` from the repository root. The test uses an in-memory fake mail service and never contacts Google or sends mail. It covers selection validation, one-use confirmation, role labels and counts, address and global caps, quota, expiration, and interrupted sending.

## Deployment checklist

1. In the **dedicated demo owner account**, create a new standalone Apps Script project. Add `Code.gs`, `Index.html`, and `appsscript.json` from this directory. Do not add it to the existing owner-only training project. If using `clasp`, initialize it in this directory only and keep `.clasp.json` ignored.
2. Review the manifest: `executeAs=USER_DEPLOYING`, `access=ANYONE_ANONYMOUS`, and the single `script.send_mail` scope. Deploy a new **web app** version. Authorize the owner account after inspecting the account, app, developer, and scope. Copy the `/exec` URL; do not publish a `/dev` URL.
3. Open the `/exec` URL in a private browser. Request a tour at an inbox you control, click the received confirmation link, then press the send button. Check message count and role-labelled subjects, including the spam folder and order. Inspect Apps Script executions and quota if any message is missing. Never use a customer address for the acceptance test.
4. Only after that live check, add a link or button on the existing public GitHub Pages tour at `https://mattbang.github.io/cosanum-automation/demo-tour/`. Keep its URL unchanged and its current preview mode available. Do not put the visitor email or confirmation token in the Pages URL.

No production training records, archived proof, or skill status may be changed by this demo. The owner's account supplies the sender identity; visitors do not authorize Google access. Disable or remove the public web app deployment if the pilot ends.
