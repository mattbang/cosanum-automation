import { acknowledgementReady, apiRequest, invitationUrlWithoutSecret, missingAcknowledgementFacts, readConfig, readInvitation } from './core.js';

const configValue = window.COSANUM_PARTICIPANT_CONFIG || {};
const elements = Object.fromEntries(['notice', 'error', 'case-id', 'identity-status', 'sign-in', 'google-button', 'case-view', 'case-heading', 'case-status', 'case-details', 'action-state', 'complete-action'].map(id => [id, document.getElementById(id)]));
const invite = readInvitation(window.location.href);
let config;
let linkToken = invite.linkToken;
let bearerToken = '';
let snapshot;
let actionAttemptKey = '';

function show(element, message) { element.textContent = message; element.hidden = !message; }
function clearError() { show(elements.error, ''); }
function labelStatus(value) {
  const labels = { open: 'Offen', planning: 'In Planung', invited: 'Eingeladen', assessed: 'Beurteilt', acknowledged: 'Bestätigt', proof_ready: 'Nachweis bereit', archived_verified: 'Archiv geprüft', complete: 'Abgeschlossen' };
  return labels[value] || value || 'Status ausstehend';
}
function factLabel(key) {
  return ({ assignedParticipant: 'Zuordnung bestätigt', participantFormVerified: 'Teilnahmeformular geprüft', trainerPass: 'Trainerbeurteilung bestanden', answeredYes: 'Teilnahme bestätigt' })[key] || key;
}
function details(snapshotValue) {
  elements['case-details'].replaceChildren();
  const attrs = snapshotValue.attributes || {};
  const state = snapshotValue.state || {};
  const rows = [
    ['Fall', snapshotValue.scope?.caseId || invite.caseId],
    ['Termin', snapshotValue.scope?.sessionId || 'Noch nicht zugeordnet'],
    ['Thema', attrs.topicName || attrs.topicId || state.topicName || 'Wird vom Schulungsdienst bereitgestellt'],
    ['Terminstatus', labelStatus(snapshotValue.session?.status)],
    ['Zuletzt gespeicherter Stand', `Version ${snapshotValue.revision || 'unbekannt'}`],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = String(value);
    elements['case-details'].append(dt, dd);
  }
}

function renderCase(value) {
  snapshot = value;
  elements['case-view'].hidden = false;
  elements['case-status'].textContent = labelStatus(value.status);
  elements['case-heading'].textContent = value.status === 'acknowledged' || value.status === 'complete' ? 'Ihre Aufgabe ist bestätigt' : 'Ihre Schulungsaufgabe';
  details(value);
  elements['complete-action'].hidden = true;
  if (value.status === 'acknowledged' || value.status === 'complete') {
    show(elements['action-state'], 'Der Schulungsdienst meldet diesen Fall als bestätigt.');
  } else if (acknowledgementReady(value)) {
    show(elements['action-state'], 'Der Server hat Zuordnung, Formular, bestandene Trainerbeurteilung und affirmative Teilnahme bereits geprüft. Sie können die serverseitige Verarbeitung jetzt auslösen.');
    elements['complete-action'].hidden = false;
  } else {
    const missing = missingAcknowledgementFacts(value).map(factLabel).join(', ');
    show(elements['action-state'], `Noch ausstehend: ${missing}. Diese Seite erzeugt keine Teilnahmeantwort und ergänzt keine Nachweise. Die Antwort muss zuerst über den dafür vorgesehenen, servergeprüften Prozess erfasst werden.`);
  }
}

async function loadCase() {
  if (!invite.caseId) throw new Error('In diesem Einladungslink fehlt eine gültige Fallnummer.');
  const value = await apiRequest(configValue, `/cases/${encodeURIComponent(invite.caseId)}`, bearerToken);
  renderCase(value);
}

async function acceptGoogleCredential(credential) {
  clearError();
  elements['sign-in'].disabled = true;
  elements['identity-status'].textContent = 'Verifiziertes Konto wird geprüft …';
  try {
    if (linkToken) {
      await apiRequest(configValue, '/participant-links/claim', credential, {
        method: 'POST', body: JSON.stringify({ linkToken }),
      });
      linkToken = '';
      window.history.replaceState({}, '', invitationUrlWithoutSecret(window.location.href));
    }
    bearerToken = credential;
    await loadCase();
    elements['identity-status'].textContent = 'Anmeldung geprüft. Fallinformationen stammen vom Schulungsdienst.';
    elements['sign-in'].hidden = true;
    elements['google-button'].hidden = true;
    show(elements.notice, 'Ihre Identität und Fallzuordnung wurden vom Dienst geprüft.');
  } catch (error) {
    elements['identity-status'].textContent = 'Die Anmeldung konnte nicht abgeschlossen werden.';
    show(elements.error, error.message || 'Die Anmeldung konnte nicht abgeschlossen werden.');
  } finally {
    elements['sign-in'].disabled = false;
  }
}

