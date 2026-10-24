/** Once-only requests for trainer reports and participant confirmations. */
function formDispatchDate_(session) {
  return Utilities.formatDate(new Date(session.start_utc), SLOT_TIME_ZONE, 'dd.MM.yyyy');
}

function formDispatchCandidates_(tables, now, target) {
  var items = [];
  tables.Sessions.filter(function (session) {
    return session.demo_marker === '[DEMO]' && session.status === 'invited' &&
      Number.isFinite(Date.parse(session.end_utc)) && now.getTime() >= Date.parse(session.end_utc);
  }).forEach(function (session) {
    tables.SessionCases.filter(function (link) {
      return link.session_id === session.session_id && link.demo_marker === '[DEMO]' &&
        (!target || (target.sessionId === session.session_id && target.caseId === link.case_id));
    }).forEach(function (link) {
      var context = trainerCaseContext_(tables, session.session_id, link.case_id);
      var reports = tables.TrainerAssessments.filter(function (row) {
        return row.session_id === session.session_id && row.case_id === link.case_id &&
          row.demo_marker === '[DEMO]' && row.disposition === 'accepted';
      });
      if (reports.length > 1) throw new Error('Mehrere gültige Trainerberichte für denselben Schulungsteil.');
      if (!reports.length) {
        var trainerForm = trainerFormRow_(tables, session.session_id, link.case_id);
        if (!trainerForm) return;
        if (trainerForm.demo_marker !== '[DEMO]' || trainerForm.person_key !== context.person.person_key ||
            trainerForm.trainer_key !== context.trainer.person_key ||
            String(trainerForm.trainer_email).trim().toLowerCase() !== String(context.trainer.email).trim().toLowerCase()) {
          throw new Error('Trainerformular und Fallzuweisung stimmen nicht überein.');
        }
        if (formsReadyForLink_(trainerForm, context.owner.email) &&
            /^https:\/\/docs\.google\.com\/forms\//.test(String(trainerForm.form_url))) {
          items.push({ key: 'trainer_report:' + link.case_id + ':' + session.session_id,
            purpose: 'trainer_assessment_request', context: context, form: trainerForm });
        }
        return;
      }
      if (!participantAcknowledgementGate_(tables, context).allowed || followUpAccepted_(tables, session.session_id, link.case_id)) return;
      var participantForm = participantFormRow_(tables, session.session_id, link.case_id);
      if (!participantForm) return;
      assertParticipantFormAssignment_(participantForm, context);
      if (formsReadyForLink_(participantForm, context.owner.email) &&
          /^https:\/\/docs\.google\.com\/forms\//.test(String(participantForm.form_url))) {
        items.push({ key: 'ack_request:' + link.case_id + ':' + session.session_id,
          purpose: 'acknowledgement_request', context: context, form: participantForm });
      }
    });
  });
  return items;
}

function formDispatchRecipient_(item) {
  var allowed = followUpAllowlisted_(item.context);
  if (item.purpose === 'acknowledgement_request') return { to: allowed.to, replyTo: allowed.replyTo };
  var email = String(item.context.trainer.email).trim().toLowerCase();
  var fixture = getPrivateFixture_();
  validateFixture_(fixture);
  var matches = fixture.People.filter(function (row) {
    return row[0] === item.context.trainer.person_key && String(row[1]).trim().toLowerCase() === email && row[3] === '[DEMO]';
  });
  if (matches.length !== 1) throw new Error('Schulende Person steht nicht auf der privaten Demo-Allowlist.');
  return { to: email, replyTo: allowed.replyTo };
}

function formDispatchMessage_(item) {
  var c = item.context;
  var fields = { topic_name: String(c.topic.display_name), request_id: String(c.request.request_id),
    session_id: String(c.session.session_id), training_date: formDispatchDate_(c.session) };
  if (item.purpose === 'trainer_assessment_request') {
    fields.trainer_name = String(c.trainer.display_alias);
    fields.person_name = String(c.person.display_alias);
    fields.trainer_form_url = String(item.form.form_url);
  } else {
    fields.recipient_name = String(c.person.display_alias);
    fields.acknowledgement_url = String(item.form.form_url);
  }
  return renderDemoEmail_(item.purpose, fields);
}

/** Caller holds the lock. A reserved or failed send is never retried blindly. */
function formDispatchSendOne_(tables, item, now, gateway) {
  var previous = followUpLedgerRow_(tables, item.key);
  if (previous) {
    if (previous.state === 'reserved') {
      followUpSetState_(gateway.sheet, item.key, 'unknown', '', 'Vorherige Reservierung ohne bestätigten Versand; manuell prüfen.');
      return { key: item.key, state: 'unknown' };
    }
    return { key: item.key, state: previous.state, reused: true };
  }
  var recipient = formDispatchRecipient_(item);
  var message = formDispatchMessage_(item);
  gateway.verifyCalendar(item.context);
  if (gateway.remainingQuota() < 1) return { key: item.key, state: 'pending_quota' };
  gateway.sheet.appendRow([item.key, message.purpose, message.templateVersion,
    item.context.request.request_id, item.context.personCase.case_id, item.context.session.session_id,
    recipient.to, item.context.session.end_utc, now.toISOString(), '', 'reserved', '', '[DEMO]']);
  SpreadsheetApp.flush();
  try { gateway.sendEmail({ to: recipient.to, subject: message.subject, body: message.body, replyTo: recipient.replyTo }); }
  catch (error) {
    followUpSetState_(gateway.sheet, item.key, 'unknown', '', 'Versandaufruf unklar; manuell prüfen: ' + String(error && error.message || error));
    return { key: item.key, state: 'unknown' };
  }
  followUpSetState_(gateway.sheet, item.key, 'sent', now.toISOString(), '');
  return { key: item.key, state: 'sent', to: recipient.to };
}

