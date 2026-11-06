---
{"id":"training-members","type":"module-design","title":"Private training member access","status":"active"}
---

# Private training member access

This boundary gives verified trainers and participants their own tasks from the existing Google training workbook. The Apps Script owner application remains the training writer and owner-only administrator. Member login does not create a second case store or import the separate hosted demo's sample rooms. Reports and confirmations use the existing account-verified Google Forms and their existing processing gates.

Identity comes from a nonce-bound, server-verified Google ID token. A private, explicitly configured member grant binds an existing person key to permitted roles; the current People row supplies the exact assigned email and display alias. Google subject is retained in the app session, and non-authoritative third-party emails require an explicit subject pin. Roles are never accepted from a client label. Every task read and form handoff reads current source records and checks membership, role, person/session assignment and workflow gates. Data returned to browsers is a minimal role-specific projection; raw tables, administration URLs, other people's cases and evidence metadata stay on the server.

Sessions use opaque Secure HttpOnly same-site cookies and server-side hashes. Family generations make logout authoritative across tabs and reject login started before logout. A noncredential pending-logout marker survives reload, and one shared exclusive browser Web Lock protects its writes and compare/clear across tabs. Missing browser coordination blocks login and restore. Google identity tokens and training data do not enter localStorage, sessionStorage or IndexedDB. Production PostgreSQL contains only member authentication state; startup and migration reject mixed training schemas and search-path fallback. Local synthetic stores never configure a connected production service. Missing identity, read access, member grants or session storage fail closed.

The member frontend and API share an origin. Google credentials are held only for login, never in URLs, browser storage, logs or source. The Google read adapter has only Sheets and Forms body read scopes; it cannot book, create Forms, send mail, submit training evidence or change the matrix. Deployment, OAuth origin/client setup and read access to the private workbook/Forms require a concrete approved connected release; source and synthetic tests alone do not establish live member acceptance.

The [member access contract](../../docs/MEMBER_ACCESS.md) records the runtime configuration, API, deployment candidate and acceptance boundary. Member access depends on the canonical owner schema and Forms gates packaged with its release image; a changed owner schema or gate requires compatibility verification before member activation.
