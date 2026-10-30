import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentTask, initialState, slotAvailable, transition } from '../../mobile/src/workflow.ts';

function unbookedGroupState() {
  const state = initialState();
  for (const item of state.cases.filter(entry => entry.sessionId === 'SES-G')) {
    item.status = 'planning';
    item.slotId = undefined;
    item.eventId = undefined;
  }
  return state;
}

test('group booking shares one event while person outcomes stay separate', () => {
  let state = unbookedGroupState();
  const group = state.cases[0];
  assert.equal(slotAvailable(state, group, 'SLOT-1'), true);
  assert.equal(slotAvailable(state, group, 'SLOT-2'), true);
  assert.equal(slotAvailable(state, group, 'SLOT-3'), false);
  state = transition(state, group.id, 'book', 'SLOT-1');
  assert.equal(state.cases[0].eventId, state.cases[1].eventId);
  state = transition(state, group.id, 'decline');
  assert.equal(state.cases[0].declined, true);
  assert.equal(state.cases[1].declined, undefined);
  assert.equal(state.cases[1].status, 'invited');
});

test('failed trainer result blocks personal acknowledgement', () => {
  let state = transition(initialState(), 'CASE-S-1', 'book', 'SLOT-3');
  state = transition(state, 'CASE-S-1', 'fail');
  assert.equal(currentTask(state.cases[2]).state, 'blocked');
  assert.throws(() => transition(state, 'CASE-S-1', 'acknowledge'), /Gate blocked/);
});

test('full synthetic per-person path and replay guard', () => {
  let state = transition(unbookedGroupState(), 'CASE-G-1', 'book', 'SLOT-1');
  state = transition(state, 'CASE-G-1', 'pass');
  state = transition(state, 'CASE-G-1', 'acknowledge');
  state = transition(state, 'CASE-G-1', 'proof');
  state = transition(state, 'CASE-G-1', 'archive');
  state = transition(state, 'CASE-G-1', 'skill');
  assert.equal(state.cases[0].status, 'complete');
  assert.equal(state.cases[1].status, 'invited');
  assert.equal(currentTask(state.cases[0]).canExecute, false);
  assert.throws(() => transition(state, 'CASE-G-1', 'skill'), /Verified archive required/);
});
