# Process model and verification

The primary `training-demo.bpmn` is one **connected, non-executable training lifecycle** with Daniel, application and Matthew responsibility lanes. Its decision gateways and loops cover access failure, individual offer rejection, all offers declined, new offers before training, cancellation before/during training, early or scheduled-time start, missing participant confirmation and failed-result retraining. Scheduled time is a manual wait followed by an explicit trainer start; there is no claimed automatic start or external Calendar timer. All process nodes are reachable from the start and have a path to a terminal outcome.

The planned automatic reminder/escalation is a labelled annotation beside the open confirmation state, not an executable service task. The primary coloured `process-flow.svg` uses the same graph and geometry. `source-flow.svg` explains data provenance. Eight independent scenario strips remain in `scenario-appendix.bpmn` and `scenario-appendix.svg` for focused discussion; they are supporting views, not the primary model. Manual actions and future capabilities are explicitly marked.
The model uses standard BPMN 2.0 tasks, start/end events, sequence flows and BPMNDI. It deliberately avoids vendor extensions and executable timers, automated mail or Calendar service tasks. Node centres use 5-unit increments. The recalled **5×5 setting is ADONIS editor Fangraster**, not an XML offset: no invented offset attribute is serialized. In ADONIS, set horizontal and vertical Fangraster to 5 after import.

The Simulation repository was inspected read-only for ADONIS conventions, schemas and its offline renderer. No original training, report, simulation-result or private reference file was copied into the public package. New diagrams were generated from synthetic Site behavior.

Official references checked 29 October 2026: [ADONIS BPMN DI import](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/bmpndi-00000/) supports BPMN/XML and ZIP files whose BPMN files are at archive root; [ADONIS editor tools](https://docs.boc-group.com/adonis/de/docs/19.1/user_manual/motoo-00000/) documents Fangraster. Local convention and native-import limitations are described in the read-only Simulation `docs/ADONIS_MODELS.md`.

## Reproduce

```sh
python3 docs/demo-day/build_models.py
python3 docs/demo-day/validate_models.py
```

Validation passes against the official OMG BPMN 2.0 XSD already present in the Simulation repository, using `xmllint` when `lxml` is unavailable. It also checks unique IDs, reference resolution, full graph reachability, terminal routes, lane coverage, incoming/outgoing references, orthogonal sequence flows clear of unrelated node bodies, BPMNDI presence, 5/5 node-centre alignment and parseable SVG. No network or deployment is needed. The schema path is intentionally read-only and machine-specific; point it at another unchanged OMG schema bundle if moved.

The existing local bpmn-js 18.3.1 renderer imported the unified primary diagram and all eight appendix diagrams with **zero warnings**. The initial happy-path preview and the unified layout were visually inspected; custom SVGs were rasterized using the bundled Sharp runtime and visually inspected for clipping and readability. An initial browser SVG screenshot timed out; Sharp supplied the successful visual check. The first renderer attempt lacked bundled Chromium, and sandboxed Chrome could not start; an approved normal local Chrome launch completed the BPMN imports. No browser installation or permissions bypass was used.

**Native ADONIS import remains unverified.** Schema and bpmn-js import do not prove ADONIS retention or business execution. Application tests and two-device runtime checks belong to the main implementation workstream; this package makes no new connected Google, delivery, production or publication claim.
