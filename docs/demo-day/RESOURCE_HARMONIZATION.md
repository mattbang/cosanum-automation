# Demo resource harmonization · 29 October 2026

The shared Site source in this checkout now reads four versioned synthetic resources under `contracts/demo-resources/v1/`: people, topics, skills, and materials. A deterministic packaging step copies them into the Site. Its roster, topic picker, starting skill matrix, material cards, and three CSV source endpoints therefore resolve the same IDs and values. Validation checks uniqueness, foreign keys, all 12 participant/topic baseline cells, relative material links, and the absence of email addresses. This source change passed locally and was packaged into public Site version 8; Sites reported deployment `succeeded`. The assigned-account two-phone walkthrough remains a separate acceptance check.

This is a **demo baseline**, not a live HR, training, or Google Sheets integration. The active room is persisted separately in the hosted Site's D1 database; a confirmed demonstration outcome changes that room's synthetic matrix, not the baseline JSON or a Google Sheet. Account-to-room authorization remains in server-side configuration. Annina and Marko remain visible as sample people but cannot receive the current live two-device invitation.

The local PostgreSQL pilot uses private `.test` identities. Its actor keys map to the public synthetic people as follows; these are internal test identifiers, not account emails:

| Public synthetic person | Local pilot actor key |
| --- | --- |
| `EMP-001` Matthew | `MATTHEW` |
| `EMP-002` Annina | `ANNINA` |
| `EMP-003` Marko | `MARKO` |
| `EMP-004` Daniel | `DANIEL` |

The extra local `HCM4` trainer represents a training role outside the four-person public roster. The pilot validates requests against the four `TR-*` topics and registered private test identities. It accepts one person in a “group” request with `HCM4`, matching the single-attendee fallback. Multi-person group scheduling is deliberately held until Daniel can hold the trainer role as well as Process & Quality; creating a case now would imply an action path the backend cannot authorize.

For the eventual connected workflow, use separate primary resources: personnel or directory identity, versioned training catalogue, employee skill matrix, and approved materials in Drive. PostgreSQL owns requests, sessions, responses, evidence, and audit events. Choose one writer per field and record source version/ID on imported facts. Calendar free/busy and event IDs are another integration, not columns in a giant Sheet. The private Apps Script's five `TC_R*` topics and richer theory/practice rules are not automatically equivalent to the Site's four `TR-*` examples; map them only after the owner approves definitions.

**Repeatable check:** `node contracts/demo-resources/v1/validate.mjs && node contracts/demo-resources/v1/sync-site.mjs --check`, followed by the Site's `node --test lib/*.test.ts`, `tsc --noEmit`, and build. The build runs a packaged-copy check. The source validation and Site version 8 deployment are recorded separately; two-phone sign-in and room acceptance remain unverified.
