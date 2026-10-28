# Hosted participant view foundation

This static, dependency-free page is a hosted participant front end for the API in `server/`. It does not use the demo browser's state or browser storage. A link may use `?case=CASE-ID&link=ONE_TIME_TOKEN`; the link token is held only in page memory and removed from the address bar before any sign-in interaction. The case ID is only a locator. The API remains responsible for identity, assignment, role, expiry, revocation, and current state.

The hosted-link service creates a random 256-bit secret, stores only its SHA-256 hash, and returns the secret for one-time display. The server rejects expired and revoked links, binds a claim to the verified issuer/subject, and rejects a different account after binding. A repeated claim by the same identity can refresh the claim; it does not turn the link into an identity credential. Use a short-lived link. Keep email and case details out of the URL; the notification should contain only the hosted URL and a brief instruction to sign in with the assigned account. This front end strips the secret from browser history as soon as it loads. Link delivery and any mail content remain outside this repository change.

## Configuration

Set `apiOrigin` in `config.js` to the HTTPS origin of the reviewed API. Set `identityProvider` to `google` and `googleClientId` to an authorized web client ID only after identity-provider setup is approved. The page loads Google Identity Services only after the participant selects sign-in. It sends the resulting ID token as a bearer token; it does not store it. The backend verifier must validate signature, issuer, audience, expiry, and verified email, and the corresponding verified identity must be registered or claimable through the participant link.

Keep the Google client ID public configuration only; never add a client secret or credential. Configure the hosted page's CSP to allow its own assets, the API origin for `connect-src`, and `https://accounts.google.com` for the identity script and frame. Use HTTPS for both the page and API. The page's `referrer` policy is `no-referrer` to avoid propagating invitation URLs.

The current API does not set CORS headers or answer `OPTIONS` preflight. Host this page on the same origin as the API or use a same-origin reverse proxy for `/participant-links`, `/cases`, and `/actions`. A separate frontend/API origin needs an exact, reviewed CORS allowlist in the API before browser calls can work; do not use wildcard CORS for bearer-token requests.

The empty API origin and client ID are intentional. Until both identity and API configuration are supplied, the view stays fail-closed. No OAuth consent flow or deployment is part of this source foundation.

## API behavior

1. `POST /participant-links/claim` sends `{ linkToken }` with the independently verified identity token.
2. `GET /cases/{caseId}` loads the assigned case with that same identity token.
3. `POST /actions` may call `acceptParticipantAcknowledgement` only when the server read already reports `assignedParticipant`, `participantFormVerified`, `trainerPass`, and `answeredYes` as true. The page sends no participant answer and cannot manufacture those facts. A successful action must return a new revision and the subsequent case read must match it before the page reports completion.

The current API has no route to persist a raw participant response. Until that server-side response path exists, the view shows which verified facts are pending and does not present a pretend answer form. Invitation delivery, real identity setup, connected assignment tests, and hosted acceptance remain separate work.

## Local checks

From this directory:

```sh
node --test test/*.test.mjs
```

For a static syntax check without installing dependencies:

```sh
node --check app.js
node --check core.js
```
