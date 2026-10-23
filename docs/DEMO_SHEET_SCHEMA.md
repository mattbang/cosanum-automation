# Demo Sheet schema

The Google Sheet used by the prototype is synthetic and marked `[DEMO]`. Local source files define the contract; live asset IDs and account configuration stay in the ignored private handoff.

## Version 4 (mode and phase plan)

`Requests!H` stores `mode` (`group` or `individual`) when a phase plan is saved. Existing draft rows keep their IDs and a blank mode until then. `Sessions` stores `session_id`, `request_id`, `phase`, `phase_order`, `mode`, `trainer_key`, `duration_minutes`, `theory_session_id`, `status`, `created_at`, `demo_marker`. `SessionCases` stores `session_id`, `case_id`, `request_id`, `person_key`, `demo_marker`; a group session links to multiple person cases. Both new tabs are created empty. Session status is `planned` only in Increment 03. The practice row points to its theory session, and target completion requires verified passes for every phase linked to the case, including theory.

`setupDemo()` migrates version 3 by adding only the `mode` header in `Requests!H`, preserving every existing row and cell in A:G, and then creates the two new tabs. Repeated setup checks headers without duplicating tabs. A plan save uses a script lock and deterministic session IDs; repeating the same save returns the existing plan, while conflicting assignments fail. The private fixture's topic and skill values do not change.

## Version 3 (persona aliases)

| Tab | Columns | Purpose |
| --- | --- | --- |
| `Topics` | `topic_id`, `display_name`, `source_material`, `theory_required`, `practice_required`, `theory_minutes`, `practice_minutes`, `group_suitability`, `progression_rule`, `demo_marker`, `configured_target_level` | Five demo topics. For the two `0→1→2→3` topics, target selection follows the chain and the configured target cell is blank. For the other three, the configured target is explicitly `1`. |
| `People` | `person_key`, `email`, `demo_role`, `demo_marker`, `persona_id`, `display_alias` | Four agreed test identities. Persona IDs and display aliases come from the private fixture; `person_key` remains the durable case reference. |
| `Skills` | `person_key`, `topic_id`, `skill_level`, `status_mark`, `demo_marker` | One current synthetic level per person and topic. Intake never writes this tab. |
| `Requests` | `request_id`, `action_id`, `topic_id`, `target_level`, `status`, `created_at`, `demo_marker` | One draft row per browser save action. `action_id` is the retry key; `created_at` is ISO UTC. |
| `ParticipantCases` | `case_id`, `request_id`, `person_key`, `current_level`, `target_level`, `status`, `created_at`, `demo_marker` | One separate draft case per selected person, linked to the request. |

The request ID is `REQ-` plus the action UUID in uppercase. A case ID is `CASE-` plus the same UUID and the stable person key. Saving a request rechecks the live matrix under an Apps Script lock; a retry with the same action ID returns the existing draft. Draft creation does not change `Skills`.

The persona aliases are display metadata only. They do not assert that a test account belongs to the named report persona or change its synthetic matrix level. The source mapping is recorded in the ignored local handoff; no account-specific alias mapping is in public source code.

## Migration from version 2

`setupDemo()` calls `migrateDemoSchemaV2ToV3_()` before checking headers. It verifies the four stable person keys, appends `persona_id` and `display_alias` to `People!E:F` from the ignored fixture, and leaves columns A:D and every `Skills`, `Requests`, and `ParticipantCases` row intact. A repeated setup validates the version 3 headers and does not append duplicate data. A separate one-cell demo-role copy edit made the coach label gender-neutral; stable keys, emails, and skill values were preserved. The ignored JSON fixture, generated private Apps Script fixture, and local workbook builder use the same columns.

## Migration from version 1

`setupDemo()` calls `migrateDemoSchemaV1ToV2_()` before the alias migration. The version 2 migration verifies all five existing topic IDs, appends `configured_target_level` in column K, writes blank for the two progression topics and `1` for the other three, then `setupDemo()` creates the empty `Requests` and `ParticipantCases` tabs with headers. It leaves every existing `People` and `Skills` row intact and does not reset manually corrected matrix entries. `resetDemoFixture()` remains an explicit reset of the three original data tabs; it does not erase draft records.
