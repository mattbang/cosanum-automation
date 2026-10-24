/** Increment 11: apply one verified person-case transition to the synthetic matrix. */
function skillUpdateKey_(proof) {
  return 'SKILL-' + String(proof.proof_id) + '-v' + String(proof.proof_version);
}

function skillArchiveGate_(tables, caseId) {
  var personCase = proofUnique_(tables.ParticipantCases, function (row) {
    return row.case_id === caseId && row.demo_marker === '[DEMO]';
  }, 'Demo-Personenfall');
  var request = proofUnique_(tables.Requests, function (row) {
    return row.request_id === personCase.request_id && row.demo_marker === '[DEMO]';
  }, 'Demo-Auftrag');
  var proof = proofUnique_(tables.Proofs, function (row) {
    return row.case_id === caseId && row.demo_marker === '[DEMO]';
  }, 'Personennachweis');
  if (proof.status !== 'archived_verified' || !proof.doc_id || !proof.pdf_id ||
      proof.request_id !== request.request_id || proof.person_key !== personCase.person_key ||
      proof.topic_id !== request.topic_id || proof.proof_id !== 'PRF-' + caseId.slice(5) ||
      Number(proof.proof_version) !== PROOF_VERSION || !/^[a-f0-9]{64}$/.test(String(proof.source_hash))) {
    throw new Error('Nachweis und beide Archive sind nicht eindeutig geprüft.');
  }
  var receipt = proofUnique_(tables.ArchiveReceipts, function (row) {
    return row.proof_id === proof.proof_id && Number(row.proof_version) === Number(proof.proof_version);
  }, 'Geprüfter Archivbeleg');
  if (receipt.status !== 'verified' || receipt.demo_marker !== '[DEMO]' ||
      receipt.case_id !== caseId || receipt.request_id !== request.request_id ||
      receipt.person_key !== personCase.person_key || receipt.topic_id !== request.topic_id ||
      receipt.source_hash !== proof.source_hash || receipt.doc_id !== proof.doc_id ||
      receipt.pdf_id !== proof.pdf_id || !/^[a-f0-9]{64}$/.test(String(receipt.drive_pdf_sha256)) ||
      receipt.drive_pdf_sha256 !== receipt.local_pdf_sha256 ||
      !/^[a-f0-9]{64}$/.test(String(receipt.local_docx_sha256)) ||
      !receipt.local_pdf_path || !receipt.local_docx_path || !receipt.manifest_path) {
    throw new Error('Archivbeleg und Nachweis stimmen nicht überein.');
  }
  // Completion and skill writes use a read-only exact Drive lookup. The archive
  // helper separately checks the downloaded/local bytes against this checksum.
  var proofRow = DEMO_SCHEMA.sheets.Proofs.map(function (key) { return proof[key]; });
  proofMetadataLookup_(proofRow, receipt.drive_pdf_sha256);
  proofIso_(receipt.verified_at, 'Archivprüfung');
  if (Date.parse(proofIso_(receipt.verified_at, 'Archivprüfung')) < Date.parse(proofIso_(proof.created_at, 'Nachweis'))) {
    throw new Error('Archivprüfung liegt vor der Nachweiserstellung.');
  }
  return { personCase: personCase, request: request, proof: proof, receipt: receipt };
}

function skillUpdateExisting_(tables, gate) {
  var key = skillUpdateKey_(gate.proof);
  var rows = tables.SkillUpdates.filter(function (row) {
    return row.case_id === gate.personCase.case_id || row.idempotency_key === key;
  });
  if (rows.length > 1) throw new Error('Doppelte Skillübernahme im Fallregister.');
  if (!rows.length) return null;
  var row = rows[0];
  if (row.idempotency_key !== key || row.demo_marker !== '[DEMO]' ||
      row.case_id !== gate.personCase.case_id || row.request_id !== gate.request.request_id ||
      row.person_key !== gate.personCase.person_key || row.topic_id !== gate.request.topic_id ||
      String(row.previous_level) !== String(gate.personCase.current_level) ||
      String(row.target_level) !== String(gate.personCase.target_level) ||
      row.proof_id !== gate.proof.proof_id || Number(row.proof_version) !== Number(gate.proof.proof_version) ||
      row.source_hash !== gate.proof.source_hash ||
      proofIso_(row.archive_verified_at, 'Archivzeit') !== proofIso_(gate.receipt.verified_at, 'Archivzeit') ||
      ['pending', 'applied', 'conflict'].indexOf(row.status) < 0) {
    throw new Error('Vorhandene Skillübernahme widerspricht dem Personenfall.');
  }
  if (row.status === 'applied') proofIso_(row.applied_at, 'Skillübernahme');
  return row;
}

