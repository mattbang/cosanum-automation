# Offline local preview

From this checkout, run:

```sh
node scripts/local_preview.mjs
```

Open `http://127.0.0.1:4173/`. Set `PORT=4180` (or another free local port) before the command if needed. Stop with Ctrl-C. No install, login, deployment, or Google account is required.

The local command binds only to `127.0.0.1`. The optional dev container sets `PREVIEW_HOST=0.0.0.0` to let its private forwarded port reach the preview. Keep that forwarded port private; do not use this switch to expose a local host on a shared network.

The server reads the current `apps-script/Index.html` on each request and injects a synthetic `google.script.run` adapter before its client script. A prominent banner marks the page **OFFLINE PREVIEW · SYNTHETIC DATA · READ ONLY**. Three sample requests exercise completed group, unbooked individual, and open exception paths in the Demo Hub. Navigate Process & Quality and Ergebnisse & Register at desktop or phone width. The catalogue and intake screen also render with synthetic people and topics.

Only `/` is served. The server listens on `127.0.0.1`, never serves arbitrary repository paths, and sends a Content Security Policy that blocks network connections, images, frames, and forms. The adapter blocks external links, all production write RPCs, and any unknown RPC. The production RSVP refresh writes to the Sheet, so the server replaces that one call in its served HTML copy with a preview-only fixture RPC; the checked-in `Index.html` is untouched. A blocked action appears in a fixed alert and, where the app supplies a failure handler, in its own status area. Data resets on refresh.

This is a layout and navigation harness, not a backend simulator. Sample IDs, names, states, and dates are fictional. The completed group has booked 60-minute theory and 180-minute practice phases; the individual request has two planned but unbooked phases, so no RSVP; and the exception request has one declined and one accepted RSVP to exercise the owner action view. Other queue views intentionally show zero rows; calendar access shows an offline diagnostic. Eligibility is always denied because the local fixture cannot validate the real matrix. Saving, booking, sending, form preparation, proof creation, and skill updates never happen. No private fixtures, Google URLs, accounts, or credentials are loaded.

Run `npm run check` for the complete local suite or `node --test scripts/test_local_preview.mjs` for the deterministic server smoke test. Other local tests use the tracked [fictional fixture](../fixtures/synthetic_demo.json); private connected fixtures remain ignored.
