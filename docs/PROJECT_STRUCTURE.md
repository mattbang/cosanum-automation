# Project structure

This map separates deployable source, local evidence, and historical work. The local `docs/private/`, `data/`, and `archive/` trees are ignored by Git.

| Path | Purpose | Current handling |
| --- | --- | --- |
| `apps-script/` | Versioned training-app source | Integrate reviewed code here; deploy only to the dedicated owner-only target. |
| `scripts/` | Local fixture, archive, and test tools | Run against synthetic data; the local archive helper writes evidence under `archive/`. |
| `docs/` | Public overview, schema, contracts, and feature status | Use the feature register for the highest evidenced state. |
| `docs/product/` | Templates, replay checklist, and interface mockups | Design and acceptance references, not live Google records. |
| `docs/private/` | Local account handoffs and current release checkpoint | Read its local `README.md` before connected work. Do not publish raw IDs or evidence. |
| `docs/private/history/` | Completed increment handoffs and original migration plan | Local document archive with a hash manifest. Historical Google assets have not been retired. |
| `data/dedicated-demo/` | Dedicated account configuration, staged Apps Script source, and private fixture | Active connected staging; never replace its private fixture with public source. |
| Root `.clasp.json`, `data/.clasprc.json`, earlier `data/` fixtures | Historical Matt-owned prototype or local test inputs | Preserve them. Select the dedicated target explicitly for active Google work. |
| `archive/` | Local evidence copies and indexes | Operational evidence archive; its matching Google Drive copy is part of the demo. Do not treat it as the document-history folder. |
| `docs/reference/`, `docs/mockups/` | Original source screenshots and early visual references | Local reference material, not deployed behavior. |
| `output/`, `explainers/`, `promo/`, `sites/` | Generated reports, explanations, exploratory media, and site artifacts | Keep separate from the training release candidate. Review before publishing or reusing. |
| `.worktrees/`, `hive/`, `roster-backups/` | Local agent checkouts and orchestration state | Preserve active worktrees and state; these are not release source or demo evidence. |

The source candidate is identified in the local `docs/private/CURRENT_RELEASE_CANDIDATE.md`. A current, numbered Google deployment requires its own connected verification. The private account activity audit records why local archival must not be mistaken for retirement of the old Google automation.
