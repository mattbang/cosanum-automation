/** Owner-only application sessions, separate from the Google account session. */
var APP_SESSION_PREFIX_ = 'COS_APP_SESSION_V1_';
var APP_PREFERENCES_KEY_ = 'COS_APP_PREFERENCES_V1';
var APP_FAMILY_PREFIX_ = 'COS_APP_FAMILY_V1_';
var APP_SESSION_TTL_MS_ = 8 * 60 * 60 * 1000;
var APP_SESSION_LIMIT_ = 16;

function appSessionError_() {
  return new Error('APP_SESSION_REQUIRED: Bitte erneut anmelden.');
}

function appOwner_() {
  var fixture = getPrivateFixture_();
  validateFixture_(fixture);
  var owner = proofUnique_(fixture.People, function (row) {
    return row[0] === 'MATT' && row[3] === '[DEMO]';
  }, 'Demo-Eigentümerkonto');
  var email = proofEmail_(owner[1]);
  var effective = proofEmail_(Session.getEffectiveUser().getEmail());
  var active = proofEmail_(Session.getActiveUser().getEmail());
  if (!email || effective !== email || (active && active !== email)) {
    throw new Error('APP_ACCESS_DENIED: Dieses Konto ist für die private Schulungsdemo nicht freigegeben.');
  }
  return email;
}

function appHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function appUuid_(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

function appFamily_(hash) {
  var raw = PropertiesService.getUserProperties().getProperty(APP_FAMILY_PREFIX_ + hash);
  if (!raw) return { generation: 0, logoutIds: [] };
  var family = JSON.parse(raw);
  if (!Number.isSafeInteger(family.generation) || family.generation < 0 || !Array.isArray(family.logoutIds)) throw appSessionError_();
  return family;
}

function appTokenKey_(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw appSessionError_();
  return APP_SESSION_PREFIX_ + appHash_(token);
}

function appLocked_(operation) {
  var lock = LockService.getUserLock();
  lock.waitLock(30000);
  try { return operation(); }
  finally { lock.releaseLock(); }
}

function appReadSession_(token, email) {
  var properties = PropertiesService.getUserProperties();
  var key = appTokenKey_(token);
  var raw = properties.getProperty(key);
  if (!raw) throw appSessionError_();
  var record;
  try { record = JSON.parse(raw); } catch (_) { throw appSessionError_(); }
  if (record.email !== email || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now() ||
      record.generation !== appFamily_(record.familyHash).generation) {
    properties.deleteProperty(key);
    throw appSessionError_();
  }
  return record;
}

function appPreferences_() {
  var defaults = { density: 'comfortable', motion: 'system' };
  var raw = PropertiesService.getUserProperties().getProperty(APP_PREFERENCES_KEY_);
  if (!raw) return defaults;
  try { return appValidatedPreferences_(JSON.parse(raw)); }
  catch (_) { return defaults; }
}

function appValidatedPreferences_(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'density,motion' ||
      ['comfortable', 'compact'].indexOf(input.density) < 0 ||
      ['system', 'reduce'].indexOf(input.motion) < 0) {
    throw new Error('Bitte eine gültige Darstellung und Bewegungseinstellung wählen.');
  }
  return { density: input.density, motion: input.motion };
}

function appProfile_(email) {
  var displayName = 'Demo-Eigentümerkonto';
  var about = Drive.About.get({ fields: 'user(displayName,emailAddress)' });
  if (!about.user || proofEmail_(about.user.emailAddress) !== email) {
    throw new Error('APP_ACCESS_DENIED: Das Google-Profil stimmt nicht mit dem Eigentümerkonto überein.');
  }
  if (typeof about.user.displayName === 'string' && about.user.displayName.trim()) {
    displayName = about.user.displayName.trim().slice(0, 100);
  }
  var words = displayName.split(/\s+/).filter(Boolean);
  var initials = (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : '')).toUpperCase();
  return { displayName: displayName, email: email, initials: initials, role: 'Process & Quality' };
}

function appSessionResult_(token, record) {
  return { token: token, expiresAt: new Date(record.expiresAt).toISOString(),
    profile: record.profile, preferences: appPreferences_() };
}

