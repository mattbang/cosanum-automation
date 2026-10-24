/** Increment 12: once-only participant reminders and an auditable open-case queue. */
var FOLLOW_UP_ACTIONS = Object.freeze({ note: true, request_link: true, arrange_follow_up: true });

function followUpNow_(value) {
  var now = value === undefined ? new Date() : value;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Ungültige Uhrzeit für den Erinnerungsabgleich.');
  return now;
}

function followUpDue_(session, days) {
  var start = new Date(session.start_utc);
  if (!Number.isFinite(start.getTime())) throw new Error('Ungültiges Datum des Schulungstermins.');
  var localDate = Utilities.formatDate(start, SLOT_TIME_ZONE, 'yyyy-MM-dd');
  var dueDate = localDatePlusDays_(localDate, days);
  return { localDate: localDate, dueDate: dueDate, dueAt: localDateTime_(dueDate, 9 * 60) };
}

function followUpAccepted_(tables, sessionId, caseId) {
  var rows = tables.ParticipantAcknowledgements.filter(function (row) {
    return row.session_id === sessionId && row.case_id === caseId && row.demo_marker === '[DEMO]' && row.disposition === 'accepted';
  });
  if (rows.length > 1) throw new Error('Mehrere gültige Teilnahmebestätigungen für denselben Schulungsteil.');
  return rows.length === 1;
}

function followUpContext_(tables, session, link, requireVerifiedForm) {
  if (session.demo_marker !== '[DEMO]' || session.status !== 'invited' || link.demo_marker !== '[DEMO]') return null;
  var context = trainerCaseContext_(tables, session.session_id, link.case_id);
  if (!participantAcknowledgementGate_(tables, context).allowed || followUpAccepted_(tables, session.session_id, link.case_id)) return null;
  var form = participantFormRow_(tables, session.session_id, link.case_id);
  if (form) assertParticipantFormAssignment_(form, context);
  var formReady = !!form && formsReadyForLink_(form, context.owner.email) &&
    /^https:\/\/docs\.google\.com\/forms\//.test(String(form.form_url));
  if (requireVerifiedForm && !formReady) return null;
  return { context: context, form: form, formReady: formReady };
}

function followUpAllowlisted_(context) {
  var fixture = getPrivateFixture_();
  validateFixture_(fixture);
  var personEmail = String(context.person.email).trim().toLowerCase();
  var ownerEmail = String(context.owner.email).trim().toLowerCase();
  var matches = fixture.People.filter(function (row) {
    return row[0] === context.person.person_key && String(row[1]).trim().toLowerCase() === personEmail && row[3] === '[DEMO]';
  });
  var ownerMatches = fixture.People.filter(function (row) {
    return row[0] === 'MATT' && String(row[1]).trim().toLowerCase() === ownerEmail && row[3] === '[DEMO]';
  });
  if (matches.length !== 1 || ownerMatches.length !== 1 ||
      String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase() !== ownerEmail) {
    throw new Error('Empfänger oder Eigentümer steht nicht auf der privaten Demo-Allowlist.');
  }
  return { to: personEmail, replyTo: ownerEmail };
}

function followUpLedgerRow_(tables, key) {
  var matches = tables.MessageLedger.filter(function (row) { return row.send_key === key && row.demo_marker === '[DEMO]'; });
  if (matches.length > 1) throw new Error('Doppelter Versandschlüssel im Nachrichtenregister.');
  return matches[0] || null;
}

function followUpCandidates_(tables, now) {
  var result = [];
  tables.Sessions.filter(function (session) { return session.demo_marker === '[DEMO]' && session.status === 'invited'; }).forEach(function (session) {
    tables.SessionCases.filter(function (link) { return link.session_id === session.session_id && link.demo_marker === '[DEMO]'; }).forEach(function (link) {
      var eligible = followUpContext_(tables, session, link, true);
      if (!eligible) return;
      var initial = followUpLedgerRow_(tables, 'ack_request:' + link.case_id + ':' + session.session_id);
      var initialSent = initial && initial.state === 'sent' ? Date.parse(String(initial.sent_at_utc)) : NaN;
      if (!Number.isFinite(initialSent) || now.getTime() - initialSent < 24 * 60 * 60 * 1000) return;
      var day2 = followUpDue_(session, 2), day5 = followUpDue_(session, 5);
      if (now.getTime() < day2.dueAt.getTime()) return;
      // A missed day-2 run does not send two differently worded reminders together on day 5.
      var day = now.getTime() >= day5.dueAt.getTime() ? 5 : 2;
      var due = day === 5 ? day5 : day2;
      result.push({ session: session, link: link, context: eligible.context, form: eligible.form,
        day: day, dueAt: due.dueAt, localDate: due.localDate,
        key: 'ack_day_' + day + ':' + link.case_id + ':' + session.session_id });
    });
  });
  return result;
}

