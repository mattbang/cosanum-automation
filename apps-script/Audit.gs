/** Increment 13: owner-only evidence audit and once-only request notices. */
var AUDIT_EXCEPTIONS = Object.freeze({
  declined: ['Kalendereinladung abgelehnt.', 'Ersatztermin für diese Person planen; Gruppentermin beibehalten.'],
  failed: ['Trainerbeurteilung nicht bestanden oder Person abwesend.', 'Trainerbericht prüfen und Folgeeinheit planen.'],
  acknowledgement_overdue: ['Persönliche Teilnahmebestätigung nach Tag 5 offen.', 'Person kontaktieren und gültige Bestätigung abwarten.'],
  archive_error: ['Nachweis oder lokales Archiv nicht geprüft.', 'Archivkopien prüfen und lokalen Archivhelfer erneut ausführen.'],
  skill_conflict: ['Skillübernahme widerspricht dem Matrixstand.', 'Quellen und Demo-Matrix im Sheet prüfen.']
});

function auditOwner_(tables) {
  var owner = proofUnique_(tables.People, function (row) { return row.person_key === 'MATT' && row.demo_marker === '[DEMO]'; }, 'Demo-Administration');
  var email = proofEmail_(owner.email);
  var fixture = getPrivateFixture_();
  validateFixture_(fixture);
  if (proofEmail_(Session.getEffectiveUser().getEmail()) !== email ||
      fixture.People.filter(function (row) { return row[0] === 'MATT' && proofEmail_(row[1]) === email && row[3] === '[DEMO]'; }).length !== 1) {
    throw new Error('Nur das Demo-Eigentümerkonto darf die Fallprüfung öffnen.');
  }
  return email;
}

function auditSourceLinks_(tables, personCase) {
  return tables.SessionCases.filter(function (link) {
    return link.case_id === personCase.case_id && link.request_id === personCase.request_id && link.demo_marker === '[DEMO]';
  }).map(function (link) {
    var session = tables.Sessions.filter(function (row) { return row.session_id === link.session_id && row.demo_marker === '[DEMO]'; })[0];
    var trainer = tables.TrainerForms.filter(function (row) { return row.case_id === personCase.case_id && row.session_id === link.session_id && row.demo_marker === '[DEMO]'; })[0];
    var participant = tables.ParticipantForms.filter(function (row) { return row.case_id === personCase.case_id && row.session_id === link.session_id && row.demo_marker === '[DEMO]'; })[0];
    var assessment = tables.TrainerAssessments.filter(function (row) { return row.case_id === personCase.case_id && row.session_id === link.session_id && row.disposition === 'accepted'; })[0];
    var acknowledgement = tables.ParticipantAcknowledgements.filter(function (row) { return row.case_id === personCase.case_id && row.session_id === link.session_id && row.disposition === 'accepted'; })[0];
    var rsvp = tables.SessionRsvps.filter(function (row) { return row.case_id === personCase.case_id && row.session_id === link.session_id && row.demo_marker === '[DEMO]'; })[0];
    return { sessionId: link.session_id, phase: session ? String(session.phase) : '',
      startUtc: session ? String(session.start_utc) : '', endUtc: session ? String(session.end_utc) : '',
      eventUrl: session ? String(session.calendar_event_url || '') : '',
      rsvp: rsvp ? String(rsvp.response_status) : '', rsvpFlag: rsvp ? String(rsvp.flag) : '',
      attendance: assessment ? String(assessment.attendance) : '', result: assessment ? String(assessment.assessment) : '',
      trainerResponseId: assessment ? String(assessment.response_id) : '',
      trainerSubmittedAt: assessment ? String(assessment.submitted_at) : '',
      trainerResponseUrl: trainer && trainer.form_id ? 'https://docs.google.com/forms/d/' + encodeURIComponent(trainer.form_id) + '/edit#responses' : '',
      acknowledgementResponseId: acknowledgement ? String(acknowledgement.response_id) : '',
      acknowledgementSubmittedAt: acknowledgement ? String(acknowledgement.submitted_at) : '',
      acknowledgementUrl: participant && participant.form_id ? 'https://docs.google.com/forms/d/' + encodeURIComponent(participant.form_id) + '/edit#responses' : '' };
  }).sort(function (a, b) { return (a.phase === 'theory' ? 0 : 1) - (b.phase === 'theory' ? 0 : 1); });
}