function loadGoogleIdentity() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Der Anmeldedienst konnte nicht geladen werden.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Der Anmeldedienst konnte nicht geladen werden.'));
    document.head.append(script);
  });
}

async function signIn() {
  clearError();
  if (!config.googleClientId || config.identityProvider !== 'google') {
    show(elements.error, 'Die Anmeldung ist noch nicht konfiguriert. Der Dienst gibt ohne verifizierten Identitätsanbieter keinen Zugriff frei.');
    return;
  }
  try {
    await loadGoogleIdentity();
    window.google.accounts.id.initialize({ client_id: config.googleClientId, callback: ({ credential }) => {
      if (!credential) { show(elements.error, 'Google hat kein verifiziertes Anmeldetoken geliefert.'); return; }
      void acceptGoogleCredential(credential);
    } });
    elements['google-button'].hidden = false;
    elements['sign-in'].hidden = true;
    window.google.accounts.id.renderButton(elements['google-button'], { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', locale: 'de' });
    elements['identity-status'].textContent = 'Wählen Sie das für die Einladung bestimmte Google-Konto.';
  } catch (error) {
    show(elements.error, error.message || 'Der Anmeldedienst konnte nicht geladen werden.');
  }
}

async function processAction() {
  clearError();
  if (!acknowledgementReady(snapshot)) return;
  elements['complete-action'].disabled = true;
  elements['action-state'].textContent = 'Die serverseitige Verarbeitung läuft …';
  if (!actionAttemptKey) actionAttemptKey = crypto.randomUUID();
  try {
    const result = await apiRequest(configValue, '/actions', bearerToken, {
      method: 'POST',
      body: JSON.stringify({ actionId: 'acceptParticipantAcknowledgement', caseId: invite.caseId, idempotencyKey: actionAttemptKey, payload: {} }),
    });
    const latest = await apiRequest(configValue, `/cases/${encodeURIComponent(invite.caseId)}`, bearerToken);
    if (latest.revision !== result.revision || latest.status !== 'acknowledged')
      throw new Error('Der neue Serverstand konnte noch nicht eindeutig bestätigt werden. Bitte laden Sie den Fall neu.');
    actionAttemptKey = '';
    renderCase(latest);
    show(elements.notice, 'Der Schulungsdienst hat die Verarbeitung mit einer neuen Fallversion bestätigt.');
  } catch (error) {
    show(elements['action-state'], error.message || 'Die Verarbeitung ist noch ausstehend.');
    show(elements.error, error.message || 'Die Verarbeitung konnte nicht abgeschlossen werden.');
  } finally {
    elements['complete-action'].disabled = false;
  }
}

elements['case-id'].textContent = invite.caseId || 'Keine gültige Fallnummer im Link';
elements['sign-in'].addEventListener('click', () => void signIn());
elements['complete-action'].addEventListener('click', () => void processAction());
try {
  config = readConfig(configValue);
  if (!invite.caseId) throw new Error('In diesem Einladungslink fehlt eine gültige Fallnummer.');
  if (new URL(window.location.href).searchParams.has('link') || new URL(window.location.href).searchParams.has('linkToken'))
    window.history.replaceState({}, '', invitationUrlWithoutSecret(window.location.href));
  if (!config.googleClientId) {
    elements['sign-in'].disabled = true;
    elements['sign-in'].textContent = 'Anmeldung noch nicht konfiguriert';
    show(elements.notice, 'Der Identitätsanbieter ist noch nicht konfiguriert. Ohne bestätigte Anmeldung bleibt der Fall geschützt.');
  }
} catch (error) {
  elements['sign-in'].disabled = true;
  elements['sign-in'].textContent = 'Dienst noch nicht verfügbar';
  show(elements.error, error.message || 'Die Teilnehmeransicht ist noch nicht konfiguriert.');
}
