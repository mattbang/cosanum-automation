/** Increment 15: searchable, public Drive properties on the existing proof pair. */
var PROOF_METADATA_KEYS = ['cosanum_request_id', 'cosanum_case_id', 'cosanum_proof_id',
  'cosanum_proof_version', 'cosanum_demo_marker'];

function proofMetadataExpected_(row) {
  if (row[12] !== '[DEMO]' || row[0] !== 'PRF-' + String(row[3]).slice(5) ||
      !/^CASE-[A-Z0-9-]+$/.test(String(row[3])) || !row[2] || !row[8] || !row[9] || !row[10] ||
      Number(row[1]) !== PROOF_VERSION) throw new Error('Nachweisregister ist für Drive-Metadaten unvollständig.');
  return { cosanum_request_id: String(row[2]), cosanum_case_id: String(row[3]),
    cosanum_proof_id: String(row[0]), cosanum_proof_version: String(row[1]),
    cosanum_demo_marker: '[DEMO]' };
}

function proofMetadataQueryValue_(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function proofMetadataMatches_(expected) {
  var q = "trashed = false and properties has { key='cosanum_proof_id' and value='" +
    proofMetadataQueryValue_(expected.cosanum_proof_id) + "' }";
  var files = [], page = '';
  do {
    var result = Drive.Files.list({ q: q, fields: 'nextPageToken,files(id,name,mimeType,parents,properties,trashed,sha256Checksum)',
      pageSize: 1000, pageToken: page });
    files = files.concat(result.files || []);
    page = result.nextPageToken || '';
  } while (page);
  return files;
}

function proofMetadataAssertFile_(file, id, folderId, name, mime, expected, allowMissing) {
  if (!file || file.id !== id || file.trashed || file.name !== name || file.mimeType !== mime ||
      !file.parents || file.parents.length !== 1 || file.parents[0] !== folderId) {
    throw new Error('Drive-Nachweisdatei weicht vom Register oder Archivordner ab.');
  }
  var props = file.properties || {};
  PROOF_METADATA_KEYS.forEach(function (key) {
    if (props[key] !== undefined && props[key] !== expected[key]) {
      throw new Error('Drive-Nachweismetadaten widersprechen dem Register: ' + key);
    }
    if (!allowMissing && props[key] !== expected[key]) {
      throw new Error('Drive-Nachweismetadaten fehlen: ' + key);
    }
  });
}

function proofMetadataEnsureOne_(id, folderId, name, mime, expected) {
  var fields = 'id,name,mimeType,parents,properties,trashed';
  var file = Drive.Files.get(id, { fields: fields });
  proofMetadataAssertFile_(file, id, folderId, name, mime, expected, true);
  if (PROOF_METADATA_KEYS.some(function (key) { return !file.properties || file.properties[key] !== expected[key]; })) {
    // PATCH preserves unrelated public properties and the file content.
    Drive.Files.update({ properties: expected }, id, null, { fields: fields });
    file = Drive.Files.get(id, { fields: fields });
  }
  proofMetadataAssertFile_(file, id, folderId, name, mime, expected, false);
  return file;
}

function proofMetadataLookup_(row, expectedSha) {
  var expected = proofMetadataExpected_(row);
  var basename = expected.cosanum_proof_id + '-v' + expected.cosanum_proof_version + ' [DEMO]';
  var matches = proofMetadataMatches_(expected);
  if (matches.length !== 2) throw new Error('Drive-Suche fand nicht genau zwei Nachweisdateien.');
  matches.forEach(function (file) {
    var isDoc = file.id === row[9], isPdf = file.id === row[10];
    if (!isDoc && !isPdf) throw new Error('Doppelte oder fremde Drive-Nachweismetadaten.');
    proofMetadataAssertFile_(file, file.id, row[8], isDoc ? basename : basename + '.pdf',
      isDoc ? MimeType.GOOGLE_DOCS : MimeType.PDF, expected, false);
  });
  if (expectedSha) {
    var pdf = matches.filter(function (file) { return file.id === row[10]; })[0];
    if (!/^[a-f0-9]{64}$/.test(String(pdf.sha256Checksum || '')) || pdf.sha256Checksum !== expectedSha) {
      throw new Error('Gespeicherte Drive-PDF-Prüfsumme fehlt oder weicht vom Archivbeleg ab.');
    }
  }
  return { proofId: row[0], docId: row[9], pdfId: row[10], count: matches.length,
    pdfSha256: matches.filter(function (file) { return file.id === row[10]; })[0].sha256Checksum || '' };
}

function proofMetadataEnsurePair_(row) {
  var expected = proofMetadataExpected_(row);
  var before = proofMetadataMatches_(expected);
  if (before.length > 2 || before.some(function (file) { return file.id !== row[9] && file.id !== row[10]; })) {
    throw new Error('Doppelte oder fremde Drive-Nachweismetadaten.');
  }
  var basename = expected.cosanum_proof_id + '-v' + expected.cosanum_proof_version + ' [DEMO]';
  proofMetadataEnsureOne_(row[9], row[8], basename, MimeType.GOOGLE_DOCS, expected);
  proofMetadataEnsureOne_(row[10], row[8], basename + '.pdf', MimeType.PDF, expected);
  return proofMetadataLookup_(row);
}

/** Backfill an existing proof without recreating either asset or changing its version. */
function backfillProofMetadata(input) {
  if (!input || !/^CASE-[A-Z0-9-]+$/.test(String(input.caseId || ''))) throw new Error('Demo-Fall-ID fehlt.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var owner = proofUnique_(tables.People, function (person) {
      return person.person_key === 'MATT' && person.demo_marker === '[DEMO]';
    }, 'Demo-Administration');
    if (proofEmail_(Session.getEffectiveUser().getEmail()) !== proofEmail_(owner.email)) {
      throw new Error('Nur Process & Quality darf Nachweismetadaten ergänzen.');
    }
    var proof = proofUnique_(tables.Proofs, function (row) {
      return row.case_id === input.caseId && row.demo_marker === '[DEMO]';
    }, 'Personennachweis');
    var row = DEMO_SCHEMA.sheets.Proofs.map(function (key) { return proof[key]; });
    return proofMetadataEnsurePair_(row);
  } finally { lock.releaseLock(); }
}
