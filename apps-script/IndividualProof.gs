/** Increment 09: immutable first-version proof per demo participant case. */
var PROOF_VERSION = 1;
var PROOF_ARCHIVE_FOLDER = 'evidence-archive';

function proofUnique_(rows, predicate, label) {
  var found = rows.filter(predicate);
  if (found.length !== 1) throw new Error(label + ' fehlt oder ist nicht eindeutig.');
  return found[0];
}

function proofIso_(value, label) {
  var time = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  if (!Number.isFinite(time)) throw new Error(label + ': ungültiger Zeitstempel.');
  return new Date(time).toISOString();
}

function proofEmail_(email) { return String(email || '').trim().toLowerCase(); }

function proofResponse_(formId, responseId) {
  if (!formId || !responseId) throw new Error('Formular- oder Antwort-ID fehlt.');
  return proofUnique_(FormApp.openById(formId).getResponses(), function (response) {
    return response.getId() === responseId;
  }, 'Originalantwort');
}

function proofPhase_(tables, context) {
  var s = context.session, c = context.personCase;
  var event = verifyTrainerCalendar_(context, calendarBookingGet_);
  if (!s.calendar_event_url || !event.htmlLink || s.calendar_event_url !== event.htmlLink) {
    throw new Error('Kalenderlink im Sheet stimmt nicht mit dem Originaltermin überein.');
  }
  var trainerForm = proofUnique_(tables.TrainerForms, function (row) {
    return row.session_id === s.session_id && row.case_id === c.case_id;
  }, 'Trainerformular');
  var trainer = proofUnique_(tables.TrainerAssessments, function (row) {
    return row.session_id === s.session_id && row.case_id === c.case_id && row.disposition === 'accepted';
  }, 'Gültiger Trainerbericht');
  if (trainerForm.demo_marker !== '[DEMO]' || trainer.demo_marker !== '[DEMO]' ||
      trainerForm.person_key !== c.person_key || trainerForm.trainer_key !== context.trainer.person_key ||
      proofEmail_(trainerForm.trainer_email) !== proofEmail_(context.trainer.email) ||
      trainer.form_id !== trainerForm.form_id || trainer.person_key !== c.person_key ||
      proofEmail_(trainer.reporter_email) !== proofEmail_(context.trainer.email) ||
      trainer.attendance !== 'attended' || trainer.assessment !== 'passed' || trainer.attestation !== 'yes' ||
      proofEmail_(trainerForm.verified_by) !== proofEmail_(context.owner.email) || !trainerForm.verified_at) {
    throw new Error('Trainerzuordnung oder bestandene Beurteilung ist widersprüchlich.');
  }
  var trainerAt = proofIso_(trainer.submitted_at, 'Trainerantwort');
  if (Date.parse(trainerAt) < Date.parse(proofIso_(s.end_utc, 'Terminende')) ||
      Date.parse(trainerAt) < Date.parse(proofIso_(trainerForm.verified_at, 'Trainerformularprüfung'))) {
    throw new Error('Trainerantwort liegt vor Terminende oder Formularprüfung.');
  }
  var trainerRaw = proofResponse_(trainerForm.form_id, trainer.response_id);
  var trainerAnswers = trainerAnswers_(trainerRaw);
  if (proofIso_(trainerRaw.getTimestamp(), 'Original-Trainerantwort') !== trainerAt ||
      proofEmail_(trainerRaw.getRespondentEmail()) !== proofEmail_(trainer.reporter_email) ||
      trainerAnswers.attendance !== 'attended' || trainerAnswers.assessment !== 'passed' ||
      !trainerAnswers.attestation || trainerAnswers.note !== String(trainer.note || '')) {
    throw new Error('Trainerbericht weicht von der Originalantwort ab.');
  }
  var participantForm = proofUnique_(tables.ParticipantForms, function (row) {
    return row.session_id === s.session_id && row.case_id === c.case_id;
  }, 'Teilnahmeformular');
  var acknowledgement = proofUnique_(tables.ParticipantAcknowledgements, function (row) {
    return row.session_id === s.session_id && row.case_id === c.case_id && row.disposition === 'accepted';
  }, 'Gültige persönliche Bestätigung');
  if (participantForm.demo_marker !== '[DEMO]' || acknowledgement.demo_marker !== '[DEMO]' ||
      participantForm.request_id !== c.request_id || participantForm.person_key !== c.person_key ||
      proofEmail_(participantForm.participant_email) !== proofEmail_(context.person.email) ||
      acknowledgement.form_id !== participantForm.form_id ||
      acknowledgement.request_id !== c.request_id || acknowledgement.person_key !== c.person_key ||
      proofEmail_(acknowledgement.respondent_email) !== proofEmail_(context.person.email) ||
      acknowledgement.affirmative !== 'yes' || !String(acknowledgement.typed_name || '').trim() ||
      proofEmail_(participantForm.verified_by) !== proofEmail_(context.owner.email) || !participantForm.verified_at) {
    throw new Error('Teilnahmebestätigung oder Kontozuordnung ist widersprüchlich.');
  }
  var acknowledgementAt = proofIso_(acknowledgement.submitted_at, 'Teilnahmeantwort');
  if (Date.parse(acknowledgementAt) < Date.parse(trainerAt) ||
      Date.parse(acknowledgementAt) < Date.parse(proofIso_(participantForm.verified_at, 'Teilnahmeformularprüfung'))) {
    throw new Error('Persönliche Bestätigung liegt vor Trainerfreigabe oder Formularprüfung.');
  }
  var participantRaw = proofResponse_(participantForm.form_id, acknowledgement.response_id);
  var participantAnswers = participantAnswers_(participantRaw);
  if (proofIso_(participantRaw.getTimestamp(), 'Original-Teilnahmeantwort') !== acknowledgementAt ||
      proofEmail_(participantRaw.getRespondentEmail()) !== proofEmail_(acknowledgement.respondent_email) ||
      !participantAnswers.affirmative || participantAnswers.typedName !== String(acknowledgement.typed_name).trim()) {
    throw new Error('Teilnahmebestätigung weicht von der Originalantwort ab.');
  }
  return {
    phase: s.phase, sessionId: s.session_id, startUtc: proofIso_(s.start_utc, 'Terminbeginn'),
    endUtc: proofIso_(s.end_utc, 'Terminende'), eventId: s.calendar_event_id,
    eventUrl: s.calendar_event_url, location: String(event.location || 'Nicht angegeben'),
    trainerAlias: String(context.trainer.display_alias), trainerEmail: proofEmail_(context.trainer.email),
    trainerResponseId: trainer.response_id, trainerSubmittedAt: trainerAt,
    trainerFormAdminUrl: 'https://docs.google.com/forms/d/' + encodeURIComponent(trainerForm.form_id) + '/edit#responses',
    acknowledgementResponseId: acknowledgement.response_id, acknowledgementSubmittedAt: acknowledgementAt,
    acknowledgementFormAdminUrl: 'https://docs.google.com/forms/d/' + encodeURIComponent(participantForm.form_id) + '/edit#responses',
    verifiedAccount: proofEmail_(acknowledgement.respondent_email), typedName: String(acknowledgement.typed_name).trim()
  };
}

