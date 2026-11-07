# Writable local prototype foundation

This is the first delivery slice of [#78](https://github.com/mattbang/cosanum-automation/issues/78), within the [December roadmap](https://github.com/mattbang/cosanum-automation/issues/77). It runs without Google access and saves synthetic intake requests and initial deadlines. It is separate from the read-only preview started by `npm run dev`.

## Start and repeat a request

Use Node 24, then run:

```sh
npm run prototype
```

Open `http://127.0.0.1:4174/`. No package installation or Google login is needed. Choose the synthetic owner, select Demo Participant A (`WOHNUNG`), topic A (`TC_R030`), and target level 1. Preview eligibility, optionally enter an initial deadline/reference, then save the request. The same canonical intake and deadline functions used by Apps Script validate the input.

Set `LOCAL_PROTOTYPE_PORT` to choose another port, or `LOCAL_PROTOTYPE_DATA_DIR` to select a dedicated synthetic store directory. The initial clock is 9 November 2026 at 08:00 UTC; the page shows Zurich time and labels the clock control as UTC.

Switch to that participant to see the assigned case, then to Participant B to confirm it is absent. Trainer views have no assigned cases until scheduling is implemented. Role selection is an explicit synthetic test control, not real authentication. Only the synthetic owner can create requests or change the clock/reset controls.

Stop with Ctrl-C and restart the command. The saved request and deadline remain. Refreshing the page does not reset records. Use the owner's explicit reset control with `RESET SYNTHETIC DATA` to restore the seed. Reset affects this local store only; preserve a stopped store copy first if a run needs to be retained.

## Data and boundaries

The default store is under ignored `data/local-prototype/`. Keep it synthetic. One server owns a store at a time; a competing writer is rejected. Corrupt or incompatible data is reported rather than silently replaced. The controllable clock is persisted so the same scenario can be repeated without waiting for real time to pass.

After an abrupt process crash, inspect the PID in `.prototype-writer.lock` and verify that process is no longer running before removing that lock file. Do not remove a live or uncertain lease. Preserve `prototype-state.json`; choosing a new dedicated directory is also safe. The [runtime contract](../scripts/prototype/SPEC.md) records persistence, fixture normalization and role boundaries.

The server binds to `127.0.0.1`, exposes only its own page and bounded local API, and rejects foreign browser origins. It never opens private fixture files, OAuth credentials or a live Sheet. No Calendar event, message, Form, proof or skill completion is fabricated by this foundation.

The owner intake screen is a focused local shell because the full existing owner page also calls scheduling, audit and proof APIs. The existing owner/member pages and Google deployment remain unchanged. Their later integration is [#79](https://github.com/mattbang/cosanum-automation/issues/79).

## Next delivery work

- #79: planning, simulated booking/RSVP and trainer/participant form handoffs.
- #80: real local proof artifacts, archive hash checks and skill/history completion.
- #81: bounded employee import.
- #82: consume #75's reviewed material normalization module and retain revision references.
- #83–#88: core rehearsal, build freeze, conditional additions, acceptance and handoff.

The local transport is not a replacement for the separately owned PostgreSQL API/client wiring or member activation. Reuse its canonical table shapes and validation boundaries when connecting those tracks; do not treat local role selection or saved synthetic rows as connected acceptance.

## Checks

```sh
node scripts/test_local_prototype_runtime.mjs
node scripts/test_local_prototype_http.mjs
npm run check
```

The focused checks cover persistence/retry, canonical blocked selections, initial deadlines, role scoping, reset/clock controls, malformed state and HTTP origin/path/body boundaries. Broader workflow acceptance remains on the later delivery cards.
