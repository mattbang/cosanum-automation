# Demo proof metadata and checksum gate

Each participant proof keeps its existing Google Doc ID, PDF ID, folder, and version. `createIndividualProof` adds five public Drive `properties` to both files after creation. `backfillProofMetadata({caseId})` applies the same properties to an existing proof without recreating it. Both operations refuse conflicting properties and fail if a Drive search for the proof ID finds another file.

| Property | Source |
| --- | --- |
| `cosanum_request_id` | `Proofs.request_id` |
| `cosanum_case_id` | `Proofs.case_id` |
| `cosanum_proof_id` | `Proofs.proof_id` |
| `cosanum_proof_version` | `Proofs.proof_version` as text |
| `cosanum_demo_marker` | `[DEMO]` |

The read-only lookup requires exactly one Doc and one PDF with the registered IDs, names, MIME types, parent folder, and property values. Skill updates and completion notices use this lookup after the existing archive receipt gate. The PDF's `sha256Checksum` must match the receipt. A Google Doc has no binary Drive checksum; the local editable export and manifest remain its integrity record.

The local archive helper requests `properties` and `sha256Checksum` from Drive. It compares the stored PDF checksum with the downloaded PDF bytes, the saved local PDF, manifest, and receipt. A missing checksum, missing file, extra metadata match, or conflicting identity marks the case `archive_error`; it cannot advance the skill level. A retry does not create a new file or manifest entry. Existing connector captures must include complete `metadata_matches` from a Drive search by `cosanum_proof_id`, and metadata for the Doc and PDF in `files` and `children`; old captures fail closed. Capture the fresh search result and checksum rather than inventing them.

Connected gate: enable Drive Advanced Service v3 in the dedicated script, ensure its Cloud project has the Drive API available, push the reviewed source, and run backfill on the existing synthetic proof. Confirm the Drive search returns exactly the original two IDs and the PDF checksum is present. Then rerun the local archive verification and check that the Sheet receipt, skill, and audit statuses agree. No connected behavior is claimed by the offline tests.

References: [Drive Advanced Service](https://developers.google.com/apps-script/advanced/drive), [custom properties](https://developers.google.com/workspace/drive/api/guides/properties), [file checksum field](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).