/** This performs all gates before any Drive or Sheet write. */
function proofSourceModel_(tables, caseId) {
  if (!/^CASE-[A-Z0-9-]+$/.test(caseId)) throw new Error('Ungültige Demo-Fall-ID.');
  var personCase = proofUnique_(tables.ParticipantCases, function (row) {
    return row.case_id === caseId && row.demo_marker === '[DEMO]';
  }, 'Demo-Personenfall');
  var request = proofUnique_(tables.Requests, function (row) {
    return row.request_id === personCase.request_id && row.demo_marker === '[DEMO]';
  }, 'Demo-Auftrag');
  var topic = proofUnique_(tables.Topics, function (row) {
    return row.topic_id === request.topic_id && row.demo_marker === '[DEMO]';
  }, 'Demo-Thema');
  var person = proofUnique_(tables.People, function (row) {
    return row.person_key === personCase.person_key && row.demo_marker === '[DEMO]';
  }, 'Testperson');
  var skill = proofUnique_(tables.Skills, function (row) {
    return row.person_key === personCase.person_key && row.topic_id === topic.topic_id && row.demo_marker === '[DEMO]';
  }, 'Skill-Matrixeintrag');
  if (String(skill.skill_level) !== String(personCase.current_level) ||
      String(request.target_level) !== String(personCase.target_level) ||
      !eligibility_(topic, skill.skill_level, Number(request.target_level)).allowed ||
      Number(personCase.target_level) > 3) {
    throw new Error('Skillstand oder Zielstufe weicht vom geprüften Personenfall ab.');
  }
  var expected = ['theory'];
  if (demoFlag_(topic.practice_required)) expected.push('practice');
  if (!demoFlag_(topic.theory_required)) throw new Error('Theorie ist im Demo-Katalog erforderlich.');
  var links = tables.SessionCases.filter(function (row) { return row.case_id === caseId; });
  if (links.length !== expected.length || links.some(function (row) {
    return row.request_id !== request.request_id || row.person_key !== personCase.person_key || row.demo_marker !== '[DEMO]';
  })) throw new Error('Erforderliche Schulungsteile fehlen oder sind doppelt.');
  var phases = expected.map(function (phase) {
    var link = proofUnique_(links, function (row) {
      var sessions = tables.Sessions.filter(function (session) { return session.session_id === row.session_id; });
      return sessions.length === 1 && sessions[0].phase === phase;
    }, phase === 'theory' ? 'Theoriezuordnung' : 'Praxiszuordnung');
    var context = trainerCaseContext_(tables, link.session_id, caseId);
    if (context.session.request_id !== request.request_id || context.topic.topic_id !== topic.topic_id ||
        context.person.person_key !== person.person_key || context.session.phase !== phase ||
        (phase === 'theory' && context.session.theory_session_id) ||
        (phase === 'practice' && context.session.theory_session_id !== links.filter(function (row) {
          return tables.Sessions.some(function (session) { return session.session_id === row.session_id && session.phase === 'theory'; });
        })[0].session_id)) throw new Error('Schulungsteil und Fall widersprechen sich.');
    return proofPhase_(tables, context);
  });
  if (phases.length === 2 && Date.parse(phases[1].startUtc) < Date.parse(phases[0].endUtc)) {
    throw new Error('Praxis beginnt vor dem Ende der Theorie.');
  }
  return {
    proofId: 'PRF-' + caseId.slice(5), proofVersion: PROOF_VERSION,
    requestId: request.request_id, caseId: caseId, personKey: person.person_key,
    personAlias: String(person.display_alias), personaId: String(person.persona_id),
    verifiedAccount: proofEmail_(person.email), topicId: topic.topic_id,
    topicName: String(topic.display_name), materialName: String(topic.source_material || 'Nicht dokumentiert'),
    materialVersion: 'Nicht dokumentiert', previousLevel: String(personCase.current_level),
    targetLevel: String(personCase.target_level), phases: phases
  };
}

function proofHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function proofLocalTime_(iso) {
  return Utilities.formatDate(new Date(iso), SLOT_TIME_ZONE, 'dd.MM.yyyy HH:mm') + ' Europe/Zurich';
}

function proofText_(model, createdAt) {
  var lines = [
    'SCHULUNGSNACHWEIS [DEMO]',
    'Nachweis-ID: ' + model.proofId + ' · Version: ' + model.proofVersion,
    '',
    'PERSON UND SCHULUNG',
    'Synthetische Persona: ' + model.personAlias + ' (' + model.personaId + ')',
    'Zugeordnetes Google-Testkonto: ' + model.verifiedAccount,
    'Thema: ' + model.topicName + ' (' + model.topicId + ')',
    'Quellmaterial: ' + model.materialName,
    'Materialversion: ' + model.materialVersion + ' – keine gesonderte Version im Demo-Katalog erfasst',
    'Auftrag: ' + model.requestId + ' · Personenfall: ' + model.caseId,
    'Erforderliche Schulungsteile: ' + model.phases.length,
    '',
    'TERMINE UND BEURTEILUNGEN'
  ];
  model.phases.forEach(function (phase) {
    lines.push((phase.phase === 'theory' ? 'Theorie' : 'Praxis') + ' · ' + phase.sessionId);
    lines.push('Termin: ' + proofLocalTime_(phase.startUtc) + ' bis ' + proofLocalTime_(phase.endUtc));
    lines.push('Ort: ' + phase.location + ' · Schulende Person: ' + phase.trainerAlias + ' (' + phase.trainerEmail + ')');
    lines.push('Beurteilung: anwesend und bestanden · Trainerantwort ' + phase.trainerResponseId + ' · ' + phase.trainerSubmittedAt + ' UTC');
    lines.push('Trainerquelle (Admin): ' + phase.trainerFormAdminUrl);
    lines.push('Kalenderquelle: ' + phase.eventUrl + ' · Ereignis-ID ' + phase.eventId);
  });
  lines.push('', 'PERSÖNLICHE BESTÄTIGUNGEN');
  model.phases.forEach(function (phase) {
    lines.push((phase.phase === 'theory' ? 'Theorie' : 'Praxis') + ' · ' + phase.sessionId);
    lines.push('Teilnahme bestätigt: Ja · Zugeordnetes Google-Testkonto: ' + phase.verifiedAccount);
    lines.push('Eingegebener Name (Selbstauskunft, keine verifizierte Mitarbeiteridentität): ' + phase.typedName);
    lines.push('Teilnahmeantwort: ' + phase.acknowledgementResponseId + ' · ' + phase.acknowledgementSubmittedAt + ' UTC');
    lines.push('Teilnahmequelle (Admin): ' + phase.acknowledgementFormAdminUrl);
  });
  lines.push('', 'SKILL-ZIEL IM DEMO',
    'Vorherige Stufe: ' + model.previousLevel + ' · Konfigurierte Zielstufe: ' + model.targetLevel,
    'Die Zielstufe ist hier dokumentiert; ihre Eintragung erfolgt erst nach Prüfung beider Archive.',
    '', 'Erstellt: ' + createdAt + ' UTC',
    'Dokumentstatus: Nachweis erstellt. Archiv- und Skillstatus stehen im Fallregister und im Archivmanifest.',
    'Dieser DEMO-Nachweis bescheinigt keine reale Qualifikation.');
  return lines.join('\n');
}

