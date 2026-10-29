# Synthetic shared-demo resources, version 1

These four JSON files are the editable baseline for the public two-device demo:

| File | Stable key | Meaning |
| --- | --- | --- |
| `people.json` | `employee_id` | Fictitious roster and display role. No email or permission grant. |
| `topics.json` | `topic_id` | Four demonstration training topics and 60-minute appointment windows. |
| `skills.json` | `employee_id` + `topic_id` | Fictitious starting levels for Matthew, Annina, and Marko. |
| `materials.json` | `material_id` + `topic_id` | Short synthetic reading links and objectives. Reading time is separate from session length. |

Do not put all data into a single Sheet. Keep the eventual HR/person source, catalogue, skill matrix, and material folder independently owned and versioned. Identity-to-role assignment is private server configuration, never a field in these public files. Case history and runtime skill outcomes belong in the transactional store, not in these baseline files.

After editing, run:

```sh
node contracts/demo-resources/v1/validate.mjs
node contracts/demo-resources/v1/sync-site.mjs
node contracts/demo-resources/v1/sync-site.mjs --check
```

The sync makes deterministic copies in `shared-demo-site/lib/demo-resources/v1/`, because that Site is packaged on its own. Commit the source and copies together. The Site build checks for stale copies when the canonical source is present in the same repository. Its screens and CSV exports import the copies. The older Expo fixture and the private Apps Script have different topic IDs and richer training rules; they require a reviewed mapping before becoming consumers of this baseline.
