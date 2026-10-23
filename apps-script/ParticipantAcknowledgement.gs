/** Increment 08: one account-linked acknowledgement per participant and phase. */
var PARTICIPANT_QUESTIONS = Object.freeze({
  participation: 'Teilnahmebestätigung',
  name: 'Vor- und Nachname'
});
var PARTICIPANT_AFFIRMATION = 'Ich bestätige, dass ich an der oben genannten Schulung teilgenommen habe.';

function acceptedTrainerPassRow_(tables, sessionId, caseId) {
  var rows = tables.TrainerAssessments.filter(function (row) {
    return row.session_id === sessionId && row.case_id === caseId && row.disposition === 'accepted' && row.demo_marker === '[DEMO]';
  });
  if (rows.length > 1) throw new Error('Mehrere gültige Trainerberichte für denselben Schulungsteil.');
  return rows.length === 1 && rows[0].attendance === 'attended' && rows[0].assessment === 'passed' &&
    Number.isFinite(Date.parse(rows[0].submitted_at)) ? rows[0] : null;
}

function participantAcknowledgementGate_(tables, context) {
  var session = context.session;
  var caseId = context.personCase.case_id;
  var currentPass = acceptedTrainerPassRow_(tables, session.session_id, caseId);
  if (!currentPass) {
    return { allowed: false, reason: 'Anwesenheit und Bestehen wurden für diesen Schulungsteil nicht bestätigt.' };
  }
  if (session.phase === 'practice') {
    var theory = tables.Sessions.filter(function (row) {
      return row.session_id === session.theory_session_id && row.request_id === session.request_id &&
        row.phase === 'theory' && row.demo_marker === '[DEMO]';
    });
    var links = tables.SessionCases.filter(function (row) {
      return row.session_id === session.theory_session_id && row.case_id === caseId && row.demo_marker === '[DEMO]';
    });
    if (theory.length !== 1 || links.length !== 1 || !acceptedTrainerPassRow_(tables, session.theory_session_id, caseId)) {
      return { allowed: false, reason: 'Die bestandene Theorie für diese Person fehlt.' };
    }
  }
  return { allowed: true, reason: '', releasedAt: String(currentPass.submitted_at) };
}

function participantFormRow_(tables, sessionId, caseId) {
  var rows = tables.ParticipantForms.filter(function (row) {
    return row.session_id === sessionId && row.case_id === caseId;
  });
  if (rows.length > 1) throw new Error('Mehrere Teilnahmeformulare für denselben Fall.');
  return rows.length ? rows[0] : null;
}

function assertParticipantFormAssignment_(formRow, context) {
  if (formRow.demo_marker !== '[DEMO]' || formRow.request_id !== context.request.request_id ||
      formRow.person_key !== context.person.person_key ||
      String(formRow.participant_email).trim().toLowerCase() !== String(context.person.email).trim().toLowerCase()) {
    throw new Error('Teilnahmeformular und Personenfall stimmen nicht überein.');
  }
}

function ensureParticipantFormTrigger_(formId) {
  var matches = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'onParticipantFormSubmit' && trigger.getTriggerSourceId() === formId;
  });
  if (matches.length > 1) throw new Error('Mehrere Abgabe-Trigger für dasselbe Teilnahmeformular.');
  if (!matches.length) ScriptApp.newTrigger('onParticipantFormSubmit').forForm(formId).onFormSubmit().create();
}

function buildParticipantForm_(context, createForm, folder) {
  var session = context.session;
  var date = Utilities.formatDate(new Date(session.start_utc), SLOT_TIME_ZONE, 'dd.MM.yyyy HH:mm');
  var end = Utilities.formatDate(new Date(session.end_utc), SLOT_TIME_ZONE, 'HH:mm');
  var form = createForm('[DEMO] Teilnahmebestätigung – ' + safeEventLabel_(context.topic.display_name));
  form.setDescription([
    'Teilnahmebestätigung [DEMO] · Bitte bestätigen Sie nur Ihre eigene Teilnahme.',
    'Thema: ' + context.topic.display_name + ' · Teil: ' + (session.phase === 'theory' ? 'Theorie' : 'Praxis'),
    'Termin: ' + date + '–' + end + ' Europe/Zurich',
    'Schulende Person: ' + context.trainer.display_alias,
    'Auftrag: ' + context.request.request_id + ' · Termin: ' + session.session_id + ' · Fall: ' + context.personCase.case_id,
    'Wenn Sie nicht teilgenommen haben oder die Angaben nicht stimmen, senden Sie das Formular nicht ab. Antworten Sie stattdessen auf die E-Mail mit dem Link.'
  ].join('\n'));
  form.setCollectEmail(true);
  form.setAllowResponseEdits(false);
  form.setConfirmationMessage('Ihre Teilnahmebestätigung für diesen DEMO-Termin wurde übermittelt. Sie wird erst nach Prüfung Ihres Google-Kontos dem richtigen Fall zugeordnet.');
  form.addCheckboxItem().setTitle(PARTICIPANT_QUESTIONS.participation).setChoiceValues([PARTICIPANT_AFFIRMATION]).setRequired(true);
  form.addTextItem().setTitle(PARTICIPANT_QUESTIONS.name).setRequired(true);
  DriveApp.getFileById(form.getId()).moveTo(folder);
  return { formId: form.getId(), formUrl: form.getPublishedUrl() };
}

