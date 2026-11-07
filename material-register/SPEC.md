---
{"id":"training-material-register","type":"module-design","title":"Training material register","status":"active"}
---

# Training material register

The register identifies the approved material and revision for a training topic. The designated, access-controlled Google Sheet is the publication source. Excel is an editing and review input. Its rows have no effect on the catalogue until an authorized owner reviews and publishes them.

The v1 import reports invalid cells and refuses to stage any part of a batch with errors. A staged append is bound to the reviewed values and the ordered published snapshot. Each published entry records the batch, reviewer and publication time. New revisions use a distinct file reference, and withdrawal appends an entry for the original revision. The latest effective approval determines what the topic shows; a withdrawn or unavailable revision remains visible as unavailable. A historical reference resolves only its recorded material ID and revision. File permissions remain with the source.

The [v1 workflow](README.md) uses synthetic Excel and Sheet snapshots and projects the register in the desktop offline preview. It stages a local batch without changing Google. The actual register is unavailable; the descriptive fields and controlled values are provisional for the demo. Connecting the register requires a verified mapping, owner-approved field rules and a coordinated pilot. The register does not own employee identity, member access, onboarding obligations, training completion or notifications. It never assigns a revision retroactively to a legacy case or proof.
