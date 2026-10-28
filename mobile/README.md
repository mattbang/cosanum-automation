# Cosanum training mobile demo

Android-first Expo/React Native/TypeScript prototype. The app also builds for iPhone and web. It reads `../contracts/workflow.v1.json`, `../contracts/current-task.v1.json`, and `../fixtures/offline_fixture.json` through Metro's repository watch folder. All case records and calendar slots are generated locally and reset when the app restarts.

```sh
cd mobile
npm ci
npx tsc --noEmit
npx expo start --lan
```

Open the QR in Expo Go with **SDK 58** on the same network. The web view is available with `npx expo start --web`; after a trainer pass, its case detail shows a `?participant=CASE-...` link. The web demo stores state in that browser's local storage so this link can continue the synthetic flow in another tab of the same browser. The link is a **synthetic preview**, not authentication. A real participant response must go through server-side verified identity and assignment checks.

The app opens on Daniel's Process & Quality overview. Three drill-downs show the synthetic skill matrix by topic or person, five training materials, and a seven-day view of example availability. The matrix distinguishes levels 0–3, trainer qualification at level 4, a dash for training not intended, and a blank entry. The calendar combines fixture busy actors with bookings made in this demo; it does not read Google Calendar or claim to cover every free time. The overview also groups requests needing a time and upcoming sessions by session, and shows cases needing attention. Select a material to choose group or individual mode, one next-step target level, eligible participants, a qualified trainer, and a free synthetic slot. Availability for each selected person and trainer is visible while building the request and rechecked at booking. The demo matrix blocks empty, dash, trainer-level, and skipped-level selections. A declined invitation or failed assessment can open a new individual planning case while retaining the earlier attempt and the other group members' states. The overview has a **Demo zurücksetzen** action; the web preview uses a versioned local demo state so older snapshots cannot mask this flow. Run `node --test tests/workflow.test.cjs` for the focused selectors and transitions.

The app simulates booking, trainer assessment, participant acknowledgement, proof, archive, and skill transitions. It creates no PDF and makes no Google request. The synthetic mobile flow currently represents one session phase at a time; a material requiring separate group theory and individual practice still needs its complete phase plan in the connected workflow. The `server/` project supplies the API security boundary and inert Google Calendar/Sheets transports for later connected integration. Its local HTTP process binds only to loopback and has no enabled identity or connected gateway.