function skillMatrixRow_(spreadsheet, personKey, topicId) {
  var sheet = spreadsheet.getSheetByName('Skills');
  if (!sheet) throw new Error('Demo-Skillmatrix fehlt.');
  var values = sheet.getDataRange().getValues();
  assertHeaders_(values[0], DEMO_SCHEMA.sheets.Skills, 'Skills');
  var found = values.slice(1).map(function (row, i) { return { row: row, number: i + 2 }; }).filter(function (item) {
    return item.row[0] === personKey && item.row[1] === topicId;
  });
  if (found.length !== 1 || found[0].row[4] !== '[DEMO]') throw new Error('Demo-Matrixeintrag fehlt oder ist nicht eindeutig.');
  return { sheet: sheet, number: found[0].number, level: found[0].row[2] };
}

function skillUpdateResult_(gate, row, reused, currentLevel) {
  return { caseId: gate.personCase.case_id, idempotencyKey: skillUpdateKey_(gate.proof),
    proofId: gate.proof.proof_id, previousLevel: Number(gate.personCase.current_level),
    targetLevel: Number(gate.personCase.target_level), currentLevel: Number(currentLevel),
    appliedAt: String(row.applied_at), status: String(row.status), reused: reused };
}

function applyVerifiedSkillUpdate(input) {
  if (!input || typeof input.caseId !== 'string' || !/^CASE-[A-Z0-9-]+$/.test(input.caseId)) {
    throw new Error('Ungültige Demo-Fall-ID.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var owner = proofUnique_(tables.People, function (row) {
      return row.person_key === 'MATT' && row.demo_marker === '[DEMO]';
    }, 'Demo-Administration');
    if (proofEmail_(Session.getEffectiveUser().getEmail()) !== proofEmail_(owner.email)) {
      throw new Error('Nur Process & Quality darf die automatische Skillübernahme starten.');
    }
    var gate = skillArchiveGate_(tables, input.caseId);
    var oldLevel = Number(gate.personCase.current_level), targetLevel = Number(gate.personCase.target_level);
    if (!Number.isInteger(oldLevel) || oldLevel < 0 || oldLevel > 2 ||
        !Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 3) {
      throw new Error('Stufe 4 wird nicht automatisch vergeben; Zielstufe prüfen.');
    }
    var existing = skillUpdateExisting_(tables, gate);
    var spreadsheet = findDemoSpreadsheet_();
    var matrix = skillMatrixRow_(spreadsheet, gate.personCase.person_key, gate.request.topic_id);
    if (existing && existing.status === 'applied') {
      // A later, separate training may already have raised the current level again.
      if (!Number.isInteger(Number(matrix.level)) || Number(matrix.level) < targetLevel) {
        throw new Error('Skillkonflikt: Matrixstand liegt unter der bereits übernommenen Zielstufe.');
      }
      return skillUpdateResult_(gate, existing, true, matrix.level);
    }
    // Before the first write, recheck every original Form/Calendar response and its immutable source hash.
    if (!existing || existing.status === 'conflict' || String(matrix.level) === String(oldLevel)) {
      var model = proofSourceModel_(tables, input.caseId);
      if (model.proofId !== gate.proof.proof_id || proofHash_(model) !== gate.proof.source_hash ||
          String(model.previousLevel) !== String(oldLevel) || String(model.targetLevel) !== String(targetLevel)) {
        throw new Error('Trainerbericht, Teilnahmebestätigung oder Nachweisquelle hat sich geändert.');
      }
    }
    if (String(matrix.level) !== String(oldLevel) && !(existing && existing.status === 'pending' && String(matrix.level) === String(targetLevel))) {
      if (existing) {
        var conflictSheet = spreadsheet.getSheetByName('SkillUpdates');
        var conflictRows = conflictSheet.getDataRange().getValues();
        var conflictIndex = conflictRows.findIndex(function (row) { return row[0] === existing.idempotency_key; });
        if (conflictIndex < 1) throw new Error('Skillübernahmezeile fehlt.');
        conflictSheet.getRange(conflictIndex + 1, 13, 1, 2).setValues([['conflict', 'Matrixstand ' + String(matrix.level) + ' weicht von Ausgangsstufe ' + oldLevel + ' ab.']]);
        SpreadsheetApp.flush();
      }
      throw new Error('Skillkonflikt: Matrixstand wurde seit der Fallanlage geändert. Bitte im Demo-Sheet prüfen.');
    }
    var ledger = spreadsheet.getSheetByName('SkillUpdates');
    if (!ledger) throw new Error('Skillübernahme-Register fehlt. setupDemo() ausführen.');
    var key = skillUpdateKey_(gate.proof);
    if (!existing) {
      ledger.appendRow([key, input.caseId, gate.request.request_id, gate.personCase.person_key,
        gate.request.topic_id, oldLevel, targetLevel, gate.proof.proof_id, Number(gate.proof.proof_version),
        gate.proof.source_hash, proofIso_(gate.receipt.verified_at, 'Archivprüfung'), '', 'pending', '', '[DEMO]']);
      SpreadsheetApp.flush();
    }
    var rows = ledger.getDataRange().getValues();
    var index = rows.findIndex(function (row) { return row[0] === key; });
    if (index < 1) throw new Error('Skillübernahme-Registerzeile fehlt.');
    // A manual Sheet edit is outside the script lock, so check the live cell once more immediately before writing.
    var liveLevel = matrix.sheet.getRange(matrix.number, 3).getValue();
    if (String(liveLevel) === String(oldLevel)) {
      matrix.sheet.getRange(matrix.number, 3).setValue(targetLevel);
      SpreadsheetApp.flush();
    } else if (!(existing && existing.status === 'pending' && String(liveLevel) === String(targetLevel))) {
      ledger.getRange(index + 1, 13, 1, 2).setValues([['conflict', 'Matrixstand ' + String(liveLevel) + ' vor Übernahme geändert.']]);
      SpreadsheetApp.flush();
      throw new Error('Skillkonflikt: Matrixstand wurde vor der Übernahme geändert.');
    }
    var appliedAt = new Date().toISOString();
    ledger.getRange(index + 1, 12, 1, 3).setValues([[appliedAt, 'applied', '']]);
    SpreadsheetApp.flush();
    return skillUpdateResult_(gate, { applied_at: appliedAt, status: 'applied' }, false, targetLevel);
  } finally { lock.releaseLock(); }
}

