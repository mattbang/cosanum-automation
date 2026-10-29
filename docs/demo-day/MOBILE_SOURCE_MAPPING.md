# Mobile Source Mapping: Legacy Offline Fixture vs. Public Baseline

> [!NOTE]
> **Synthetic Data Notice**: All records, identifiers, roles, and competencies described in this document are strictly synthetic mock artifacts created for client demonstration and integration planning. This document contains no personal data and no email addresses. No live Google Sheets or Google Calendar connectivity is active or claimed. Resources remain separate modular contracts rather than a single monolithic Sheet.

## 1. Overview and Equivalence Boundary

The mobile client historically operates against a legacy standalone fixture (`fixtures/offline_fixture.json` overlaid by `mobile/src/workflow.ts`). Concurrently, the shared live demo baseline has been established under `contracts/demo-resources/v1/` as documented in `RESOURCE_HARMONIZATION.md`.

**Critical Architecture Constraint**: Any textual, naming, or role overlap between the legacy offline fixture and the public baseline represents coincidental display correspondence only. Name and role similarities do **not** constitute verified person identity, shared credentials, or curricular topic equivalence.

## 2. Entity Mappings

### 2.1 People and Role Mapping

The legacy fixture defines four internal keys with localized display overlays and numeric trainer thresholds. The public baseline defines structured employee IDs (`EMP-001` through `EMP-004`). There is no supported identity bridge linking legacy learner records to public baseline employees.

| Legacy Fixture Key | Legacy Person ID & Role | Mobile Display Overlay | Public Baseline ID & Name | Public Role | Mapping Disposition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `MATT` | `PERSON-1` / Quality Lead | Daniel / P&Q | `EMP-004` / Daniel | Process & Quality | **Display correspondence only**. Trainer eligibility (Level 4 in fixture) does not map to canonical qualifications. |
| `MARIE` | `PERSON-2` / Trainer | Marie / HCM4 | *(None)* | *(None)* | **Unmapped legacy trainer**. No counterpart exists in public `people.json`. Retained exclusively in offline fixture. |
| `WOHNUNG` | `PERSON-3` / Learner A | Person A | `EMP-001`..`003` (Matthew, Annina, Marko) | Mitarbeiter 1..3 | **No equivalence**. Synthetic placeholder; cannot be linked to any specific public employee. |
| `SUMNER` | `PERSON-4` / Learner B | Person B | `EMP-001`..`003` (Matthew, Annina, Marko) | Mitarbeiter 1..3 | **No equivalence**. Synthetic placeholder; cannot be linked to any specific public employee. |

### 2.2 Topic and Curriculum Mapping

The legacy fixture tracks five modular industrial topic codes with bifurcated duration phases, whereas the public baseline specifies four operational demo modules with flat 60-minute session blocks.

| Legacy Topic ID | Legacy Topic Config & Mobile Display | Public Baseline ID | Public Topic Name | Mapping Disposition |
| :--- | :--- | :--- | :--- | :--- |
| `TC_R030` | `Wareneingang · Demo`<br>60m theory + 180m practice (0→1→2→3) | `TR-1` | Wareneingang | **Lexical overlap only**. Not an approved equivalent training definition. Different duration and progression structures. |
| `TC_R027` | `Demo-Schulungsmodul TC_R027`<br>60m theory + 180m group practice (0→1→2→3) | *(None)* | *(None)* | **Unmapped fixture topic**. No public counterpart in v1 baseline. |
| `TC_R033` | Generic display<br>60m theory + 180m group practice (Target: 1) | *(None)* | *(None)* | **Unmapped fixture topic**. No public counterpart in v1 baseline. |
| `TC_R052` | `Hochregallager · Demo`<br>60m theory only (Target: 1) | *(None)* | *(None)* | **Unmapped fixture topic**. High-bay warehouse theory module specific to legacy offline flows. |
| `TC_R077` | Generic display<br>60m theory + 180m group practice (Target: 1) | *(None)* | *(None)* | **Unmapped fixture topic**. No public counterpart in v1 baseline. |
| *(None)* | *(None)* | `TR-2` | Kommissionierung | **Public baseline only**. 60-minute synthetic operational module. |
| *(None)* | *(None)* | `TR-3` | Qualitätskontrolle | **Public baseline only**. 60-minute synthetic operational module. |
| *(None)* | *(None)* | `TR-4` | Prozessänderung | **Public baseline only**. 60-minute synthetic operational module. |

## 3. Differing Skill and Phase Semantics

The two environments reflect fundamentally divergent state semantics and competency models:

* **Skill Scale & Qualifications**:
  * *Legacy Fixture*: Evaluates levels `0` through `4`. Level `4` signifies full trainer qualification (`trainerChoices` requires level `4` for `MATT` or `MARIE`). Progression strictly enforces `target = current + 1`. Distinct non-numeric states exist: `'-'` denotes "not planned" while missing/empty cells represent an explicit unresolved error state (neither is equivalent to level `0`).
  * *Public Baseline*: Restricts learner matrix cells to levels `0` through `3` across 12 starting cells for `EMP-001` through `EMP-003`. `EMP-004` (Daniel) has no learner matrix cells.
* **Instructional Phases and Durations**:
  * *Legacy Fixture*: Decomposes courses into formal theoretical instruction (e.g., 60 minutes) and individual or group practical floor training (e.g., 180 minutes).
  * *Public Baseline*: Employs standardized 60-minute synthetic operational session windows (`DEMO-1`). Public web learning collateral uses separate 8- to 10-minute micro-lessons rather than the dual-phase industrial plan.
* **Data Architecture**:
  * Resources are explicitly maintained as isolated, bounded JSON contracts (`people.json`, `topics.json`, `skills.json`, `materials.json`) rather than merged into a single monolithic sheet or synchronized spreadsheet.

## 4. Harmonization Checklist (Proposals vs. Status)

The following bounded checklist specifies prerequisites before both clients can consume a single authoritative catalogue:

- [ ] **Data Model Alignment (Proposed)**: Formalize a schema extension supporting either dual-phase durations (theory/practice) or normalize mobile workflow expectations to modular session blocks.
- [ ] **Competency Normalization (Proposed)**: Decide whether Level 4 (Trainer Qualification) remains an explicit competency state in public contracts or transitions into a separate role-entitlement schema.
- [ ] **Sentinel Value Standardization (Proposed)**: Unify parsing across clients for `'-'` (not planned) and unassigned/missing matrix states to prevent implicit fallback to `0`.
- [ ] **Contract Adoption (Proposed)**: Refactor `mobile/src/workflow.ts` to consume `contracts/demo-resources/v1/` through an adapter layer rather than bundling `fixtures/offline_fixture.json`.
- [ ] **Decoupled Delivery Preservation (Completed Constraint)**: Ensure mobile and public web endpoints consume discrete resource manifests without introducing monolithic dependencies or runtime spreadsheet sync.