function beginAppSession(input) {
  var email = appOwner_();
  if (!input || !appUuid_(input.browserId)) {
    throw new Error('Der Browser konnte keine sichere App-Sitzung vorbereiten. Bitte erneut versuchen.');
  }
  var familyHash = appHash_(input.browserId);
  var generation = appLocked_(function () { return appFamily_(familyHash).generation; });
  var profile = appProfile_(email);
  return appLocked_(function () {
    if (generation !== appFamily_(familyHash).generation) throw appSessionError_();
    var properties = PropertiesService.getUserProperties();
    var all = properties.getProperties();
    var retained = [];
    Object.keys(all).filter(function (key) { return key.indexOf(APP_SESSION_PREFIX_) === 0; }).forEach(function (key) {
      var record;
      try { record = JSON.parse(all[key]); } catch (_) { properties.deleteProperty(key); return; }
      if (record.email !== email || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
        properties.deleteProperty(key);
      } else retained.push({ key: key, issuedAt: record.issuedAt });
    });
    retained.sort(function (a, b) { return a.issuedAt - b.issuedAt; });
    while (retained.length >= APP_SESSION_LIMIT_) properties.deleteProperty(retained.shift().key);
    var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
    var record = { email: email, familyHash: familyHash, generation: generation, issuedAt: Date.now(),
      expiresAt: Date.now() + APP_SESSION_TTL_MS_, profile: profile };
    properties.setProperty(appTokenKey_(token), JSON.stringify(record));
    return appSessionResult_(token, record);
  });
}

function restoreAppSession(input) {
  var email = appOwner_();
  return appLocked_(function () {
    return appSessionResult_(input && input.token, appReadSession_(input && input.token, email));
  });
}

function endAppSession(input) {
  var email = appOwner_();
  if (!input || !appUuid_(input.browserId) || !appUuid_(input.logoutId)) throw appSessionError_();
  return appLocked_(function () {
    var familyHash = appHash_(input.browserId), family = appFamily_(familyHash);
    if (family.logoutIds.indexOf(input.logoutId) >= 0) return { signedOut: true };
    var properties = PropertiesService.getUserProperties();
    family.generation += 1;
    family.logoutIds.push(input.logoutId);
    family.logoutIds = family.logoutIds.slice(-64);
    properties.setProperty(APP_FAMILY_PREFIX_ + familyHash, JSON.stringify(family));
    var all = properties.getProperties();
    Object.keys(all).filter(function (key) { return key.indexOf(APP_SESSION_PREFIX_) === 0; }).forEach(function (key) {
      var other;
      try { other = JSON.parse(all[key]); } catch (_) { properties.deleteProperty(key); return; }
      if (other.email === email && other.familyHash === familyHash && other.generation < family.generation) properties.deleteProperty(key);
    });
    return { signedOut: true };
  });
}

function saveAppPreferences(input) {
  var email = appOwner_();
  return appLocked_(function () {
    appReadSession_(input && input.token, email);
    var preferences = appValidatedPreferences_(input && input.preferences);
    PropertiesService.getUserProperties().setProperty(APP_PREFERENCES_KEY_, JSON.stringify(preferences));
    return { preferences: preferences };
  });
}

function dispatchAppRequest(input) {
  var email = appOwner_();
  return appLocked_(function () {
    appReadSession_(input && input.token, email);
    var methods = appMethods_();
    if (!input || typeof input.method !== 'string' || !Object.prototype.hasOwnProperty.call(methods, input.method) ||
        !Array.isArray(input.args) || input.args.length > 2) {
      throw new Error('Diese App-Aktion ist nicht verfügbar.');
    }
    return methods[input.method].apply(null, input.args);
  });
}

function appMethods_() {
  return {
    getCatalogue: getCatalogue_, getOwnerResourceOverview: getOwnerResourceOverview_,
    getIntakeData: getIntakeData_, getIntakePreview: getIntakePreview_, saveDraftRequest: saveDraftRequest_,
    getPhasePlanPreview: getPhasePlanPreview_, getSavedPhasePlan: getSavedPhasePlan_, savePhasePlan: savePhasePlan_,
    checkDemoCalendarAccess: checkDemoCalendarAccess_, getSlotProposals: getSlotProposals_, bookSelectedSlot: bookSelectedSlot_,
    getRsvpStatus: getRsvpStatus_, refreshRsvpStatus: refreshRsvpStatus_,
    getTrainerAssessmentQueue: getTrainerAssessmentQueue_, prepareTrainerForm: prepareTrainerForm_,
    confirmTrainerVerifiedEmail: confirmTrainerVerifiedEmail_, refreshTrainerAssessments: refreshTrainerAssessments_,
    getParticipantAcknowledgementQueue: getParticipantAcknowledgementQueue_, prepareParticipantForm: prepareParticipantForm_,
    confirmParticipantVerifiedEmail: confirmParticipantVerifiedEmail_, refreshParticipantAcknowledgements: refreshParticipantAcknowledgements_,
    getIndividualProofQueue: getIndividualProofQueue_, createIndividualProof: createIndividualProof_,
    getAcknowledgementFollowUpQueue: getAcknowledgementFollowUpQueue_, recordAcknowledgementFollowUp: recordAcknowledgementFollowUp_,
    getSkillUpdateQueue: getSkillUpdateQueue_, applyVerifiedSkillUpdate: applyVerifiedSkillUpdate_, processVerifiedSkillUpdates: processVerifiedSkillUpdates_,
    getAuditDashboard: getAuditDashboard_, prepareDemoTourLink: prepareDemoTourLink_, getDemoFeedbackForRequest: getDemoFeedbackForRequest_
  };
}
