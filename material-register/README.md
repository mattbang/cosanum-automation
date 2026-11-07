# Training material register · synthetic pilot

The designated Google Sheet is the published source. Excel is where an editor proposes changes. The local workflow validates the workbook, previews the proposed changes and stages an append only after review. It uses synthetic records and makes no Google requests.

## Try the review

Use Node 24 and Python 3.11 or newer. Start from [the Excel template](demo/Training-material-register-template.xlsx). Its instructions and three sample rows show a new material, an unchanged revision and a draft.

```sh
node material-register/cli.mjs preview material-register/demo/Training-material-register-template.xlsx
node material-register/cli.mjs stage material-register/demo/Training-material-register-template.xlsx \
  --review REPLACE_WITH_REVIEW_ID --reviewer "Demo reviewer" --out /tmp/material-register-batch.json
node material-register/cli.mjs catalogue --published /tmp/material-register-batch.json --as-of 2026-11-07
node material-register/cli.mjs history MAT-A 01 --published /tmp/material-register-batch.json
```

Replace `REPLACE_WITH_REVIEW_ID` with the ID from a preview you have reviewed. The preview identifies additions, revisions, withdrawals, drafts, unchanged rows and quarantined cells. Any error blocks the batch. Staging revalidates the workbook and snapshot; it refuses a stale review and never overwrites an existing output file. The output contains the expected base fingerprint, exact append range and rows, plus the simulated readback snapshot. Preview the same workbook against that snapshot to see already applied edits as unchanged; staging this second review creates no duplicate rows.

Run `npm run dev` and open **Themen & Matrix** in the desktop offline preview. The checked-in [published Sheet snapshot](demo/published-sheet.json) shows `MAT-A` revision `02` as approved, `MAT-B` as withdrawn and `MAT-C` with an unavailable file. It still resolves `MAT-A` revision `01` by its original file reference. The preview always reads this synthetic snapshot; it does not publish a staged batch.

## v1 data contract

Use the exact headers and order in the visible `MaterialEdits_v1` tab. This version allows one proposed row per material ID per batch, at most 1,000 data rows and an 8 MiB Excel file. Input beyond the register columns, formulas (even with cached values), merged register cells, hidden register columns and hidden populated rows are rejected. Blank rows are ignored. The instructions tab is outside the import.

| Fields | Synthetic rules |
| --- | --- |
| `material_id`, `topic_id` | Stable uppercase `MAT-…` ID and exact topic ID from the catalogue |
| `title`, `revision` | Required text. Revision labels are case sensitive and opaque; `01` and `1` are different. |
| `material_type`, `language`, `owner` | Optional. Demo types: guide, slides, checklist, video. Demo languages: de, en, fr, it. |
| `status`, `effective_date` | Draft, approved or withdrawn, written as lowercase. Use a valid `YYYY-MM-DD` date. Excel also accepts supported date-formatted whole-day cells and rejects fractional days. |
| `file_ref` | Exact file ID without a URL. The demo resolves `demo:…` IDs against its fictional file list. |

`MaterialRegister_v1` is the same ordered grid plus `batch_id`, `published_by` and `published_at` (UTC ISO timestamp). It contains literal canonical text and only approved or withdrawn events, in append order. The exported snapshot shape is `{ "sheet": "MaterialRegister_v1", "values": [[...headers], ...rows] }`. The reviewer label in the local output records the supplied name; it is not proof of a connected sign-in.

An approved revision is immutable. A new revision has its own file ID and an effective date at or after the most recent approval. If approvals share an effective date, the later publication wins. Withdrawal repeats the approved revision's details and supplies a withdrawal date at or after its effective date. A missing or withdrawn current file does not fall back to an earlier revision. Resolve a case or proof by its exact recorded pair; a legacy filename alone does not identify a revision.

## Connected pilot and rollback

The current business register is unavailable. The older Excel snapshot and the public synthetic resource catalogue are not publication sources. Confirm the actual register owner, fields, allowed values, topic and file mappings, update schedule and editing rights before adopting a real source. Use version-specific file references and verify availability as the authorized reader; the register grants no access to the files.

For a pilot, agree on the exact restricted workbook and single writer. Capture the approved tab's values and cell metadata so formulas, merges and hidden columns cannot pass as literal values. Compare a fresh snapshot with the reviewed base fingerprint under that writer boundary before appending the exact reviewed rows as raw text. Read the tab back, compare its prefix and appended rows, and verify the authorized app shows the same approved ID/revision and can still resolve a pinned earlier revision. No connected read, append, runtime activation or case migration is part of this local slice.

Keep the old catalogue read path available until connected acceptance. If the pilot fails, disable the connected read path and retain its ledger and recorded references; use a reviewed withdrawal or new revision to correct a publication. Do not delete published history or infer a revision for an existing case or proof.