function auditCompletionGate_(tables, personCase) {
  var gate = skillArchiveGate_(tables, personCase.case_id);
  var update = skillUpdateExisting_(tables, gate);
  if (!update || update.status !== 'applied') throw new Error('Skillübernahme ist noch nicht angewendet.');
  var matrix = proofUnique_(tables.Skills, function (row) {
    return row.person_key === personCase.person_key && row.topic_id === gate.request.topic_id && row.demo_marker === '[DEMO]';
  }, 'Demo-Matrixeintrag');
  if (!Number.isInteger(Number(matrix.skill_level)) || Number(matrix.skill_level) < Number(personCase.target_level)) {
    throw new Error('Matrixstand liegt unter der protokollierten Zielstufe.');
  }
  // Recreate the immutable source snapshot without changing the live Sheet.
  // proofSourceModel_ then rechecks original Calendar and verified Form responses.
  var snapshot = Object.assign({}, tables, { Skills: tables.Skills.map(function (row) {
    return row === matrix ? Object.assign({}, row, { skill_level: personCase.current_level }) : row;
  }) });
  var model = proofSourceModel_(snapshot, personCase.case_id);
  if (proofHash_(model) !== gate.proof.source_hash) throw new Error('Originalbelege weichen vom archivierten Nachweis ab.');
  return { gate: gate, update: update, model: model };
}

function auditCase_(tables, personCase, now) {
  var person = proofUnique_(tables.People, function (row) { return row.person_key === personCase.person_key && row.demo_marker === '[DEMO]'; }, 'Testperson');
  var phases = auditSourceLinks_(tables, personCase);
  var proof = tables.Proofs.filter(function (row) { return row.case_id === personCase.case_id && row.demo_marker === '[DEMO]'; });
  var receipt = tables.ArchiveReceipts.filter(function (row) { return row.case_id === personCase.case_id && row.demo_marker === '[DEMO]'; });
  var update = tables.SkillUpdates.filter(function (row) { return row.case_id === personCase.case_id && row.demo_marker === '[DEMO]'; });
  var row = { caseId: personCase.case_id, requestId: personCase.request_id, personKey: personCase.person_key,
    personAlias: String(person.display_alias), email: proofEmail_(person.email), previousLevel: String(personCase.current_level),
    targetLevel: String(personCase.target_level), state: 'waiting', reasonCode: '', reason: '', nextAction: '',
    phases: phases, proofId: proof.length === 1 ? String(proof[0].proof_id) : '',
    docUrl: proof.length === 1 && proof[0].doc_id ? 'https://docs.google.com/document/d/' + encodeURIComponent(proof[0].doc_id) + '/edit' : '',
    pdfUrl: proof.length === 1 && proof[0].pdf_id ? 'https://drive.google.com/file/d/' + encodeURIComponent(proof[0].pdf_id) + '/view' : '',
    archiveStatus: proof.length === 1 ? String(proof[0].status) : '',
    localPdfPath: receipt.length === 1 ? String(receipt[0].local_pdf_path) : '',
    localDocxPath: receipt.length === 1 ? String(receipt[0].local_docx_path) : '',
    drivePdfSha256: receipt.length === 1 ? String(receipt[0].drive_pdf_sha256) : '',
    localPdfSha256: receipt.length === 1 ? String(receipt[0].local_pdf_sha256) : '',
    archiveVerifiedAt: receipt.length === 1 ? String(receipt[0].verified_at) : '',
    skillKey: update.length === 1 ? String(update[0].idempotency_key) : '',
    skillStatus: update.length === 1 ? String(update[0].status) : '',
    skillAppliedAt: update.length === 1 ? String(update[0].applied_at) : '',
    skillRowNumber: update.length === 1 ? tables.SkillUpdates.indexOf(update[0]) + 2 : 0,
    receiptRowNumber: receipt.length === 1 ? tables.ArchiveReceipts.indexOf(receipt[0]) + 2 : 0 };
  try { auditCompletionGate_(tables, personCase); row.state = 'complete'; return row; }
  catch (error) { row.reason = String(error.message || error); }
  var reason = '';
  if (phases.some(function (phase) { return phase.rsvp === 'declined' || phase.rsvpFlag === 'declined'; })) reason = 'declined';
  else if (phases.some(function (phase) { return phase.attendance === 'absent' || phase.result === 'needs_follow_up' || phase.result === 'not_assessed'; })) reason = 'failed';
  else if (phases.some(function (phase) {
    if (phase.attendance !== 'attended' || phase.result !== 'passed' || phase.acknowledgementResponseId || !phase.startUtc) return false;
    return now.getTime() >= followUpDue_({ start_utc: phase.startUtc }, 5).dueAt.getTime();
  })) reason = 'acknowledgement_overdue';
  else if (proof.length > 1 || receipt.length > 1 || proof.some(function (item) { return item.status === 'archive_error'; }) ||
      (receipt.length === 1 && receipt[0].status !== 'verified')) reason = 'archive_error';
  else if (update.length > 1 || update.some(function (item) { return item.status === 'conflict'; }) ||
      (update.length === 1 && update[0].status === 'applied')) reason = 'skill_conflict';
  if (reason) { row.state = 'open'; row.reasonCode = reason; row.reason = AUDIT_EXCEPTIONS[reason][0]; row.nextAction = AUDIT_EXCEPTIONS[reason][1]; }
  else { row.nextAction = 'Fehlende Schulungsteile, Antworten, Nachweis und Archivierung abschliessen.'; }
  return row;
}

