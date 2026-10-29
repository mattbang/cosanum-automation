import assert from 'node:assert/strict';
import test from 'node:test';
import { currentSkillMatrix, initialState, LIVE_PARTICIPANT, PARTICIPANTS, transition } from './demo.ts';

const now = '2026-10-29T12:00:00.000Z';
const first = '2026-10-30T09:00:00.000Z';
const second = '2026-10-31T09:00:00.000Z';

test('two-device path rejects one slot, accepts another, records proof and skill', () => {
  let state = transition(initialState(), 'host', { type: 'invite', topic: 'Wareneingang', participant: LIVE_PARTICIPANT, offers: [first, second], targetLevel: 2 }, now);
  state = transition(state, 'guest', { type: 'reject_offer', offer: first }, now);
  assert.deepEqual(state.active?.rejectedOffers, [first]);
  state = transition(state, 'guest', { type: 'accept_offer', offer: second }, now);
  assert.equal(state.active?.acceptedOffer, second);
  state = transition(state, 'host', { type: 'start_early' }, now);
  state = transition(state, 'host', { type: 'report', result: 'passed', report: 'Übungen erfolgreich abgeschlossen.' }, now);
  state = transition(state, 'guest', { type: 'confirm_participation' }, now);
  assert.equal(state.active?.stage, 'completed');
  assert.equal(currentSkillMatrix(state)[LIVE_PARTICIPANT].Wareneingang.level, 2);
  assert.equal(currentSkillMatrix(state)[PARTICIPANTS[1]].Wareneingang.level, 2);
  assert.equal(currentSkillMatrix(state)[LIVE_PARTICIPANT].Wareneingang.status, 'Im Demo abgeschlossen');
  assert.equal(state.active?.events.length, 6);
});

test('role and state guards prevent guest report and premature confirmation', () => {
  const state = transition(initialState(), 'host', { type: 'invite', topic: 'Wareneingang', participant: LIVE_PARTICIPANT, offers: [first], targetLevel: 1 }, now);
  assert.throws(() => transition(state, 'guest', { type: 'report', result: 'passed', report: 'Falscher Bericht.' }, now));
  assert.throws(() => transition(state, 'guest', { type: 'confirm_participation' }, now));
  assert.throws(() => transition(state, 'guest', { type: 'accept_offer', offer: second }, now));
});

test('failed training does not increase skill level', () => {
  let state = transition(initialState(), 'host', { type: 'invite', topic: 'Wareneingang', participant: LIVE_PARTICIPANT, offers: [first], targetLevel: 3 }, now);
  state = transition(state, 'guest', { type: 'accept_offer', offer: first }, now);
  state = transition(state, 'host', { type: 'start_early' }, now);
  state = transition(state, 'host', { type: 'report', result: 'failed', report: 'Nachschulung wird benötigt.' }, now);
  state = transition(state, 'guest', { type: 'confirm_participation' }, now);
  assert.equal(currentSkillMatrix(state)[LIVE_PARTICIPANT].Wareneingang.level, 1);
  assert.equal(currentSkillMatrix(state)[LIVE_PARTICIPANT].Wareneingang.status, 'Nachschulung nötig');
});

test('unassigned employees cannot receive the live participant link', () => {
  for (const participant of PARTICIPANTS.slice(1)) {
    assert.throws(() => transition(initialState(), 'host', { type: 'invite', topic: 'Wareneingang', participant, offers: [first], targetLevel: 2 }, now), /kein Demo-Konto/);
  }
});