function proofFolder_(parent, name) {
  var files = parent.getFoldersByName(name), found = [];
  while (files.hasNext()) found.push(files.next());
  if (found.length > 1) throw new Error('Doppelter Drive-Nachweisordner: ' + name);
  return found.length ? found[0] : parent.createFolder(name);
}

function proofFolderPath_(model) {
  var root = findDemoFolder_();
  if (!root) throw new Error('Demo-Ordner fehlt.');
  return [PROOF_ARCHIVE_FOLDER, model.topicId, model.requestId, model.personKey]
    .reduce(function (parent, name) { return proofFolder_(parent, name); }, root);
}

function proofNamedFile_(folder, name, mime, ledgerId) {
  var files = folder.getFilesByName(name), found = [];
  while (files.hasNext()) found.push(files.next());
  if (found.length > 1 || found.length && (found[0].getMimeType() !== mime || ledgerId && found[0].getId() !== ledgerId)) {
    throw new Error('Widersprüchliche oder doppelte Nachweisdatei: ' + name);
  }
  if (ledgerId && !found.length) throw new Error('Registrierte Nachweisdatei fehlt: ' + name);
  return found.length ? found[0] : null;
}

function proofLedgerRow_(sheet, model, sourceHash) {
  var rows = sheet.getDataRange().getValues();
  assertHeaders_(rows[0], DEMO_SCHEMA.sheets.Proofs, 'Proofs');
  var found = rows.slice(1).map(function (row, i) { return { row: row, number: i + 2 }; }).filter(function (item) {
    return item.row[0] === model.proofId;
  });
  if (rows.slice(1).some(function (row) { return row[3] === model.caseId && row[0] !== model.proofId; })) {
    throw new Error('Ein anderer Nachweis ist bereits diesem Personenfall zugeordnet.');
  }
  if (found.length > 1) throw new Error('Doppelter Nachweis im Fallregister.');
  if (found.length) {
    var row = found[0].row;
    if (Number(row[1]) !== PROOF_VERSION || row[2] !== model.requestId || row[3] !== model.caseId ||
        row[4] !== model.personKey || row[5] !== model.topicId || row[6] !== sourceHash || row[12] !== '[DEMO]' ||
        ['pending_creation', 'pending_local_archive', 'archived_verified', 'archive_error'].indexOf(row[11]) < 0) {
      throw new Error('Vorhandener Nachweis widerspricht den aktuellen Quellen; Korrekturversion nötig.');
    }
    proofIso_(row[7], 'Nachweiserstellung');
    return { row: row, number: found[0].number, reused: true };
  }
  var createdAt = new Date().toISOString();
  var fresh = [model.proofId, PROOF_VERSION, model.requestId, model.caseId, model.personKey,
    model.topicId, sourceHash, createdAt, '', '', '', 'pending_creation', '[DEMO]'];
  sheet.appendRow(fresh);
  SpreadsheetApp.flush();
  return { row: fresh, number: sheet.getLastRow(), reused: false };
}

