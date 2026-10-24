/** UX2: one feedback Form for the demo, separate from training evidence. */
var DEMO_FEEDBACK_NAME = '[DEMO] Rückmeldung zur Schulungsdemo';
var DEMO_TOUR_URL = 'https://mattbang.github.io/cosanum-automation/demo-tour/';
var DEMO_FEEDBACK_FIELDS = Object.freeze({
  request: 'Auftrags-ID', role: 'Rolle', step: 'Schritt', comment: 'Beobachtung'
});
var DEMO_FEEDBACK_ROLES = ['Process & Quality', 'Schulende Person', 'Teilnehmende Person'];
var DEMO_FEEDBACK_STEPS = ['Bedarf und Planung', 'Kalendereinladung', 'Trainerbericht',
  'Teilnahmebestätigung', 'Nachweis und Register', 'Anderer Schritt'];

function feedbackRequest_(tables, requestId) {
  if (typeof requestId !== 'string' || !/^REQ-[A-Z0-9-]{4,100}$/.test(requestId)) {
    throw new Error('Gültige Demo-Auftrags-ID fehlt.');
  }
  return proofUnique_(tables.Requests, function (row) {
    return row.request_id === requestId && row.demo_marker === '[DEMO]';
  }, 'Demo-Auftrag');
}

function feedbackFormFiles_(folder) {
  var files = folder.getFilesByName(DEMO_FEEDBACK_NAME), matches = [];
  while (files.hasNext()) {
    var file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_FORMS) matches.push(file);
  }
  if (matches.length > 1) throw new Error('Mehrere Demo-Feedbackformulare im Demo-Ordner.');
  return matches;
}

function configureFeedbackForm_(form) {
  form.setDescription('[DEMO] Beobachtungen zum Test. Keine Schulungs- oder Teilnahmebestätigung. Bitte keine personenbezogenen Angaben in das Freitextfeld schreiben.');
  form.setAllowResponseEdits(false);
  form.setCollectEmail(false);
  form.setConfirmationMessage('Danke. Die Rückmeldung wurde für den Demo-Auftrag gespeichert.');
  function existing(title) {
    var matches = form.getItems().filter(function (item) { return item.getTitle() === title; });
    if (matches.length > 1) throw new Error('Feedbackfeld ist doppelt: ' + title);
    return matches.length ? matches[0] : null;
  }
  var request = existing(DEMO_FEEDBACK_FIELDS.request);
  if (request && request.getType() !== FormApp.ItemType.TEXT) throw new Error('Falscher Typ für Auftrags-ID.');
  (request ? request.asTextItem() : form.addTextItem().setTitle(DEMO_FEEDBACK_FIELDS.request))
    .setHelpText('Aus dem Startlink übernehmen.').setRequired(true);
  [[DEMO_FEEDBACK_FIELDS.role, DEMO_FEEDBACK_ROLES], [DEMO_FEEDBACK_FIELDS.step, DEMO_FEEDBACK_STEPS]].forEach(function (field) {
    var item = existing(field[0]);
    if (item && item.getType() !== FormApp.ItemType.LIST) throw new Error('Falscher Typ für ' + field[0]);
    (item ? item.asListItem() : form.addListItem().setTitle(field[0]))
      .setChoiceValues(field[1]).setRequired(true);
  });
  var comment = existing(DEMO_FEEDBACK_FIELDS.comment);
  if (comment && comment.getType() !== FormApp.ItemType.PARAGRAPH_TEXT) throw new Error('Falscher Typ für Beobachtung.');
  (comment ? comment.asParagraphTextItem() : form.addParagraphTextItem().setTitle(DEMO_FEEDBACK_FIELDS.comment))
    .setRequired(true);
}

function feedbackForm_(create) {
  var folder = findDemoFolder_();
  if (!folder) throw new Error('Demo-Ordner fehlt.');
  var matches = feedbackFormFiles_(folder);
  var orphans = feedbackFormFiles_(DriveApp.getRootFolder());
  if (matches.length && orphans.length) throw new Error('Feedbackformular liegt doppelt im Demo-Ordner und Drive-Stamm.');
  if (matches.length) {
    var saved = FormApp.openById(matches[0].getId());
    if (create) configureFeedbackForm_(saved);
    return saved;
  }
  if (!create) return null;
  // FormApp.create first places the Form in My Drive. A failed move is recovered here on retry.
  var form = orphans.length ? FormApp.openById(orphans[0].getId()) : FormApp.create(DEMO_FEEDBACK_NAME);
  configureFeedbackForm_(form);
  DriveApp.getFileById(form.getId()).moveTo(folder);
  return form;
}

function feedbackItem_(form, title) {
  return proofUnique_(form.getItems(), function (item) { return item.getTitle() === title; }, title);
}

/** Explicit owner action. Returning a URL never creates a training request or response. */
function prepareDemoTourLink(input) {
  var tables = readDemoTables_();
  auditOwner_(tables);
  var request = feedbackRequest_(tables, input && input.requestId);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var form = feedbackForm_(true);
    var requestItem = feedbackItem_(form, DEMO_FEEDBACK_FIELDS.request).asTextItem();
    var prefilled = form.createResponse().withItemResponse(requestItem.createResponse(request.request_id)).toPrefilledUrl();
    var scenario = request.mode === 'individual' ? 'individual' : 'group';
    var url = DEMO_TOUR_URL + '?request=' + encodeURIComponent(request.request_id) +
      '&scenario=' + encodeURIComponent(scenario) + '&feedback=' + encodeURIComponent(prefilled);
    return { requestId: request.request_id, url: url, feedbackUrl: prefilled, formId: form.getId() };
  } finally { lock.releaseLock(); }
}

/** Read-only owner lookup. Form responses are feedback, never training evidence. */
function getDemoFeedbackForRequest(input) {
  var tables = readDemoTables_();
  auditOwner_(tables);
  var request = feedbackRequest_(tables, input && input.requestId);
  var form = feedbackForm_(false);
  if (!form) return { requestId: request.request_id, rows: [] };
  var rows = form.getResponses().map(function (response) {
    var fields = {};
    response.getItemResponses().forEach(function (itemResponse) {
      fields[itemResponse.getItem().getTitle()] = String(itemResponse.getResponse() || '');
    });
    return { requestId: fields[DEMO_FEEDBACK_FIELDS.request] || '',
      role: fields[DEMO_FEEDBACK_FIELDS.role] || '', step: fields[DEMO_FEEDBACK_FIELDS.step] || '',
      comment: fields[DEMO_FEEDBACK_FIELDS.comment] || '',
      submittedAt: response.getTimestamp().toISOString() };
  }).filter(function (row) {
    return row.requestId === request.request_id && DEMO_FEEDBACK_ROLES.indexOf(row.role) >= 0 &&
      DEMO_FEEDBACK_STEPS.indexOf(row.step) >= 0 && !!row.comment.trim();
  }).sort(function (a, b) { return a.submittedAt.localeCompare(b.submittedAt); });
  return { requestId: request.request_id, rows: rows };
}