/** Form preparation and response replay run outside the send lock; send rereads all gates. */
function formDispatchPrepareOne_(sessionId, caseId, now) {
  var tables = readDemoTables_();
  var context = trainerCaseContext_(tables, sessionId, caseId);
  if (now.getTime() < Date.parse(context.session.end_utc)) return;
  var reports = tables.TrainerAssessments.filter(function (row) {
    return row.session_id === sessionId && row.case_id === caseId && row.demo_marker === '[DEMO]' && row.disposition === 'accepted';
  });
  if (!reports.length) prepareTrainerForm({ sessionId: sessionId, caseId: caseId });
  var trainerForm = trainerFormRow_(readDemoTables_(), sessionId, caseId);
  if (trainerForm) FormApp.openById(trainerForm.form_id).getResponses().forEach(function (response) {
    processTrainerResponse_(trainerForm.form_id, response);
  });
  tables = readDemoTables_();
  context = trainerCaseContext_(tables, sessionId, caseId);
  if (!participantAcknowledgementGate_(tables, context).allowed) return;
  if (!followUpAccepted_(tables, sessionId, caseId)) prepareParticipantForm({ sessionId: sessionId, caseId: caseId });
  var participantForm = participantFormRow_(readDemoTables_(), sessionId, caseId);
  if (participantForm) FormApp.openById(participantForm.form_id).getResponses().forEach(function (response) {
    processParticipantResponse_(participantForm.form_id, response);
  });
}

function processFormRequestsCore_(clock, gateway) {
  var now = followUpNow_(clock);
  var spreadsheet = findDemoSpreadsheet_();
  gateway = gateway || { sheet: spreadsheet.getSheetByName('MessageLedger'),
    remainingQuota: function () { return MailApp.getRemainingDailyQuota(); },
    sendEmail: function (message) { MailApp.sendEmail(message); },
    verifyCalendar: function (context) { verifyTrainerCalendar_(context, calendarBookingGet_); } };
  var recoveryLock = LockService.getScriptLock();
  recoveryLock.waitLock(30000);
  var recoveredUnknown = [];
  try {
    readDemoTables_().MessageLedger.filter(function (row) {
      return row.demo_marker === '[DEMO]' && row.state === 'reserved' &&
        (row.purpose === 'trainer_assessment_request' || row.purpose === 'acknowledgement_request');
    }).forEach(function (row) {
      followUpSetState_(gateway.sheet, row.send_key, 'unknown', '', 'Vorherige Reservierung ohne bestätigten Versand; manuell prüfen.');
      recoveredUnknown.push(String(row.send_key));
    });
  } finally { recoveryLock.releaseLock(); }
  var results = [];
  var tables = readDemoTables_();
  tables.Sessions.filter(function (session) {
    return session.demo_marker === '[DEMO]' && session.status === 'invited' &&
      Number.isFinite(Date.parse(session.end_utc)) && now.getTime() >= Date.parse(session.end_utc);
  }).forEach(function (session) {
    tables.SessionCases.filter(function (link) {
      return link.session_id === session.session_id && link.demo_marker === '[DEMO]';
    }).forEach(function (link) {
      var key = link.case_id + ':' + session.session_id;
      try {
        formDispatchPrepareOne_(session.session_id, link.case_id, now);
        var lock = LockService.getScriptLock();
        lock.waitLock(30000);
        try {
          var fresh = readDemoTables_();
          formDispatchCandidates_(fresh, now, { sessionId: session.session_id, caseId: link.case_id })
            .forEach(function (item) { results.push(formDispatchSendOne_(fresh, item, now, gateway)); });
        } finally { lock.releaseLock(); }
      } catch (error) { results.push({ key: key, state: 'blocked', reason: String(error && error.message || error) }); }
    });
  });
  return { checkedAt: now.toISOString(), recoveredUnknown: recoveredUnknown, results: results };
}

function processFormRequests() { return processFormRequestsCore_(); }

function installFormRequestProcessor() {
  var found = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === 'processFormRequests'; });
  if (found.length > 1) throw new Error('Mehrere Formularversand-Trigger gefunden.');
  if (found.length) return { installed: false, count: 1 };
  ScriptApp.newTrigger('processFormRequests').timeBased().atHour(9).everyDays(1).inTimezone(SLOT_TIME_ZONE).create();
  return { installed: true, count: 1 };
}