function auditView_(tables, now, spreadsheetUrl) {
  auditOwner_(tables);
  var requestIds = tables.Requests.filter(function (row) { return row.demo_marker === '[DEMO]'; }).map(function (row) { return row.request_id; });
  if (new Set(requestIds).size !== requestIds.length) throw new Error('Doppelte Demo-Auftrags-ID im Register.');
  if (tables.Requests.length > 9999) throw new Error('Der vierstellige Auftragsnummernraum ist voll. Bitte die Nummerierung erweitern.');
  var caseIds = tables.ParticipantCases.filter(function (row) { return row.demo_marker === '[DEMO]'; }).map(function (row) { return row.case_id; });
  if (new Set(caseIds).size !== caseIds.length) throw new Error('Doppelte Demo-Personenfall-ID im Register.');
  return tables.Requests.filter(function (request) { return request.demo_marker === '[DEMO]'; }).map(function (request) {
    var topic = proofUnique_(tables.Topics, function (row) { return row.topic_id === request.topic_id && row.demo_marker === '[DEMO]'; }, 'Demo-Thema');
    var cases = tables.ParticipantCases.filter(function (row) { return row.request_id === request.request_id && row.demo_marker === '[DEMO]'; });
    if (!cases.length || new Set(cases.map(function (row) { return row.person_key; })).size !== cases.length) {
      throw new Error('Auftrag hat keine eindeutige Auswahl an Testpersonen.');
    }
    var caseRows = cases.map(function (row) { return auditCase_(tables, row, now); });
    var complete = caseRows.every(function (row) { return row.state === 'complete'; });
    var notices = tables.MessageLedger.filter(function (row) { return row.request_id === request.request_id && row.demo_marker === '[DEMO]' &&
      (row.purpose === 'completion_notice' || row.purpose === 'exception_notice'); });
    var sessions = tables.Sessions.filter(function (row) { return row.request_id === request.request_id && row.demo_marker === '[DEMO]'; });
    return { requestId: request.request_id, requestNo: tables.Requests.indexOf(request) + 1, topicId: request.topic_id, topicName: String(topic.display_name),
      mode: String(request.mode), createdAt: String(request.created_at), state: complete ? 'complete' :
        caseRows.some(function (row) { return row.state === 'open'; }) ? 'open' : 'waiting',
      plannedSessions: sessions.length, bookedSessions: sessions.filter(function (row) { return !!row.calendar_event_id; }).length,
      sheetUrl: spreadsheetUrl, cases: caseRows,
      completionNoticeState: notices.filter(function (row) { return row.purpose === 'completion_notice'; }).map(function (row) { return row.state; })[0] || '',
      notices: notices.map(function (row) { return { key: row.send_key, purpose: row.purpose, state: row.state, sentAt: String(row.sent_at_utc) }; }) };
  });
}