function prepareParticipantForm(input) {
  if (!input || typeof input.sessionId !== 'string' || typeof input.caseId !== 'string') throw new Error('Session und Personenfall fehlen.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var context = trainerCaseContext_(tables, input.sessionId, input.caseId);
    var gate = participantAcknowledgementGate_(tables, context);
    if (!gate.allowed) throw new Error(gate.reason);
    verifyTrainerCalendar_(context, calendarBookingGet_);
    var saved = participantFormRow_(tables, input.sessionId, input.caseId);
    if (saved) {
      assertParticipantFormAssignment_(saved, context);
      FormApp.openById(saved.form_id);
      ensureParticipantFormTrigger_(saved.form_id);
      return { sessionId: input.sessionId, caseId: input.caseId,
        formUrl: saved.verified_at && saved.verified_by ? String(saved.form_url) : '',
        editUrl: 'https://docs.google.com/forms/d/' + encodeURIComponent(saved.form_id) + '/edit',
        needsVerifiedReview: !saved.verified_at || !saved.verified_by, reused: true };
    }
    var created = buildParticipantForm_(context, function (title) { return FormApp.create(title); }, findDemoFolder_());
    var sheet = findDemoSpreadsheet_().getSheetByName('ParticipantForms');
    sheet.appendRow([input.sessionId, input.caseId, context.request.request_id, context.person.person_key,
      String(context.person.email).trim().toLowerCase(), created.formId, created.formUrl,
      new Date().toISOString(), '[DEMO]', '', '']);
    SpreadsheetApp.flush();
    ensureParticipantFormTrigger_(created.formId);
    return { sessionId: input.sessionId, caseId: input.caseId, formUrl: '',
      editUrl: 'https://docs.google.com/forms/d/' + encodeURIComponent(created.formId) + '/edit',
      needsVerifiedReview: true, reused: false };
  } finally { lock.releaseLock(); }
}