function followUpMessage_(item) {
  var c = item.context;
  var date = item.localDate.split('-');
  return renderDemoEmail_('acknowledgement_reminder_day_' + item.day, {
    topic_name: String(c.topic.display_name), request_id: String(c.request.request_id),
    recipient_name: String(c.person.display_alias), training_date: date[2] + '.' + date[1] + '.' + date[0],
    acknowledgement_url: String(item.form.form_url)
  });
}

function followUpSetState_(sheet, key, state, stamp, error) {
  var values = sheet.getDataRange().getValues();
  assertHeaders_(values[0], DEMO_SCHEMA.sheets.MessageLedger, 'MessageLedger');
  var indexes = values.map(function (row, i) { return row[0] === key ? i : -1; }).filter(function (i) { return i > 0; });
  if (indexes.length !== 1) throw new Error('Versandreservierung fehlt oder ist doppelt.');
  sheet.getRange(indexes[0] + 1, 10, 1, 3).setValues([[state === 'sent' ? stamp : '', state, String(error || '').slice(0, 500)]]);
  SpreadsheetApp.flush();
}

/** Caller holds the script lock. A send exception is ambiguous, so it is never retried automatically. */
function followUpSendOne_(tables, item, now, gateway) {
  var existing = followUpLedgerRow_(tables, item.key);
  if (existing) {
    if (existing.state === 'reserved') {
      followUpSetState_(gateway.sheet, item.key, 'unknown', '', 'Vorherige Reservierung ohne bestätigten Versand; manuell prüfen.');
      return { key: item.key, state: 'unknown' };
    }
    return { key: item.key, state: existing.state, reused: true };
  }
  var recipient = followUpAllowlisted_(item.context);
  var message = followUpMessage_(item);
  gateway.verifyCalendar(item.context);
  if (gateway.remainingQuota() < 1) return { key: item.key, state: 'pending_quota' };
  gateway.sheet.appendRow([item.key, message.purpose, message.templateVersion,
    item.context.request.request_id, item.link.case_id, item.session.session_id,
    recipient.to, item.dueAt.toISOString(), now.toISOString(), '', 'reserved', '', '[DEMO]']);
  SpreadsheetApp.flush();
  try {
    gateway.sendEmail({ to: recipient.to, subject: message.subject, body: message.body, replyTo: recipient.replyTo });
  } catch (error) {
    followUpSetState_(gateway.sheet, item.key, 'unknown', '', 'Versandaufruf unklar; manuell prüfen: ' + String(error && error.message || error));
    return { key: item.key, state: 'unknown' };
  }
  followUpSetState_(gateway.sheet, item.key, 'sent', now.toISOString(), '');
  return { key: item.key, state: 'sent', to: recipient.to, subject: message.subject };
}

/** Injectable clock and gateway support deterministic tests without real mail. */
function processAcknowledgementFollowUpsCore_(clock, gateway) {
  var now = followUpNow_(clock);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var spreadsheet = findDemoSpreadsheet_();
    gateway = gateway || {
      sheet: spreadsheet.getSheetByName('MessageLedger'),
      remainingQuota: function () { return MailApp.getRemainingDailyQuota(); },
      sendEmail: function (message) { MailApp.sendEmail(message); },
      verifyCalendar: function (context) { verifyTrainerCalendar_(context, calendarBookingGet_); }
    };
    // The lock rules out an active previous processor. Inspect old reservations
    // even when their due window has passed, so none remain silently ambiguous.
    var recoveredUnknown = [];
    readDemoTables_().MessageLedger.filter(function (row) {
      return row.demo_marker === '[DEMO]' && row.state === 'reserved' &&
        /^acknowledgement_reminder_day_[25]$/.test(String(row.purpose));
    }).forEach(function (row) {
      followUpSetState_(gateway.sheet, row.send_key, 'unknown', '', 'Vorherige Reservierung ohne bestätigten Versand; manuell prüfen.');
      recoveredUnknown.push(String(row.send_key));
    });
    var results = [];
    followUpCandidates_(readDemoTables_(), now).forEach(function (candidate) {
      try {
        // A delayed Form trigger may have left a valid response only in Forms.
        // Reconcile under the same lock, then derive the candidate afresh.
        reconcileParticipantResponsesLocked_(readDemoTables_(), candidate.form);
        var tables = readDemoTables_();
        var current = followUpCandidates_(tables, now).filter(function (row) { return row.key === candidate.key; })[0];
        if (current) results.push(followUpSendOne_(tables, current, now, gateway));
      } catch (error) { results.push({ key: candidate.key, state: 'blocked', reason: String(error && error.message || error) }); }
    });
    return { checkedAt: now.toISOString(), recoveredUnknown: recoveredUnknown,
      results: results, rows: acknowledgementFollowUpQueue_(readDemoTables_(), now) };
  } finally { lock.releaseLock(); }
}

