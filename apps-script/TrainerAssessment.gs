/** Increment 07: one trainer report per invited person and required phase. */
var TRAINER_QUESTIONS = Object.freeze({
  attendance: 'War die Person bei diesem Schulungsteil anwesend?',
  assessment: 'Wie beurteilen Sie das Ergebnis dieses Schulungsteils?',
  note: 'Bemerkung / nächster Schritt',
  attestation: 'Ich bestätige diese Angaben für die genannte Person und diesen Termin.'
});

/** FormApp cannot select VERIFIED for a personal Gmail owner. The owner checks
 * the setting in Google's editor and records that manual check before use. */

function ensureTrainerFormTrigger_(formId) {
  var matches = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'onTrainerFormSubmit' && trigger.getTriggerSourceId() === formId;
  });
  if (matches.length > 1) throw new Error('Mehrere Abgabe-Trigger für dasselbe Trainerformular.');
  if (!matches.length) ScriptApp.newTrigger('onTrainerFormSubmit').forForm(formId).onFormSubmit().create();
}

function uniqueTrainerRow_(rows, predicate, label) {
  var matches = rows.filter(predicate);
  if (matches.length !== 1) throw new Error(label + ' fehlt oder ist nicht eindeutig.');
  return matches[0];
}

function trainerCaseContext_(tables, sessionId, caseId) {
  var session = uniqueTrainerRow_(tables.Sessions, function (row) {
    return row.session_id === sessionId && row.demo_marker === '[DEMO]';
  }, 'Demo-Session');
  if (session.status !== 'invited' || !session.calendar_event_id ||
      session.calendar_event_id !== bookingEventId_(session.session_id) ||
      !Number.isFinite(Date.parse(session.start_utc)) || !Number.isFinite(Date.parse(session.end_utc)) ||
      Date.parse(session.end_utc) <= Date.parse(session.start_utc)) {
    throw new Error('Für die Session fehlt eine gültige Kalendereinladung.');
  }
  var link = uniqueTrainerRow_(tables.SessionCases, function (row) {
    return row.session_id === sessionId && row.case_id === caseId && row.demo_marker === '[DEMO]';
  }, 'Zuordnung des Personenfalls');
  var personCase = uniqueTrainerRow_(tables.ParticipantCases, function (row) {
    return row.case_id === caseId && row.request_id === session.request_id &&
      row.person_key === link.person_key && row.demo_marker === '[DEMO]';
  }, 'Personenfall');
  var request = uniqueTrainerRow_(tables.Requests, function (row) {
    return row.request_id === session.request_id && row.demo_marker === '[DEMO]';
  }, 'Demo-Auftrag');
  var topic = uniqueTrainerRow_(tables.Topics, function (row) {
    return row.topic_id === request.topic_id && row.demo_marker === '[DEMO]';
  }, 'Demo-Thema');
  var trainer = uniqueTrainerRow_(tables.People, function (row) {
    return row.person_key === session.trainer_key && row.demo_marker === '[DEMO]';
  }, 'Zugewiesene schulende Person');
  var owner = uniqueTrainerRow_(tables.People, function (row) {
    return row.person_key === 'MATT' && row.demo_marker === '[DEMO]';
  }, 'Demo-Administration');
  var person = uniqueTrainerRow_(tables.People, function (row) {
    return row.person_key === personCase.person_key && row.demo_marker === '[DEMO]';
  }, 'Teilnehmende Person');
  if (session.mode === 'group' && session.trainer_key !== 'MATT') throw new Error('Gruppentrainer muss Daniel sein.');
  if (session.phase !== 'theory' && session.phase !== 'practice') throw new Error('Unbekannter Schulungsteil.');
  if (!String(trainer.email).trim() || !String(person.email).trim()) throw new Error('Konto für den Schulungsteil fehlt.');
  return { session: session, link: link, personCase: personCase, request: request,
    topic: topic, trainer: trainer, person: person, owner: owner };
}

