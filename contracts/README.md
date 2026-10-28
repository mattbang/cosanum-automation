# Portable training workflow contract

`workflow.v1.json` is a machine-readable description of six action boundaries shared by the current Apps Script prototype and a future TypeScript/mobile implementation. `evaluate.mjs` is a pure, fail-closed synthetic evaluator. It performs no Google calls and grants no access to a case; any API must verify identity, assignment, current persisted rows, and external evidence before supplying `true` facts.

`current-task.v1.json` describes the read-only per-person task shape projected by `Audit.gs`. Its `canExecute: false` field is deliberate: the projection suggests a next action and actor, while the write endpoint must recheck current rows, caller identity, and assignment. One group request can therefore show different tasks for different people without granting a stale link permission to act.

Run `node scripts/test_workflow_contract.mjs` from the repository root. The test exercises each actor, scope key, required fact, forbidden fact, and value constraint, then checks cross-step negatives. It does not substitute for the existing source-specific tests or a connected case.

| Action | Current implementation | Evidence boundary |
| --- | --- | --- |
| `bookSession` | `Booking.gs` | Rechecked availability, matching Calendar event, and Sheet receipt |
| `recordDecline` | `Rsvp.gs` | One assigned guest response; other cases and group event remain unchanged |
| `recordTrainerAssessment` | `TrainerAssessment.gs` | Verified assigned trainer and Form; a failed result is recorded but is not a pass |
| `acceptParticipantAcknowledgement` | `ParticipantAcknowledgement.gs` | Verified assigned participant, Form, trainer pass, and affirmative response |
| `verifyArchive` | `archive_proof.py` and `IndividualProof.gs` | Matching proof, readable Drive/local copies, matching PDF hash and receipt |
| `applySkillUpdate` | `SkillUpdate.gs` | All phase evidence, verified archive, unchanged live level, single ledger key |

The JSON separates `requires` (facts checked before an action) from `postconditions` (facts verified after the write and before reporting success). The evaluator checks prerequisites only. The source remains authoritative for detailed checks and writes until both runtimes consume the same contract. A missing or unknown prerequisite fails closed. IDs and facts are deliberately synthetic and contain no account credentials or live resource identifiers.
