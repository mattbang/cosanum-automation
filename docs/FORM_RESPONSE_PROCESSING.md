---
{"id":"form-response-processing","type":"module-design","title":"Retained Google Form response processing","status":"draft"}
---

# Retained Form response processing

The owner-only Apps Script application processes native responses from the registered trainer and participant Forms. Existing identity, assignment, chronology and evidence gates remain authoritative. A shared five-minute clock processor can cover all retained Forms without creating one trigger per new Form; known legacy Form-submit bindings remain supported until the reviewed migration succeeds.

The installer runs under the script lock. If the shared processor is absent, it creates that binding before retiring any registered legacy binding. At full trigger capacity it refuses setup and preserves every existing trigger. A failed creation likewise removes nothing. Capacity must be freed through a separately reviewed change; the installer never removes an unrelated job to make room. Once the shared binding exists, only exact registered demo Form/handler matches may be retired.

The processor acquires the script lock before its first Sheet read and retains it through the sweep. An overlapping invocation returns `busy` without reading the workbook or releasing the active invocation's lock. The processor calls the already-locked trainer and participant handlers; those handlers do not reacquire the outer lock. All exit paths release an acquired lock.

Within that lock, the processor attempts every registered Form even when another Form or response fails. It skips recorded `(form_id, response_id)` pairs, including rejected attempts, and skips repeated copies within a sweep after a successful processing call. A failed call remains retryable. Current identity and completion gates still apply independently when links or proof are released. A failed registry read does not prevent attempting the later registry.

An unexpected error is counted, healthy Forms continue, and the invocation throws a sanitized aggregate error after the sweep. The error contains counts rather than Form IDs, response data or raw upstream messages. Successful sweeps retain their processed/saved/skipped counts. Failures therefore remain unsuccessful scheduled executions instead of disappearing in an unconsumed return value; Google describes the existing [installable-trigger failure reporting](https://developers.google.com/apps-script/guides/triggers/installable#errors_in_triggers).

Source integration does not install or migrate a trigger. The connected verifier must pin the reviewed source and record any separately authorized setup, exact before/after bindings and a controlled response readback. Keep the existing replay/deployment writer and the [owner-session boundary](APP_SESSIONS.md) intact.