function proofSaveAssets_(sheet, ledger, folderId, docId, pdfId, status) {
  sheet.getRange(ledger.number, 9, 1, 4).setValues([[folderId, docId, pdfId, status]]);
  SpreadsheetApp.flush();
  ledger.row[8] = folderId; ledger.row[9] = docId; ledger.row[10] = pdfId; ledger.row[11] = status;
}

function proofEnsureDoc_(folder, name, text, ledgerId) {
  var file = proofNamedFile_(folder, name, MimeType.GOOGLE_DOCS, ledgerId);
  if (!file && !ledgerId) {
    // A retry can recover a Doc created in My Drive before it was moved here.
    var all = DriveApp.getFilesByName(name), orphan = [];
    while (all.hasNext()) {
      var item = all.next();
      if (item.getMimeType() === MimeType.GOOGLE_DOCS) orphan.push(item);
    }
    if (orphan.length > 1) throw new Error('Mehrere gleichnamige Nachweise in Drive.');
    if (orphan.length) {
      var root = DriveApp.getRootFolder(), parents = orphan[0].getParents(), allowed = false;
      while (parents.hasNext()) if (parents.next().getId() === root.getId()) allowed = true;
      if (!allowed) throw new Error('Nachweisdatei liegt in einem unerwarteten Ordner.');
      file = orphan[0].moveTo(folder);
    }
  }
  if (!file) {
    var newDoc = DocumentApp.create(name);
    file = DriveApp.getFileById(newDoc.getId()).moveTo(folder);
  }
  var doc = DocumentApp.openById(file.getId()), body = doc.getBody();
  var existing = body.getText().trim();
  if (existing && existing !== text.trim()) throw new Error('Google Doc wurde nach Erstellung verändert.');
  if (!existing) {
    body.clear();
    text.split('\n').forEach(function (line, index) {
      var paragraph = body.appendParagraph(line);
      if (index === 0) paragraph.setHeading(DocumentApp.ParagraphHeading.TITLE);
      else if (/^[A-ZÄÖÜ ]+$/.test(line) && line.length > 8) paragraph.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    });
    doc.saveAndClose();
  }
  return file;
}