function verifyTrainerCalendar_(context, getEvent) {
  var event = verifiedRsvpEvent_(context.session, getEvent(context.session.calendar_event_id));
  [context.trainer.email, context.person.email].forEach(function (email) {
    var matches = (event.attendees || []).filter(function (guest) {
      return String(guest.email || '').trim().toLowerCase() === String(email).trim().toLowerCase();
    });
    if (matches.length !== 1 && !(String(event.organizer && event.organizer.email || '').toLowerCase() === String(email).toLowerCase() && matches.length === 0)) {
      throw new Error('Schulende oder teilnehmende Person fehlt in der Kalendereinladung.');
    }
  });
  return event;
}

function trainerFormTitle_(context) {
  return '[DEMO] Schulungsbeurteilung – ' + safeEventLabel_(context.topic.display_name);
}

function buildTrainerForm_(context, createForm, folder) {
  var session = context.session;
  var date = Utilities.formatDate(new Date(session.start_utc), SLOT_TIME_ZONE, 'dd.MM.yyyy HH:mm');
  var end = Utilities.formatDate(new Date(session.end_utc), SLOT_TIME_ZONE, 'HH:mm');
  var form = createForm(trainerFormTitle_(context));
  form.setDescription([
    '[DEMO] Nur die zugewiesene schulende Person darf diesen Bericht einreichen.',
    'Thema: ' + context.topic.display_name + ' · Teil: ' + (session.phase === 'theory' ? 'Theorie' : 'Praxis'),
    'Termin: ' + date + '–' + end + ' Europe/Zurich',
    'Teilnehmende Person: ' + context.person.display_alias,
    'Auftrag: ' + session.request_id + ' · Termin: ' + session.session_id + ' · Fall: ' + context.personCase.case_id
  ].join('\n'));
  form.setCollectEmail(true);
  form.setAllowResponseEdits(false);
  form.setConfirmationMessage('Ihre Beurteilung wurde für diesen DEMO-Fall erfasst. Korrekturen melden Sie bitte an Daniel unter Angabe der Auftrags- und Termin-ID.');
  form.addMultipleChoiceItem().setTitle(TRAINER_QUESTIONS.attendance).setChoiceValues(['Ja, anwesend', 'Nein, abwesend']).setRequired(true);
  form.addMultipleChoiceItem().setTitle(TRAINER_QUESTIONS.assessment).setChoiceValues(['Bestanden', 'Nachschulung nötig', 'Nicht beurteilt']).setRequired(true);
  form.addParagraphTextItem().setTitle(TRAINER_QUESTIONS.note).setHelpText('Bei Abwesenheit, Nachschulung oder fehlender Beurteilung ist ein nächster Schritt erforderlich.');
  form.addCheckboxItem().setTitle(TRAINER_QUESTIONS.attestation).setChoiceValues(['Ja']).setRequired(true);
  var file = DriveApp.getFileById(form.getId());
  file.moveTo(folder);
  return { formId: form.getId(), formUrl: form.getPublishedUrl() };
}

function trainerFormRow_(tables, sessionId, caseId) {
  var matches = tables.TrainerForms.filter(function (row) { return row.session_id === sessionId && row.case_id === caseId; });
  if (matches.length > 1) throw new Error('Mehrere Trainerformulare für diesen Fall.');
  return matches.length ? matches[0] : null;
}