function getAuditDashboard() {
  var spreadsheet = findDemoSpreadsheet_();
  return auditView_(readDemoTables_(), new Date(), spreadsheet.getUrl()).map(function (request) {
    request.cases.forEach(function (row) {
      row.skillUrl = row.skillRowNumber ? spreadsheet.getUrl() + '#gid=' + spreadsheet.getSheetByName('SkillUpdates').getSheetId() + '&range=A' + row.skillRowNumber : '';
      row.archiveReceiptUrl = row.receiptRowNumber ? spreadsheet.getUrl() + '#gid=' + spreadsheet.getSheetByName('ArchiveReceipts').getSheetId() + '&range=A' + row.receiptRowNumber : '';
    });
    return request;
  });
}

function auditRecipients_(tables, ownerEmail) {
  var ccs = proofEmail_(PropertiesService.getScriptProperties().getProperty('DEMO_CCS_EMAIL') || ownerEmail);
  var fixture = getPrivateFixture_();
  [ownerEmail, ccs].forEach(function (email) {
    if (fixture.People.filter(function (row) { return proofEmail_(row[1]) === email && row[3] === '[DEMO]'; }).length !== 1) {
      throw new Error('Benachrichtigungsempfänger steht nicht auf der privaten Demo-Allowlist.');
    }
  });
  return Array.from(new Set([ownerEmail, ccs]));
}

function auditCandidates_(view) {
  var result = [];
  view.forEach(function (request) {
    if (request.state === 'complete') result.push({ key: 'completion:' + request.requestId, purpose: 'completion_notice', request: request });
    else request.cases.filter(function (row) { return row.state === 'open'; }).forEach(function (row) {
      result.push({ key: 'exception:' + row.caseId + ':' + row.reasonCode, purpose: 'exception_notice', request: request, personCase: row });
    });
  });
  return result;
}

function auditMessage_(candidate, dashboardUrl) {
  var request = candidate.request;
  var fields = { topic_name: request.topicName, request_id: request.requestId, dashboard_url: dashboardUrl };
  if (candidate.purpose === 'exception_notice') {
    fields.person_name = candidate.personCase.personAlias;
    fields.exception_reason = candidate.personCase.reason;
    fields.next_action = candidate.personCase.nextAction;
  } else {
    fields.participant_count = String(request.cases.length);
    fields.participants_summary = request.cases.map(function (row) { return row.personAlias; }).join(', ');
    var dates = request.cases.flatMap(function (row) { return row.phases.map(function (phase) {
      return phase.startUtc ? Utilities.formatDate(new Date(phase.startUtc), SLOT_TIME_ZONE, 'dd.MM.yyyy') : '';
    }); });
    fields.training_date = Array.from(new Set(dates)).filter(Boolean).sort().join(', ') || 'Nicht dokumentiert';
  }
  return renderDemoEmail_(candidate.purpose, fields);
}