function processAcknowledgementFollowUps() { return processAcknowledgementFollowUpsCore_(); }

function acknowledgementFollowUpQueue_(tables, clock) {
  var now = followUpNow_(clock), rows = [];
  tables.Sessions.filter(function (session) { return session.demo_marker === '[DEMO]' && session.status === 'invited'; }).forEach(function (session) {
    tables.SessionCases.filter(function (link) { return link.session_id === session.session_id && link.demo_marker === '[DEMO]'; }).forEach(function (link) {
      var eligible = followUpContext_(tables, session, link, false);
      if (!eligible) return;
      var due = followUpDue_(session, 5);
      var open = now.getTime() >= due.dueAt.getTime();
      var prefix = 'ack_day_';
      var day2 = followUpLedgerRow_(tables, prefix + '2:' + link.case_id + ':' + session.session_id);
      var day5 = followUpLedgerRow_(tables, prefix + '5:' + link.case_id + ':' + session.session_id);
      var actions = tables.FollowUps.filter(function (row) {
        return row.case_id === link.case_id && row.session_id === session.session_id && row.demo_marker === '[DEMO]';
      });
      rows.push({ caseId: link.case_id, sessionId: session.session_id, requestId: session.request_id,
        personAlias: String(eligible.context.person.display_alias), topicName: String(eligible.context.topic.display_name),
        state: open ? 'open' : 'awaiting_acknowledgement', dueDay5Utc: due.dueAt.toISOString(),
        day2State: day2 ? day2.state : '', day5State: day5 ? day5.state : '',
        formUrl: eligible.formReady ? String(eligible.form.form_url) : '', formReady: eligible.formReady,
        lastAction: actions.length ? String(actions[actions.length - 1].action) : '',
        lastNote: actions.length ? String(actions[actions.length - 1].note) : '' });
    });
  });
  return rows;
}

function getAcknowledgementFollowUpQueue() { return acknowledgementFollowUpQueue_(readDemoTables_()); }

function recordAcknowledgementFollowUp(input) {
  if (!input || !FOLLOW_UP_ACTIONS[input.action] || typeof input.caseId !== 'string' ||
      typeof input.sessionId !== 'string' || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 500 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.note)) throw new Error('Aktion und kurze Notiz sind erforderlich.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var context = trainerCaseContext_(tables, input.sessionId, input.caseId);
    followUpAllowlisted_(context);
    var open = acknowledgementFollowUpQueue_(tables).filter(function (row) {
      return row.caseId === input.caseId && row.sessionId === input.sessionId && row.state === 'open';
    });
    if (open.length !== 1) throw new Error('Dieser Fall ist nicht offen oder wurde bereits bestätigt.');
    var actionId = Utilities.getUuid(), stamp = new Date().toISOString();
    findDemoSpreadsheet_().getSheetByName('FollowUps').appendRow([
      actionId, input.caseId, input.sessionId, context.request.request_id, input.action,
      input.note.trim(), String(context.owner.email).trim().toLowerCase(), stamp, '[DEMO]']);
    SpreadsheetApp.flush();
    return { actionId: actionId, recordedAt: stamp, rows: getAcknowledgementFollowUpQueue() };
  } finally { lock.releaseLock(); }
}

function installAcknowledgementFollowUpProcessor() {
  var matches = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'processAcknowledgementFollowUps';
  });
  if (matches.length > 1) throw new Error('Mehrere Erinnerungstrigger vorhanden.');
  if (matches.length) return { installed: false, count: 1 };
  ScriptApp.newTrigger('processAcknowledgementFollowUps').timeBased().atHour(9).everyDays(1).inTimezone(SLOT_TIME_ZONE).create();
  return { installed: true, count: 1 };
}