/** Preparing a link does not report attendance. Daniel can share it after training. */
function prepareTrainerForm(input) {
  if (!input || typeof input.sessionId !== 'string' || typeof input.caseId !== 'string') throw new Error('Session und Personenfall fehlen.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var context = trainerCaseContext_(tables, input.sessionId, input.caseId);
    verifyTrainerCalendar_(context, calendarBookingGet_);
    var saved = trainerFormRow_(tables, input.sessionId, input.caseId);
    var sheet = findDemoSpreadsheet_().getSheetByName('TrainerForms');
    if (saved) {
      if (saved.demo_marker !== '[DEMO]' || saved.person_key !== context.person.person_key ||
          saved.trainer_key !== context.trainer.person_key ||
          String(saved.trainer_email).toLowerCase() !== String(context.trainer.email).toLowerCase()) {
        throw new Error('Gespeichertes Trainerformular widerspricht der Zuweisung.');
      }
      FormApp.openById(saved.form_id);
      ensureTrainerFormTrigger_(saved.form_id);
      return { sessionId: input.sessionId, caseId: input.caseId,
        formUrl: saved.verified_at && saved.verified_by ? saved.form_url : '',
        editUrl: 'https://docs.google.com/forms/d/' + encodeURIComponent(saved.form_id) + '/edit',
        needsVerifiedReview: !saved.verified_at || !saved.verified_by, reused: true };
    }
    var created = buildTrainerForm_(context, function (title) { return FormApp.create(title); }, findDemoFolder_());
    sheet.appendRow([input.sessionId, input.caseId, context.person.person_key, context.trainer.person_key,
      String(context.trainer.email).trim().toLowerCase(), created.formId, created.formUrl, new Date().toISOString(), '[DEMO]', '', '']);
    SpreadsheetApp.flush();
    ensureTrainerFormTrigger_(created.formId);
    return { sessionId: input.sessionId, caseId: input.caseId, formUrl: '',
      editUrl: 'https://docs.google.com/forms/d/' + encodeURIComponent(created.formId) + '/edit',
      needsVerifiedReview: true, reused: false };
  } finally { lock.releaseLock(); }
}

/** Explicit owner attestation after inspecting Google Form Settings > Responses. */
function confirmTrainerVerifiedEmail(input) {
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
    verifyTrainerCalendar_(context, calendarBookingGet_);
    var formRow = trainerFormRow_(tables, input.sessionId, input.caseId);
    if (!formRow || formRow.demo_marker !== '[DEMO]' || formRow.person_key !== context.person.person_key ||
        formRow.trainer_key !== context.trainer.person_key) throw new Error('Trainerformular passt nicht zum Personenfall.');
    var form = FormApp.openById(formRow.form_id);
    if (!form.collectsEmail()) throw new Error('Das Trainerformular sammelt keine E-Mail-Adressen.');
    if (formRow.verified_at || formRow.verified_by) {
      if (!formRow.verified_at || String(formRow.verified_by).toLowerCase() !== actor) throw new Error('Widersprüchliche manuelle Verifizierung.');
      return { formUrl: String(formRow.form_url), verifiedAt: String(formRow.verified_at), verifiedBy: actor, reused: true };
    }
    var sheet = findDemoSpreadsheet_().getSheetByName('TrainerForms');
    var rows = sheet.getDataRange().getValues();
    var index = rows.findIndex(function (row) { return row[0] === input.sessionId && row[1] === input.caseId && row[5] === formRow.form_id; });
    if (index < 1) throw new Error('Trainerformular-Zeile fehlt.');
    var stamp = new Date().toISOString();
    sheet.getRange(index + 1, 10, 1, 2).setValues([[stamp, actor]]);
    SpreadsheetApp.flush();
    return { formUrl: String(formRow.form_url), verifiedAt: stamp, verifiedBy: actor, reused: false };
  } finally { lock.releaseLock(); }
}

function trainerAnswers_(response) {
  var answers = {};
  response.getItemResponses().forEach(function (itemResponse) {
    var title = itemResponse.getItem().getTitle();
    if (Object.keys(TRAINER_QUESTIONS).some(function (key) { return TRAINER_QUESTIONS[key] === title; })) {
      if (Object.prototype.hasOwnProperty.call(answers, title)) throw new Error('Doppelte Formularfrage.');
      answers[title] = itemResponse.getResponse();
    }
  });
  if (Object.keys(answers).length !== 4) throw new Error('Trainerbericht ist unvollständig.');
  return {
    attendance: answers[TRAINER_QUESTIONS.attendance] === 'Ja, anwesend' ? 'attended' :
      answers[TRAINER_QUESTIONS.attendance] === 'Nein, abwesend' ? 'absent' : '',
    assessment: answers[TRAINER_QUESTIONS.assessment] === 'Bestanden' ? 'passed' :
      answers[TRAINER_QUESTIONS.assessment] === 'Nachschulung nötig' ? 'needs_follow_up' :
      answers[TRAINER_QUESTIONS.assessment] === 'Nicht beurteilt' ? 'not_assessed' : '',
    note: String(answers[TRAINER_QUESTIONS.note] || '').trim(),
    attestation: Array.isArray(answers[TRAINER_QUESTIONS.attestation]) &&
      answers[TRAINER_QUESTIONS.attestation].length === 1 && answers[TRAINER_QUESTIONS.attestation][0] === 'Ja'
  };
}

