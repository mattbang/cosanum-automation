---
{"id":"form-response-processing","type":"module-design","title":"Retained Google Form response processing","status":"draft"}
---

# Retained Form response processing

The owner-only Apps Script application processes native responses from the registered trainer and participant Forms. Existing identity, assignment, chronology and evidence gates remain authoritative. A shared five-minute clock processor can cover all retained Forms without creating one trigger per new Form; known legacy Form-submit bindings remain supported until the reviewed migration succeeds.

The installer runs under the script lock. If the shared processor is absent, it creates that binding before retiring any registered legacy binding. At full trigger capacity it refuses setup and preserves every existing trigger. A failed creation likewise removes nothing. Capacity must be freed through a separately reviewed change; the installer never removes an unrelated job to make room. Once the shared binding exists, only exact registered demo Form/handler matches may be retired.

The processor attempts all registered Forms and every available response even when another Form or response fails. Normal rejected/replayed responses follow their existing ledger rules. An unexpected error is counted, healthy Forms continue, and the invocation throws a sanitized aggregate error after the sweep. The error contains counts rather than Form IDs, response data or raw upstream messages. Successful sweeps retain their processed/saved result. Failures therefore remain unsuccessful scheduled executions instead of disappearing in an unconsumed return value; Google describes the existing [installable-trigger failure reporting](https://developers.google.com/apps-script/guides/triggers/installable#errors_in_triggers).

Source integration does not install or migrate a trigger. The connected verifier must pin the reviewed source and record any separately authorized setup, exact before/after bindings and a controlled response readback. Keep the existing replay/deployment writer and the [owner-session boundary](APP_SESSIONS.md) intact.
