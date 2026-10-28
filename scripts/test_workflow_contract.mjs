import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAction, finalizeAction } from '../contracts/evaluate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'contracts/workflow.v1.json'), 'utf8'));
assert.equal(contract.schemaVersion, 1);
assert.equal(contract.actions.length, 6);
assert.equal(new Set(contract.actions.map((a) => a.id)).size, 6);

const scope = { requestId: 'REQ-1', sessionId: 'SES-1', caseId: 'CASE-1', proofId: 'PROOF-1', proofVersion: '1' };
for (const action of contract.actions) {
  assert.ok(action.source && fs.existsSync(path.join(root, action.source)), `${action.id} source exists`);
  assert.ok(action.idempotencyKey && action.scopeKey.length, `${action.id} has replay and scope binding`);
  for (const fact of action.requires) assert.ok(contract.facts[fact], `${action.id}: ${fact} defined`);
  for (const fact of action.postconditions || []) assert.ok(contract.facts[fact], `${action.id}: ${fact} postcondition defined`);
  const facts = Object.fromEntries([...action.requires.map((key) => [key, true]), ...(action.forbids || []).map((key) => [key, false])]);
  const values = { ...action.equals };
  const input = { actor: action.actor, scope, facts, values };
  assert.equal(evaluateAction(contract, action.id, input).allowed, true, `${action.id} happy path`);
  assert.equal(evaluateAction(contract, action.id, input).result, null, `${action.id} preflight is not committed success`);
  for (const fact of action.postconditions || []) {
    assert.equal(finalizeAction(contract, action.id, input).allowed, false, `${action.id} missing readback ${fact}`);
  }
  const complete = { ...input, facts: { ...facts, ...Object.fromEntries((action.postconditions || []).map(key => [key, true])) } };
  assert.equal(finalizeAction(contract, action.id, complete).allowed, true, `${action.id} verified postconditions`);
  assert.equal(evaluateAction(contract, action.id, { ...input, actor: 'wrong_role' }).allowed, false, `${action.id} role`);
  for (const key of action.scopeKey) {
    assert.equal(evaluateAction(contract, action.id, { ...input, scope: { ...scope, [key]: '' } }).allowed, false, `${action.id} missing ${key}`);
  }
  for (const fact of action.requires) {
    assert.equal(evaluateAction(contract, action.id, { ...input, facts: { ...facts, [fact]: false } }).allowed, false, `${action.id} missing ${fact}`);
  }
  for (const fact of action.forbids || []) {
    assert.equal(evaluateAction(contract, action.id, { ...input, facts: { ...facts, [fact]: true } }).allowed, false, `${action.id} ${fact} conflict`);
  }
  for (const key of Object.keys(action.equals || {})) {
    assert.equal(evaluateAction(contract, action.id, { ...input, values: { ...values, [key]: 'wrong' } }).allowed, false, `${action.id} wrong ${key}`);
  }
}
assert.deepEqual(contract.actions.find((a) => a.id === 'bookSession').postconditions, ['eventVerified', 'receiptSaved']);
assert.deepEqual(contract.actions.find((a) => a.id === 'verifyArchive').postconditions, ['archiveReceiptVerified']);

// A declined member never changes the group event or the other case.
const declined = contract.actions.find((a) => a.id === 'recordDecline');
assert.equal(declined.result.groupEvent, 'unchanged');
assert.equal(declined.result.otherCases, 'unchanged');
assert.equal(evaluateAction(contract, 'recordDecline', { actor: 'system', scope, facts: { eventAndGuestVerified: true }, values: { guestResponse: 'accepted' } }).allowed, false);

// A failed trainer result may be recorded, but it does not satisfy the participant gate.
assert.equal(evaluateAction(contract, 'recordTrainerAssessment', { actor: 'assigned_trainer', scope, facts: { assignedTrainer: true, trainerFormVerified: true }, values: { attendance: 'absent', result: 'failed' } }).allowed, true);
assert.equal(evaluateAction(contract, 'acceptParticipantAcknowledgement', { actor: 'assigned_participant', scope, facts: { assignedParticipant: true, participantFormVerified: true, trainerPass: false, answeredYes: true } }).allowed, false);

// No archive or skill update can follow a missing or corrupt local copy.
assert.equal(evaluateAction(contract, 'verifyArchive', { actor: 'process_quality', scope, facts: { allPhaseEvidence: true, proofVerified: true, drivePdfVerified: true, localPdfVerified: false, archiveReceiptVerified: true } }).allowed, false);
assert.equal(evaluateAction(contract, 'applySkillUpdate', { actor: 'system', scope, facts: { allPhaseEvidence: true, proofVerified: true, archiveReceiptVerified: false, liveLevelUnchanged: true, levelFourTarget: false, duplicateAppliedUpdate: false }, values: { proofStatus: 'archived_verified' } }).allowed, false);

console.log('Workflow contract: six actions, scope, role, gates, and cross-step negatives passed.');