function trainerAssessmentDecision_(context, formRow, response, existing, getEvent) {
  var responseId = String(response.getId() || '');
  var date = response.getTimestamp();
  var submittedAt = date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
  var reporter = String(response.getRespondentEmail() || '').trim().toLowerCase();
  var answers;
  try { answers = trainerAnswers_(response); }
  catch (error) { answers = { attendance: '', assessment: '', note: '', attestation: false }; }
  var result = { responseId: responseId, formId: formRow.form_id, sessionId: context.session.session_id,
    caseId: context.personCase.case_id, personKey: context.person.person_key,
    reporterEmail: reporter, submittedAt: submittedAt, attendance: answers.attendance,
    assessment: answers.assessment, note: answers.note, attestation: answers.attestation,
    disposition: 'rejected', reason: '' };
  if (!responseId || !submittedAt) result.reason = 'Antwort-ID oder Zeitstempel fehlt.';
  else if (!reporter || reporter !== String(context.trainer.email).trim().toLowerCase()) result.reason = 'Falsches Google-Konto für die schulende Person.';
  else if (!formRow.verified_at || !formRow.verified_by ||
      Date.parse(submittedAt) < Date.parse(formRow.verified_at)) result.reason = 'Antwort entstand vor der manuellen Prüfung der verifizierten E-Mail-Erfassung.';
  else if (Date.parse(submittedAt) < Date.parse(context.session.end_utc)) result.reason = 'Bericht wurde vor dem Ende des Termins eingereicht.';
  else if (existing.some(function (row) { return row.response_id === responseId; })) { result.disposition = 'duplicate'; result.reason = 'Antwort wurde bereits verarbeitet.'; }
  else if (existing.some(function (row) { return row.disposition === 'accepted'; })) result.reason = 'Für diesen Fall liegt bereits eine gültige Beurteilung vor; Korrektur über Daniel.';
  else if (answers.attendance !== 'attended' && answers.attendance !== 'absent' ||
      ['passed', 'needs_follow_up', 'not_assessed'].indexOf(answers.assessment) < 0 || !answers.attestation) {
    result.reason = 'Anwesenheit, Ergebnis oder Bestätigung fehlt.';
  } else if (answers.attendance === 'absent' && answers.assessment === 'passed') result.reason = 'Abwesend und bestanden ist widersprüchlich.';
  else if ((answers.attendance !== 'attended' || answers.assessment !== 'passed') && !answers.note) result.reason = 'Bei offenem Ergebnis ist ein nächster Schritt erforderlich.';
  else {
    try { verifyTrainerCalendar_(context, getEvent); result.disposition = 'accepted'; }
    catch (error) { result.reason = 'Kalendereinladung konnte nicht verifiziert werden: ' + String(error.message || error); }
  }
  return result;
}

function saveTrainerAttempt_(decision, sheet) {
  var values = sheet.getDataRange().getValues();
  assertHeaders_(values[0], DEMO_SCHEMA.sheets.TrainerAssessments, 'TrainerAssessments');
  if (values.slice(1).some(function (row) { return row[0] === decision.responseId && row[1] === decision.formId; })) return { saved: false, decision: decision };
  sheet.appendRow([decision.responseId, decision.formId, decision.sessionId, decision.caseId, decision.personKey,
    decision.reporterEmail, decision.submittedAt, decision.attendance, decision.assessment,
    decision.note, decision.attestation ? 'yes' : 'no', decision.disposition, decision.reason, '[DEMO]']);
  SpreadsheetApp.flush();
  return { saved: true, decision: decision };
}