function auditSendOne_(tables, candidate, now, gateway) {
  var previous = followUpLedgerRow_(tables, candidate.key);
  if (previous) {
    if (previous.state === 'reserved') {
      followUpSetState_(gateway.sheet, candidate.key, 'unknown', '', 'Vorherige Reservierung ohne bestätigten Versand; manuell prüfen.');
      return { key: candidate.key, state: 'unknown' };
    }
    return { key: candidate.key, state: previous.state, reused: true };
  }
  var owner = auditOwner_(tables);
  var recipients = candidate.purpose === 'completion_notice' ? auditRecipients_(tables, owner) : [owner];
  var message = auditMessage_(candidate, gateway.dashboardUrl());
  if (gateway.remainingQuota() < recipients.length) return { key: candidate.key, state: 'pending_quota' };
  gateway.sheet.appendRow([candidate.key, message.purpose, message.templateVersion, candidate.request.requestId,
    candidate.personCase ? candidate.personCase.caseId : '', '', recipients.join(','), now.toISOString(), now.toISOString(),
    '', 'reserved', '', '[DEMO]']);
  SpreadsheetApp.flush();
  try { gateway.sendEmail({ to: recipients.join(','), subject: message.subject, body: message.body, replyTo: owner }); }
  catch (error) {
    followUpSetState_(gateway.sheet, candidate.key, 'unknown', '', 'Versandaufruf unklar; manuell prüfen: ' + String(error && error.message || error));
    return { key: candidate.key, state: 'unknown' };
  }
  followUpSetState_(gateway.sheet, candidate.key, 'sent', now.toISOString(), '');
  return { key: candidate.key, state: 'sent', to: recipients.join(',') };
}

function processAuditNoticesCore_(clock, gateway) {
  var now = followUpNow_(clock), lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var spreadsheet = findDemoSpreadsheet_();
    gateway = gateway || { sheet: spreadsheet.getSheetByName('MessageLedger'),
      remainingQuota: function () { return MailApp.getRemainingDailyQuota(); },
      sendEmail: function (message) { MailApp.sendEmail(message); },
      dashboardUrl: function () { return ScriptApp.getService().getUrl(); } };
    // Reconcile every overdue participant Form before calculating exception notices.
    // A Forms read failure blocks the entire audit send run, including completion.
    var before = readDemoTables_();
    before.ParticipantForms.filter(function (form) {
      if (form.demo_marker !== '[DEMO]') return false;
      var session = before.Sessions.filter(function (row) {
        return row.session_id === form.session_id && row.demo_marker === '[DEMO]';
      });
      return session.length === 1 && session[0].status === 'invited' &&
        now.getTime() >= followUpDue_(session[0], 5).dueAt.getTime() &&
        !!acceptedTrainerPassRow_(before, form.session_id, form.case_id);
    }).forEach(function (form) { reconcileParticipantResponsesLocked_(readDemoTables_(), form); });
    var recovered = [];
    readDemoTables_().MessageLedger.filter(function (row) {
      return row.demo_marker === '[DEMO]' && row.state === 'reserved' &&
        (row.purpose === 'completion_notice' || row.purpose === 'exception_notice');
    }).forEach(function (row) {
      followUpSetState_(gateway.sheet, row.send_key, 'unknown', '', 'Vorherige Reservierung ohne bestätigten Versand; manuell prüfen.');
      recovered.push(row.send_key);
    });
    var results = [];
    auditCandidates_(auditView_(readDemoTables_(), now, spreadsheet.getUrl())).forEach(function (item) {
      try {
        var tables = readDemoTables_();
        var current = auditCandidates_(auditView_(tables, now, spreadsheet.getUrl())).filter(function (row) { return row.key === item.key; })[0];
        if (current) results.push(auditSendOne_(tables, current, now, gateway));
      } catch (error) { results.push({ key: item.key, state: 'blocked', reason: String(error && error.message || error) }); }
    });
    return { checkedAt: now.toISOString(), recoveredUnknown: recovered, results: results,
      requests: auditView_(readDemoTables_(), now, spreadsheet.getUrl()) };
  } finally { lock.releaseLock(); }
}

function processAuditNotices() { return processAuditNoticesCore_(); }

function installAuditNoticeProcessor() {
  var found = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === 'processAuditNotices'; });
  if (found.length > 1) throw new Error('Mehrere tägliche Abschluss-Trigger gefunden.');
  if (found.length) return { installed: false, count: 1 };
  ScriptApp.newTrigger('processAuditNotices').timeBased().atHour(9).everyDays(1).inTimezone(SLOT_TIME_ZONE).create();
  return { installed: true, count: 1 };
}
