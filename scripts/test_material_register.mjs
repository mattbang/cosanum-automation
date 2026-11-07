import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { demoPublishedPath, demoSources, resolveDemoFile } from '../material-register/demo.mjs';
import {
  MATERIAL_EDITS_TAB, MATERIAL_FIELDS, projectMaterialCatalogue, findMaterialRevision, readPublishedRegister,
} from '../material-register/register.mjs';
import { previewImport, stageImport } from '../material-register/review.mjs';

const published = JSON.parse(readFileSync(demoPublishedPath, 'utf8'));
const { topicIds } = demoSources;
const proposed = (...rows) => ({ sheet: MATERIAL_EDITS_TAB, values: [MATERIAL_FIELDS, ...rows] });
const accepted = ['MAT-A', 'TC_R030', 'Leitfaden für Beispielprozess A', '03', 'guide', 'de', 'Demo Qualität', 'approved', '2026-11-08', 'demo:GUIDE-A-03'];
const resolve = ref => ref === accepted.at(-1) ? {} : resolveDemoFile(ref);
const get = (events, date, file = resolve) => projectMaterialCatalogue(events, date, file).find(row => row.materialId === 'MAT-A');
const preview = (edits, snapshot = published) => previewImport(edits, snapshot, topicIds, resolve);
const stage = (edits, id, snapshot = published) => stageImport(edits, snapshot, topicIds, resolve, {
  reviewId: id, reviewer: 'Demo reviewer', now: new Date('2026-11-07T10:00:00.000Z'),
});

test('reviewed append preserves the pinned reference and advances only on the effective date', () => {
  const edits = proposed(accepted);
  const review = preview(edits);
  assert.equal(review.errors.length, 0);
  assert.equal(review.rows[0].action, 'revision');
  assert.equal(review.rows[0].previous.revision, '02');
  const changed = proposed(accepted.map((value, i) => i === 2 ? 'Edited after review' : value));
  assert.throws(() => stage(changed, review.reviewId), /changed/);
  const batch = stage(edits, review.reviewId);
  assert.equal(batch.range, 'MaterialRegister_v1!A7:M7');
  assert.deepEqual(batch.snapshot.values.slice(0, -1), published.values);
  assert.deepEqual(batch.appended[0].slice(-3), [review.reviewId, 'Demo reviewer', '2026-11-07T10:00:00.000Z']);
  const prior = readPublishedRegister(published, topicIds).events;
  const { events, errors } = readPublishedRegister(batch.snapshot, topicIds);
  assert.deepEqual(errors, []);
  assert.deepEqual(findMaterialRevision(events, 'MAT-A', '01'), findMaterialRevision(prior, 'MAT-A', '01'));
  assert.equal(findMaterialRevision(events, 'MAT-A', '01').file_ref, 'demo:GUIDE-A-01');
  assert.equal(get(events, '2026-11-07').revision, '02');
  assert.equal(get(events, '2026-11-08').revision, '03');
  assert.throws(() => stage(edits, review.reviewId, batch.snapshot), /snapshot changed/);
  const repeat = preview(edits, batch.snapshot);
  assert.equal(repeat.rows[0].action, 'unchanged');
  assert.deepEqual(stage(edits, repeat.reviewId, batch.snapshot).appended, []);
});

test('a missing or withdrawn latest revision never falls back to a superseded file', () => {
  const added = proposed(accepted);
  const initial = stage(added, preview(added).reviewId).snapshot;
  const { events } = readPublishedRegister(initial, topicIds);
  assert.deepEqual([get(events, '2026-11-08', resolveDemoFile).revision, get(events, '2026-11-08', resolveDemoFile).state],
    ['03', 'unavailable']);
  const withdrawal = [...accepted];
  withdrawal[7] = 'withdrawn';
  withdrawal[8] = '2026-11-09';
  const edits = proposed(withdrawal);
  const review = preview(edits, initial);
  assert.equal(review.rows[0].action, 'withdrawal');
  const readback = readPublishedRegister(stage(edits, review.reviewId, initial).snapshot, topicIds).events;
  assert.equal(get(readback, '2026-11-08').state, 'approved');
  const row = get(readback, '2026-11-09', ref => {
    assert.notEqual(ref, accepted.at(-1), 'Withdrawn files must not be opened');
    return resolve(ref);
  });
  assert.deepEqual([row.revision, row.state, row.url], ['03', 'withdrawn', '']);
  assert.equal(findMaterialRevision(readback, 'MAT-A', '03').file_ref, accepted.at(-1));
});

test('ambiguous or malformed rows report exact cells and block the batch', () => {
  const bad = ['MAT-D', 'TC_UNKNOWN', 'Bad date and status', '02', 'unknown', 'no', '', 'pending', '2026-02-30', 'demo:GUIDE-D-01'];
  const unavailable = ['MAT-Z', 'TC_R077', 'Missing file', 'r1', '', '', '', 'approved', '2026-02-28', 'demo:ABSENT'];
  const edits = proposed(accepted, [], accepted, bad, unavailable);
  const review = preview(edits);
  assert.equal(review.reviewId, null);
  assert.deepEqual(review.errors.map(error => error.cell).sort(), ['A2', 'A4', 'B5', 'E5', 'F5', 'H5', 'I5', 'J6']);
  assert.ok(review.rows.every(row => row.action === 'quarantined'));
  assert.throws(() => stage(edits, null), /quarantined/);
  const overwrite = [...published.values.find(row => row[0] === 'MAT-A' && row[3] === '02').slice(0, MATERIAL_FIELDS.length)];
  overwrite[2] = 'Silent title replacement';
  assert.match(preview(proposed(overwrite)).errors[0].message, /immutable/);
  const reused = [...accepted];
  reused[9] = 'demo:GUIDE-A-01';
  assert.equal(preview(proposed(reused)).errors[0].cell, 'J2');
});

test('the app projection rejects the whole published source when its contract fails', () => {
  const duplicate = structuredClone(published);
  duplicate.values.push(duplicate.values[1]);
  const read = readPublishedRegister(duplicate, topicIds);
  assert.deepEqual(read.events, []);
  assert.deepEqual(read.errors.map(row => row.cell), ['D7']);
  assert.match(readPublishedRegister({ ...published, sheet: 'MaterialRegister_v2' }, topicIds).errors[0].message, /Expected MaterialRegister_v1/);
});
