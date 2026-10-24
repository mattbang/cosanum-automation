import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({Object, Array, Number, String});
vm.runInContext(fs.readFileSync('apps-script/ProofMetadata.gs', 'utf8'), ctx);
ctx.PROOF_VERSION = 1;
ctx.MimeType = {GOOGLE_DOCS: 'application/vnd.google-apps.document', PDF: 'application/pdf'};
const keys = ['proof_id', 'proof_version', 'request_id', 'case_id', 'person_key', 'topic_id',
  'source_hash', 'created_at', 'folder_id', 'doc_id', 'pdf_id', 'status', 'demo_marker'];
const row = ['PRF-DEMO', 1, 'REQ-DEMO', 'CASE-DEMO', 'PERSON', 'TOPIC', 'a'.repeat(64),
  '2026-10-24T09:00:00Z', 'folder', 'doc', 'pdf', 'archived_verified', '[DEMO]'];
const base = 'PRF-DEMO-v1 [DEMO]';
const files = new Map([
  ['doc', {id: 'doc', name: base, mimeType: ctx.MimeType.GOOGLE_DOCS, parents: ['folder'], properties: {other: 'preserved'}}],
  ['pdf', {id: 'pdf', name: base + '.pdf', mimeType: ctx.MimeType.PDF, parents: ['folder'], properties: {}}],
]);
let updates = 0;
ctx.Drive = {Files: {
  get: id => structuredClone(files.get(id)),
  update: (body, id) => {
    updates++;
    const file = files.get(id);
    file.properties = {...file.properties, ...body.properties};
    return structuredClone(file);
  },
  list: ({q}) => {
    assert.match(q, /properties has/);
    return {files: [...files.values()].filter(file =>
      file.properties.cosanum_proof_id === 'PRF-DEMO').map(file => structuredClone(file))};
  },
}};
ctx.proofUnique_ = (rows, predicate) => {
  const found = rows.filter(predicate);
  if (found.length !== 1) throw Error('not unique');
  return found[0];
};
ctx.proofEmail_ = value => String(value).toLowerCase();
ctx.readDemoTables_ = () => ({People: [{person_key: 'MATT', email: 'owner@example.test', demo_marker: '[DEMO]'}],
  Proofs: [Object.fromEntries(keys.map((key, i) => [key, row[i]]))]});
ctx.Session = {getEffectiveUser: () => ({getEmail: () => 'owner@example.test'})};
ctx.DEMO_SCHEMA = {sheets: {Proofs: keys}};
ctx.LockService = {getScriptLock: () => ({waitLock: () => {}, releaseLock: () => {}})};

let result = ctx.backfillProofMetadata({caseId: 'CASE-DEMO'});
assert.equal(result.count, 2);
assert.equal(updates, 2);
assert.equal(files.get('doc').properties.other, 'preserved');
result = ctx.backfillProofMetadata({caseId: 'CASE-DEMO'});
assert.equal(result.docId, 'doc');
assert.equal(result.pdfId, 'pdf');
assert.equal(updates, 2, 'retry leaves existing files untouched');
files.set('duplicate', {...structuredClone(files.get('doc')), id: 'duplicate'});
assert.throws(() => ctx.proofMetadataEnsurePair_(row), /Doppelte|genau zwei/);
files.delete('duplicate');
files.get('doc').properties.cosanum_case_id = 'CASE-OTHER';
assert.throws(() => ctx.proofMetadataEnsurePair_(row), /widersprechen/);
assert.equal(updates, 2, 'conflict cannot overwrite metadata');
files.get('doc').properties.cosanum_case_id = 'CASE-DEMO';
files.get('pdf').sha256Checksum = 'a'.repeat(64);
assert.equal(ctx.proofMetadataLookup_(row, 'a'.repeat(64)).pdfSha256, 'a'.repeat(64));
assert.throws(() => ctx.proofMetadataLookup_(row, 'b'.repeat(64)), /Prüfsumme/);
delete files.get('pdf').sha256Checksum;
assert.throws(() => ctx.proofMetadataLookup_(row, 'a'.repeat(64)), /Prüfsumme/);
console.log('Pass: existing proof backfill, exact lookup, retry, duplicate, and conflict gates.');
