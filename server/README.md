# Training API boundary

`src/service.ts` is a TypeScript action boundary for the six actions in `contracts/workflow.v1.json`. It obtains a verified caller from a server-side identity provider, reloads the selected case, checks role and exact assignment, evaluates server-derived evidence, then requires a same-scope and changed-revision readback before reporting success. Client payload facts are ignored.

`src/google.ts` contains server-only Calendar free/busy/event and Sheets row transports. They are inert until a connected workflow gateway, verified identity provider, exact resource mapping, and reviewed scopes are supplied. The shipped `src/http.ts` deliberately binds only `127.0.0.1` and supplies neither authority nor a connected gateway. Its `/health` response says `connected: false`; `/actions` rejects every caller.

```sh
cd server
npm ci
npm run check
npm test
npm run dev
```

Before connected use, implement a gateway that maps persisted rows to `Snapshot`, derives every fact from fresh Calendar, Sheet, Form, Drive, and archive evidence, performs conditional idempotent writes, and returns the post-write state. Verify the dedicated account, exact project and scopes, and assigned-account negatives separately. Do not treat this scaffold or the mobile preview as connected acceptance.