function getSkillUpdateQueue() {
  var tables = readDemoTables_();
  return tables.ParticipantCases.filter(function (row) { return row.demo_marker === '[DEMO]'; }).map(function (personCase) {
    var item = { caseId: personCase.case_id, personKey: personCase.person_key,
      requestId: personCase.request_id, previousLevel: personCase.current_level,
      targetLevel: personCase.target_level, state: 'waiting', reason: '', proofId: '', appliedAt: '' };
    try {
      var gate = skillArchiveGate_(tables, personCase.case_id);
      item.proofId = gate.proof.proof_id;
      var existing = skillUpdateExisting_(tables, gate);
      if (existing && existing.status === 'applied') {
        var current = proofUnique_(tables.Skills, function (row) {
          return row.person_key === personCase.person_key && row.topic_id === gate.request.topic_id && row.demo_marker === '[DEMO]';
        }, 'Demo-Matrixeintrag');
        if (!Number.isInteger(Number(current.skill_level)) || Number(current.skill_level) < Number(personCase.target_level)) {
          throw new Error('Matrixstand liegt unter der bereits übernommenen Zielstufe.');
        }
        item.state = 'applied'; item.appliedAt = String(existing.applied_at);
      } else if (existing && existing.status === 'pending') {
        item.state = 'pending'; item.reason = 'Unterbrochene Übernahme erneut ausführen.';
      } else {
        proofSourceModel_(tables, personCase.case_id);
        item.state = 'ready';
      }
    } catch (error) {
      item.state = tables.Proofs.some(function (row) { return row.case_id === personCase.case_id && row.status === 'archived_verified'; }) ? 'conflict' : 'waiting';
      item.reason = String(error.message || error);
    }
    return item;
  });
}

/** Reconcile archived cases on admin refresh or a daily trigger. Errors stay visible per case. */
function processVerifiedSkillUpdates() {
  var candidates = getSkillUpdateQueue().filter(function (row) {
    return row.state === 'ready' || row.state === 'pending';
  });
  var applied = [], errors = [];
  candidates.forEach(function (row) {
    try { applied.push(applyVerifiedSkillUpdate({ caseId: row.caseId })); }
    catch (error) { errors.push({ caseId: row.caseId, reason: String(error.message || error) }); }
  });
  return { applied: applied, errors: errors, rows: getSkillUpdateQueue() };
}

function installSkillDailyProcessor() {
  var matches = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'processVerifiedSkillUpdates';
  });
  if (matches.length > 1) throw new Error('Mehrere tägliche Skill-Trigger gefunden.');
  if (matches.length === 1) return { installed: true, reused: true };
  ScriptApp.newTrigger('processVerifiedSkillUpdates').timeBased().atHour(9).everyDays(1).inTimezone(SLOT_TIME_ZONE).create();
  return { installed: true, reused: false };
}