function createIndividualProof(input) {
  if (!input || typeof input.caseId !== 'string') throw new Error('Personenfall fehlt.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_(), model = proofSourceModel_(tables, input.caseId);
    var actor = proofEmail_(Session.getEffectiveUser().getEmail());
    var owner = proofUnique_(tables.People, function (row) { return row.person_key === 'MATT' && row.demo_marker === '[DEMO]'; }, 'Demo-Administration');
    if (!actor || actor !== proofEmail_(owner.email)) throw new Error('Nur Process & Quality darf Nachweise erstellen.');
    var sourceHash = proofHash_(model);
    var sheet = findDemoSpreadsheet_().getSheetByName('Proofs');
    if (!sheet) throw new Error('Nachweisregister fehlt. setupDemo() ausführen.');
    var ledger = proofLedgerRow_(sheet, model, sourceHash);
    var folder = proofFolderPath_(model);
    if (ledger.row[8] && ledger.row[8] !== folder.getId()) throw new Error('Nachweisordner weicht vom Register ab.');
    var name = model.proofId + '-v' + PROOF_VERSION + ' [DEMO]';
    var text = proofText_(model, proofIso_(ledger.row[7], 'Nachweiserstellung'));
    var doc = proofEnsureDoc_(folder, name, text, ledger.row[9]);
    if (ledger.row[11] === 'pending_creation') proofSaveAssets_(sheet, ledger, folder.getId(), doc.getId(), ledger.row[10], 'pending_creation');
    var pdf = proofNamedFile_(folder, name + '.pdf', MimeType.PDF, ledger.row[10]);
    if (!pdf) {
      var blob = doc.getAs(MimeType.PDF).setName(name + '.pdf');
      if (blob.getBytes().length < 100) throw new Error('PDF-Export ist leer.');
      pdf = folder.createFile(blob);
    }
    if (pdf.getSize() < 100) throw new Error('Gespeichertes PDF ist leer.');
    if (ledger.row[11] === 'pending_creation') proofSaveAssets_(sheet, ledger, folder.getId(), doc.getId(), pdf.getId(), 'pending_local_archive');
    return { proofId: model.proofId, proofVersion: PROOF_VERSION, caseId: model.caseId,
      docUrl: doc.getUrl(), pdfUrl: pdf.getUrl(), status: ledger.row[11], reused: ledger.reused };
  } finally { lock.releaseLock(); }
}

function getIndividualProofQueue() {
  var tables = readDemoTables_();
  return tables.ParticipantCases.filter(function (row) { return row.demo_marker === '[DEMO]'; }).map(function (row) {
    var person = proofUnique_(tables.People, function (item) { return item.person_key === row.person_key && item.demo_marker === '[DEMO]'; }, 'Testperson');
    var proof = tables.Proofs.filter(function (item) { return item.case_id === row.case_id; });
    if (proof.length > 1) throw new Error('Mehrere Nachweise für einen Personenfall.');
    var applied = tables.SkillUpdates.filter(function (item) { return item.case_id === row.case_id && item.status === 'applied'; });
    if (applied.length > 1) throw new Error('Mehrere Skillübernahmen für einen Personenfall.');
    var state = 'ready', reason = '';
    try {
      if (applied.length) skillUpdateExisting_(tables, skillArchiveGate_(tables, row.case_id));
      else proofSourceModel_(tables, row.case_id);
    }
    catch (error) { state = 'blocked'; reason = String(error.message || error); }
    var item = proof[0];
    return { caseId: row.case_id, personKey: row.person_key, personAlias: String(person.display_alias), requestId: row.request_id,
      state: state !== 'blocked' && applied.length && item && item.status === 'archived_verified' ? 'completed' :
        state === 'blocked' ? 'blocked' : item && item.status === 'archived_verified' ? 'archived' :
        item && item.status === 'archive_error' ? 'archive_error' :
        item && item.status === 'pending_local_archive' ? 'created' : state,
      reason: reason, proofId: item ? item.proof_id : '',
      docUrl: item && item.doc_id ? 'https://docs.google.com/document/d/' + encodeURIComponent(item.doc_id) + '/edit' : '',
      pdfUrl: item && item.pdf_id ? 'https://drive.google.com/file/d/' + encodeURIComponent(item.pdf_id) + '/view' : '',
      archiveStatus: item ? String(item.status) : '' };
  });
}
