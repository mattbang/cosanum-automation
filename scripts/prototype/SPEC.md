---
id: local-prototype-runtime
type: module-design
title: Local synthetic intake runtime
status: draft
---

# Local synthetic intake runtime

This module owns a credential-free, writable rehearsal boundary for synthetic training intake. Workflow decisions come from the checked-in Apps Script functions, executed with a bounded in-memory Sheet adapter and persisted as canonical table rows. It does not own a second eligibility engine or modify the Google deployment. The HTTP page is a focused intake shell because the complete owner page also requires scheduling and proof APIs that this runtime does not expose.

The foundation accepts only draft requests, their person cases and initial deadline history. Other lifecycle tables must remain empty. This prevents an incomplete adapter from interpreting later evidence as accepted completion. Owner mutations use canonical intake/deadline validation, and reads use the canonical audit/deadline projections. The existing preview is a separate read-only surface.

## Identity and data ownership

Known fixture identities and roles are explicit local simulation controls, not authentication. The synthetic owner may create drafts, change the clock and reset. Participants receive only their own cases and shared request summaries; deadline scopes are projected to those visible cases. A trainer receives no cases until an assignment-aware scheduling adapter exists. Browser-supplied roles never authorize access to connected systems.

The public fixture's display-only PER-DEMO identifiers are normalized to canonical synthetic PER-01 through PER-04 before setup validation. Original fixture bytes are fingerprinted in the store. Version, schema, fixture, row structure and draft invariants are checked at startup; incompatible or corrupt data fails closed rather than being reset. Register import adapters must explicitly extend this boundary before changing fixture-owned people, topics or skills.

## Persistence and transport

One process holds an exclusive writer lease per store. Synchronous commands validate an in-memory transaction and atomically replace the JSON state file; failed operations restore the prior in-memory state. A stopped process releases its own lease. Crash recovery requires confirming that the recorded process is gone before removing a stale lease; uncertain leases are never automatically removed.

The clock is a persisted UTC instant, initially 2026-11-09T08:00:00.000Z. Reset requires the exact confirmation RESET SYNTHETIC DATA and restores this clock and seed within the selected store only. Saved data lives in the ignored local data area by default.

The server binds to loopback, checks Host and browser Origin, allows only explicit RPCs, limits JSON body size and serves no arbitrary files. Synthetic identities, sample rows and local state are its only data sources. Calendar, mail, Forms, proof issuance, Google authentication and production database writes are outside this module's authority.
