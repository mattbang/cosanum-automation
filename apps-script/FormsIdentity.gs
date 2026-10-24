/** Increment 14: narrow Forms REST adapter. Never log the Apps Script OAuth token. */
var FORMS_API_BASE = 'https://forms.googleapis.com/v1/forms/';
var FORMS_API_ACTOR_PREFIX = 'forms-api:';

function formsApiRequest_(formId, method, body) {
  if (typeof formId !== 'string' || !formId.trim()) throw new Error('Formular-ID fehlt.');
  var url = FORMS_API_BASE + encodeURIComponent(formId) + (method === 'post' ? ':batchUpdate' : '');
  var options = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Accept: 'application/json' }
  };
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  var response = UrlFetchApp.fetch(url, options);
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('Forms API ' + method.toUpperCase() + ' fehlgeschlagen (HTTP ' + status + ').');
  var data;
  try { data = JSON.parse(response.getContentText()); }
  catch (error) { throw new Error('Forms API lieferte keine gültige JSON-Antwort.'); }
  if (!data || typeof data !== 'object') throw new Error('Forms API lieferte keine Formular-Daten.');
  return data;
}

function formsEmailCollectionType_(formId) {
  var form = formsApiRequest_(formId, 'get');
  if (form.formId !== formId) throw new Error('Forms API lieferte eine andere Formular-ID.');
  return String(form.settings && form.settings.emailCollectionType || '');
}

/** Updates only this setting, then makes a separate GET to confirm persisted state. */
function ensureFormsVerifiedEmail_(formId) {
  if (formsEmailCollectionType_(formId) === 'VERIFIED') return true;
  formsApiRequest_(formId, 'post', { requests: [{ updateSettings: {
    settings: { emailCollectionType: 'VERIFIED' }, updateMask: 'emailCollectionType'
  } }] });
  return formsEmailCollectionType_(formId) === 'VERIFIED';
}

function formsVerificationActor_(formRow) {
  var actor = String(formRow && formRow.verified_by || '').trim().toLowerCase();
  return actor.indexOf(FORMS_API_ACTOR_PREFIX) === 0 ? actor.slice(FORMS_API_ACTOR_PREFIX.length) : actor;
}

function formsVerificationIsApi_(formRow) {
  return String(formRow && formRow.verified_by || '').trim().toLowerCase().indexOf(FORMS_API_ACTOR_PREFIX) === 0;
}

/** A manual inspection remains valid for historical rows; API rows require a live read-back. */
function formsIdentityGate_(formRow, ownerEmail) {
  var owner = String(ownerEmail || '').trim().toLowerCase();
  if (!formRow || !formRow.form_id || !formRow.verified_at ||
      !Number.isFinite(Date.parse(String(formRow.verified_at))) ||
      !owner || formsVerificationActor_(formRow) !== owner) {
    return { allowed: false, reason: 'Verifizierte E-Mail-Erfassung ist nicht bestätigt.' };
  }
  if (formsVerificationIsApi_(formRow) && formsEmailCollectionType_(formRow.form_id) !== 'VERIFIED') {
    return { allowed: false, reason: 'Formular sammelt keine verifizierte Google-Konto-Adresse mehr.' };
  }
  return { allowed: true, reason: '' };
}

/** A REST failure leaves the existing Form pending for the owner-reviewed fallback. */
function tryAutomatedFormVerification_(sheet, formRow, ownerEmail) {
  if (formRow.verified_at || formRow.verified_by) return formRow;
  try { if (!ensureFormsVerifiedEmail_(formRow.form_id)) return formRow; }
  catch (error) { return formRow; }
  var rows = sheet.getDataRange().getValues();
  var matching = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === formRow.session_id && rows[i][1] === formRow.case_id && rows[i][5] === formRow.form_id) matching.push(i);
  }
  if (matching.length !== 1 || rows[matching[0]][9] || rows[matching[0]][10]) {
    throw new Error('Formular-Zeile für die automatische Prüfung fehlt oder ist widersprüchlich.');
  }
  var stamp = new Date().toISOString();
  var actor = FORMS_API_ACTOR_PREFIX + String(ownerEmail).trim().toLowerCase();
  sheet.getRange(matching[0] + 1, 10, 1, 2).setValues([[stamp, actor]]);
  SpreadsheetApp.flush();
  formRow.verified_at = stamp;
  formRow.verified_by = actor;
  return formRow;
}

/** REST errors in admin queues hide links; response processing throws and remains retryable. */
function formsReadyForLink_(formRow, ownerEmail) {
  try { return formsIdentityGate_(formRow, ownerEmail).allowed; }
  catch (error) { return false; }
}
