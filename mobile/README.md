# Cosanum training mobile demo

Android-first Expo/React Native/TypeScript prototype. The app also builds for iPhone and web. It reads `../contracts/workflow.v1.json`, `../contracts/current-task.v1.json`, and `../fixtures/offline_fixture.json` through Metro's repository watch folder. All case records and calendar slots are generated locally and reset when the app restarts.

```sh
cd mobile
npm ci
npx tsc --noEmit
npx expo start --lan
```

Open the QR in a matching Expo Go build on the same network. The web view is available with `npx expo start --web`; after a trainer pass, its case detail shows a `?participant=CASE-...` link. The web demo stores state in that browser's local storage so this link can continue the synthetic flow in another tab of the same browser. The link is a **synthetic preview**, not authentication. A real participant response must go through server-side verified identity and assignment checks.

The app simulates booking, trainer assessment, participant acknowledgement, proof, archive, and skill transitions. It creates no PDF and makes no Google request. The `server/` project supplies the API security boundary and inert Google Calendar/Sheets transports for later connected integration. Its local HTTP process binds only to loopback and has no enabled identity or connected gateway.
