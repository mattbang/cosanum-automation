# Cosanum shared phone demo

This is a public, synthetic two-device walkthrough at
`https://cosanum-shared-training-demo.mattbangle.chatgpt.site`.
It is separate from the private owner-only Apps Script training app and from
the connected TypeScript/PostgreSQL backend drafts. Its D1 room state lets two
phones see the same demonstration without a laptop or Expo tunnel.

## Demonstrated flow

Daniel starts a room with a private creation code, chooses a topic, Matthew
(Mitarbeiter 1), target skill level, and one to three synthetic time windows.
The site returns separate presenter and participant links. A participant can reject
one proposed window and accept another. Both views poll the same persisted room
every three seconds. Daniel can start early, cancel, or file a trainer report.
The participant then confirms participation; a passed result updates the
Matthew's synthetic skill status. Both views show the activity timeline and
completed training history. Annina (Mitarbeiter 2) and Marko (Mitarbeiter 3)
appear with fictitious skill statuses but cannot receive the live participant
link until they have distinct accounts assigned. Daniel is Process & Quality.

The “E-Mail vorbereiten” control opens a mail draft for the presenter to send.
The upcoming reminder is an in-app notice. There is no automatic email, native
push, Calendar event, Google Sheet write, proof document, or connected training
record in this Site.

## Access

Room creation requires `DEMO_CREATOR_CODE`, stored as a Sites runtime secret.
The server stores only SHA-256 hashes of random role-link tokens. Tokens are
passed in URL fragments and removed from browser history before network
activity. The host and guest tokens grant different actions; rooms expire for
API access after 72 hours. Copy both role links when starting a room: a
room-only URL cannot be reopened after refresh because it has no role token.
Do not enter real training data.

When `GOOGLE_CLIENT_ID` is configured, the page offers Google sign-in and the
API requires a Google ID token on every protected request. It verifies the
signature against Google's rotating keys, issuer, audience, expiry, issue time,
and verified email, then matches the email to the server-side
`GOOGLE_TRAINER_EMAIL` or `GOOGLE_PARTICIPANT_EMAIL`. Those addresses belong
in Sites runtime settings, never source. The role link remains necessary; a
Google login alone does not grant a role.

## Local checks

```sh
node --experimental-strip-types --test lib/demo.test.ts lib/google-auth.test.ts
npx tsc --noEmit
npm run db:generate
node /Users/Matt/.codex/plugins/cache/openai-curated-remote/sites/1.1.2/scripts/build-site.mjs
```

The generated D1 migration is tracked in `drizzle/`. Apply it only to a
disposable local preview using the starter's local D1 command. The Sites
publication workflow applies it to the hosted database before uploading the
Worker. Keep `.dev.vars`, tokens, and account identifiers out of source.