/** Daniel manually inspects Google's Verified setting; FormApp cannot inspect that mode. */
function confirmParticipantVerifiedEmail(input) {
  if (!input || input.confirmation !== true || typeof input.sessionId !== 'string' || typeof input.caseId !== 'string') {
    throw new Error('Bitte die Einstellung „Verifiziert“ im Google-Formular prüfen und bestätigen.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var context = trainerCaseContext_(tables, input.sessionId, input.caseId);
    var actor = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    if (!actor || actor !== String(context.owner.email).trim().toLowerCase()) throw new Error('Nur Daniel darf die Formulareinstellung bestätigen.');
    var gate = participantAcknowledgementGate_(tables, context);
    if (!gate.allowed) throw new Error(gate.reason);
    verifyTrainerCalendar_(context, calendarBookingGet_);
    var formRow = participantFormRow_(tables, input.sessionId, input.caseId);
    if (!formRow) throw new Error('Teilnahmeformular fehlt.');
    assertParticipantFormAssignment_(formRow, context);
    var form = FormApp.openById(formRow.form_id);
    if (!form.collectsEmail()) throw new Error('Das Teilnahmeformular sammelt keine E-Mail-Adressen.');
    if (formRow.verified_at || formRow.verified_by) {
      if (!formRow.verified_at || String(formRow.verified_by).toLowerCase() !== actor) throw new Error('Widersprüchliche manuelle Verifizierung.');
      return { formUrl: String(formRow.form_url), verifiedAt: String(formRow.verified_at), verifiedBy: actor, reused: true };
    }
    var sheet = findDemoSpreadsheet_().getSheetByName('ParticipantForms');
    var rows = sheet.getDataRange().getValues();
    var index = rows.findIndex(function (row) {
      return row[0] === input.sessionId && row[1] === input.caseId && row[5] === formRow.form_id;
    });
    if (index < 1) throw new Error('Teilnahmeformular-Zeile fehlt.');
    var stamp = new Date().toISOString();
    sheet.getRange(index + 1, 10, 1, 2).setValues([[stamp, actor]]);
    SpreadsheetApp.flush();
    return { formUrl: String(formRow.form_url), verifiedAt: stamp, verifiedBy: actor, reused: false };
  } finally { lock.releaseLock(); }
}

function participantAnswers_(response) {
  var answers = {};
  response.getItemResponses().forEach(function (itemResponse) {
    var title = itemResponse.getItem().getTitle();
    if (title === PARTICIPANT_QUESTIONS.participation || title === PARTICIPANT_QUESTIONS.name) {
      if (Object.prototype.hasOwnProperty.call(answers, title)) throw new Error('Doppelte Formularfrage.');
      answers[title] = itemResponse.getResponse();
    }
  });
  if (Object.keys(answers).length !== 2) throw new Error('Teilnahmebestätigung ist unvollständig.');
  return {
    affirmative: Array.isArray(answers[PARTICIPANT_QUESTIONS.participation]) &&
      answers[PARTICIPANT_QUESTIONS.participation].length === 1 &&
      answers[PARTICIPANT_QUESTIONS.participation][0] === PARTICIPANT_AFFIRMATION,
    typedName: typeof answers[PARTICIPANT_QUESTIONS.name] === 'string' ? answers[PARTICIPANT_QUESTIONS.name].trim() : ''
  };
}

function participantAcknowledgementDecision_(context, formRow, response, existing, gate) {
  var responseId = String(response.getId() || '');
  var date = response.getTimestamp();
  var submittedAt = date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
  var email = String(response.getRespondentEmail() || '').trim().toLowerCase();
  var answers;
  try { answers = participantAnswers_(response); }
  catch (error) { answers = { affirmative: false, typedName: '' }; }
  var result = { responseId: responseId, formId: formRow.form_id,
    requestId: context.request.request_id, sessionId: context.session.session_id,
    caseId: context.personCase.case_id, personKey: context.person.person_key,
    respondentEmail: email, submittedAt: submittedAt, typedName: answers.typedName,
    affirmative: answers.affirmative, disposition: 'rejected', reason: '' };
  if (!responseId || !submittedAt) result.reason = 'Antwort-ID oder Zeitstempel fehlt.';
  else if (!formRow.verified_at || !formRow.verified_by ||
      !Number.isFinite(Date.parse(formRow.verified_at)) || Date.parse(submittedAt) < Date.parse(formRow.verified_at)) {
    result.reason = 'Antwort entstand vor der manuellen Prüfung der verifizierten E-Mail-Erfassung.';
  } else if (!email || email !== String(context.person.email).trim().toLowerCase()) result.reason = 'Falsches Google-Konto für diesen Personenfall.';
  else if (existing.some(function (row) { return row.response_id === responseId; })) {
    result.disposition = 'duplicate'; result.reason = 'Antwort wurde bereits verarbeitet.';
  } else if (existing.some(function (row) { return row.disposition === 'accepted'; })) {
    result.reason = 'Für diesen Schulungsteil liegt bereits eine gültige Teilnahmebestätigung vor.';
  } else if (!gate.allowed) result.reason = gate.reason;
  else if (Date.parse(submittedAt) < Date.parse(context.session.end_utc)) result.reason = 'Bestätigung wurde vor dem Ende des Termins eingereicht.';
  else if (Date.parse(submittedAt) < Date.parse(gate.releasedAt)) result.reason = 'Bestätigung wurde vor der Trainerfreigabe eingereicht.';
  else if (!answers.affirmative || !answers.typedName) result.reason = 'Bestätigung oder Name fehlt.';
  else result.disposition = 'accepted';
  return result;
}

function saveParticipantAttempt_(decision, sheet) {
  var values = sheet.getDataRange().getValues();
  assertHeaders_(values[0], DEMO_SCHEMA.sheets.ParticipantAcknowledgements, 'ParticipantAcknowledgements');
  if (values.slice(1).some(function (row) { return row[0] === decision.responseId && row[1] === decision.formId; })) {
    return { saved: false, decision: decision };
  }
  sheet.appendRow([decision.responseId, decision.formId, decision.requestId, decision.sessionId,
    decision.caseId, decision.personKey, decision.respondentEmail, decision.submittedAt,
    decision.typedName, decision.affirmative ? 'yes' : 'no', decision.disposition,
    decision.reason, '[DEMO]']);
  SpreadsheetApp.flush();
  return { saved: true, decision: decision };
}

function processParticipantResponse_(formId, response) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var formRow = uniqueTrainerRow_(tables.ParticipantForms, function (row) {
      return row.form_id === formId && row.demo_marker === '[DEMO]';
    }, 'Teilnahmeformular');
    var context = trainerCaseContext_(tables, formRow.session_id, formRow.case_id);
    assertParticipantFormAssignment_(formRow, context);
    var existing = tables.ParticipantAcknowledgements.filter(function (row) {
      return row.form_id === formId && row.session_id === formRow.session_id && row.case_id === formRow.case_id;
    });
    var gate = participantAcknowledgementGate_(tables, context);
    var decision = participantAcknowledgementDecision_(context, formRow, response, existing, gate);
    return saveParticipantAttempt_(decision, findDemoSpreadsheet_().getSheetByName('ParticipantAcknowledgements'));
  } finally { lock.releaseLock(); }
}

