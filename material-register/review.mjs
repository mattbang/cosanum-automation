import { createHash } from 'node:crypto';
import {
  MATERIAL_FIELDS, MATERIAL_MAX_ROWS, MATERIAL_PUBLISHED_FIELDS, MATERIAL_PUBLISHED_TAB,
  findMaterialRevision, registerIssue, readPublishedRegister, assessMaterialChange, parseRegisterRows,
} from './register.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function previewImport(proposal, published, topicIds, resolveFile) {
  const base = readPublishedRegister(published, topicIds);
  const input = parseRegisterRows(proposal, topicIds, false);
  const errors = [...base.errors.map(error => ({ source: MATERIAL_PUBLISHED_TAB, ...error })),
    ...input.errors.map(error => ({ source: proposal.sheet, ...error }))];
  const counts = new Map();
  for (const { record } of input.rows) {
    if (record.material_id) counts.set(record.material_id, (counts.get(record.material_id) || 0) + 1);
  }
  const rows = input.rows.map(({ number, record }) => {
    const reject = (field, message) => errors.push({ source: proposal.sheet, ...registerIssue(number, field, message) });
    if (counts.get(record.material_id) > 1) reject('material_id', 'A material ID can occur only once in a proposal.');
    const quarantined = () => errors.some(error => error.source === proposal.sheet && error.row === number);
    let action = 'quarantined';
    if (!quarantined() && !base.errors.length) {
      const change = assessMaterialChange(base.events, record);
      if (change.field) reject(change.field, change.message);
      else if (['addition', 'revision'].includes(change.action) && !resolveFile(record.file_ref)) {
        reject('file_ref', 'The revision file is unavailable in the source inventory.');
      } else {
        action = change.action;
      }
    }
    const previous = action === 'withdrawal' ? findMaterialRevision(base.events, record.material_id, record.revision)
      : action === 'revision' ? base.events.findLast(event => event.material_id === record.material_id && event.status === 'approved') : null;
    return { row: number, action, material: record, ...(previous ? { previous } : {}) };
  });
  const additions = rows.filter(row => ['addition', 'revision', 'withdrawal'].includes(row.action)).length;
  if (Array.isArray(published.values) && published.values.length + additions > MATERIAL_MAX_ROWS) {
    errors.push({ source: MATERIAL_PUBLISHED_TAB, ...registerIssue(0, 'sheet', 'This batch exceeds the published row limit.') });
  }
  const baseVersion = digest(published.values ?? null);
  const reviewId = errors.length ? null : digest([MATERIAL_PUBLISHED_TAB, baseVersion, rows]);
  return { baseVersion, reviewId, rows, errors };
}

export function stageImport(proposal, published, topicIds, resolveFile, { reviewId, reviewer, now = new Date() }) {
  const review = previewImport(proposal, published, topicIds, resolveFile);
  if (review.errors.length) throw new Error('Fix the quarantined rows before staging a publication.');
  if (!reviewId || review.reviewId !== reviewId) throw new Error('The reviewed values or published snapshot changed. Preview it again.');
  const identity = typeof reviewer === 'string' ? reviewer.trim() : '';
  if (!identity || identity.length > 160 || /^=|[\u0000-\u001f\u007f]/.test(identity)) throw new Error('Enter a reviewer name as plain text.');
  const appended = review.rows.filter(row => ['addition', 'revision', 'withdrawal'].includes(row.action))
    .map(({ material }) => MATERIAL_FIELDS.map(field => material[field]).concat([reviewId, identity, now.toISOString()]));
  const snapshot = { sheet: MATERIAL_PUBLISHED_TAB, values: [...published.values, ...appended] };
  if (readPublishedRegister(snapshot, topicIds).errors.length) throw new Error('The staged publication exceeds or violates the published schema.');
  return {
    baseVersion: review.baseVersion, batchId: reviewId,
    range: appended.length ? `${MATERIAL_PUBLISHED_TAB}!A${published.values.length + 1}:${String.fromCharCode(64 + MATERIAL_PUBLISHED_FIELDS.length)}${snapshot.values.length}` : null,
    appended, snapshot,
  };
}