function processTrainerResponse_(formId, response) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var formRow = uniqueTrainerRow_(tables.TrainerForms, function (row) {
      return row.form_id === formId && row.demo_marker === '[DEMO]';
    }, 'Trainerformular');
    var context = trainerCaseContext_(tables, formRow.session_id, formRow.case_id);
    if (formRow.person_key !== context.person.person_key || formRow.trainer_key !== context.trainer.person_key ||
        String(formRow.trainer_email).trim().toLowerCase() !== String(context.trainer.email).trim().toLowerCase()) {
      throw new Error('Trainerformular und Fallzuweisung stimmen nicht überein.');
    }
    var existing = tables.TrainerAssessments.filter(function (row) {
      return row.form_id === formId && row.session_id === formRow.session_id && row.case_id === formRow.case_id;
    });
    var decision = trainerAssessmentDecision_(context, formRow, response, existing, calendarBookingGet_);
    return saveTrainerAttempt_(decision, findDemoSpreadsheet_().getSheetByName('TrainerAssessments'));
  } finally { lock.releaseLock(); }
}

function onTrainerFormSubmit(event) {
  if (!event || !event.source || !event.response) throw new Error('Formularereignis fehlt.');
  return processTrainerResponse_(event.source.getId(), event.response);
}

/** Replay retained raw Form responses if a submission trigger was interrupted. */
function refreshTrainerAssessments() {
  var tables = readDemoTables_();
  var results = [];
  tables.TrainerForms.filter(function (row) { return row.demo_marker === '[DEMO]'; }).forEach(function (row) {
    FormApp.openById(row.form_id).getResponses().forEach(function (response) {
      results.push(processTrainerResponse_(row.form_id, response));
    });
  });
  return { processed: results.length, saved: results.filter(function (result) { return result.saved; }).length,
    rows: trainerAssessmentQueue_() };
}

function trainerAssessmentQueue_() {
  var tables = readDemoTables_();
  return tables.Sessions.filter(function (session) { return session.demo_marker === '[DEMO]' && session.status === 'invited'; }).reduce(function (all, session) {
    tables.SessionCases.filter(function (link) { return link.session_id === session.session_id && link.demo_marker === '[DEMO]'; }).forEach(function (link) {
      var context = trainerCaseContext_(tables, session.session_id, link.case_id);
      var form = trainerFormRow_(tables, session.session_id, link.case_id);
      var accepted = tables.TrainerAssessments.filter(function (row) {
        return row.session_id === session.session_id && row.case_id === link.case_id && row.disposition === 'accepted';
      });
      if (accepted.length > 1) throw new Error('Mehrere gültige Trainerberichte für denselben Fall.');
      var result = accepted[0];
      all.push({ sessionId: session.session_id, caseId: link.case_id, personAlias: String(context.person.display_alias),
        topicName: String(context.topic.display_name), phase: session.phase, trainerAlias: String(context.trainer.display_alias),
        endUtc: session.end_utc, formUrl: form && form.verified_at && form.verified_by ? String(form.form_url) : '',
        formEditUrl: form ? 'https://docs.google.com/forms/d/' + encodeURIComponent(form.form_id) + '/edit' : '',
        needsVerifiedReview: !!form && (!form.verified_at || !form.verified_by),
        status: result ? result.attendance === 'attended' && result.assessment === 'passed' ? 'awaiting_acknowledgement' : 'open' : 'awaiting_trainer',
        attendance: result ? result.attendance : '', assessment: result ? result.assessment : '',
        note: result ? String(result.note || '') : '', reporterEmail: result ? String(result.reporter_email) : '',
        submittedAt: result ? String(result.submitted_at) : '', responseId: result ? String(result.response_id) : '' });
    });
    return all;
  }, []);
}

function getTrainerAssessmentQueue() { return trainerAssessmentQueue_(); }