function onParticipantFormSubmit(event) {
  if (!event || !event.source || !event.response) throw new Error('Formularereignis fehlt.');
  return processParticipantResponse_(event.source.getId(), event.response);
}

function refreshParticipantAcknowledgements() {
  var tables = readDemoTables_();
  var results = [];
  tables.ParticipantForms.filter(function (row) { return row.demo_marker === '[DEMO]'; }).forEach(function (row) {
    FormApp.openById(row.form_id).getResponses().forEach(function (response) {
      results.push(processParticipantResponse_(row.form_id, response));
    });
  });
  return { processed: results.length, saved: results.filter(function (result) { return result.saved; }).length,
    rows: participantAcknowledgementQueue_() };
}

function participantAcknowledgementQueue_() {
  var tables = readDemoTables_();
  return tables.Sessions.filter(function (session) {
    return session.demo_marker === '[DEMO]' && session.status === 'invited';
  }).reduce(function (all, session) {
    tables.SessionCases.filter(function (link) {
      return link.session_id === session.session_id && link.demo_marker === '[DEMO]';
    }).forEach(function (link) {
      var context = trainerCaseContext_(tables, session.session_id, link.case_id);
      var gate = participantAcknowledgementGate_(tables, context);
      var form = participantFormRow_(tables, session.session_id, link.case_id);
      if (form) assertParticipantFormAssignment_(form, context);
      var attempts = tables.ParticipantAcknowledgements.filter(function (row) {
        return row.session_id === session.session_id && row.case_id === link.case_id && row.demo_marker === '[DEMO]';
      });
      var accepted = attempts.filter(function (row) { return row.disposition === 'accepted'; });
      if (accepted.length > 1) throw new Error('Mehrere gültige Teilnahmebestätigungen für denselben Schulungsteil.');
      var result = accepted[0];
      var rejected = attempts.filter(function (row) { return row.disposition === 'rejected'; });
      all.push({ sessionId: session.session_id, caseId: link.case_id, personAlias: String(context.person.display_alias),
        topicName: String(context.topic.display_name), phase: session.phase, endUtc: session.end_utc,
        status: result && gate.allowed ? 'acknowledged' : gate.allowed ? 'awaiting_acknowledgement' : 'awaiting_trainer',
        gateReason: gate.reason, formUrl: gate.allowed && form && form.verified_at && form.verified_by ? String(form.form_url) : '',
        formEditUrl: form ? 'https://docs.google.com/forms/d/' + encodeURIComponent(form.form_id) + '/edit' : '',
        needsVerifiedReview: !!form && (!form.verified_at || !form.verified_by),
        respondentEmail: result ? String(result.respondent_email) : '', submittedAt: result ? String(result.submitted_at) : '',
        responseId: result ? String(result.response_id) : '', typedName: result ? String(result.typed_name) : '',
        lastRejection: rejected.length ? String(rejected[rejected.length - 1].reason) : '' });
    });
    return all;
  }, []);
}

function getParticipantAcknowledgementQueue() { return participantAcknowledgementQueue_(); }
