import { apiRequest, invitationUrlWithoutSecret, participantResponseReady, readConfig, readInvitation } from './core.js';

const configValue = window.COSANUM_PARTICIPANT_CONFIG || {};
const elements = Object.fromEntries(['notice', 'error', 'case-id', 'identity-status', 'sign-in', 'google-button', 'case-view', 'case-heading', 'case-status', 'case-details', 'action-state', 'participant-response', 'answer-yes', 'typed-name', 'submit-response'].map(id => [id, document.getElementById(id)]));
const invite = readInvitation(window.location.href);
const initialUrl = new URL(window.location.href);
let config;
let linkToken = invite.linkToken;
let bearerToken = '';
let snapshot;
let claimedActorKey = '';
let responseAttempt;

// Strip the invitation fragment (and any legacy query secret) before config checks or network loads.
if (initialUrl.hash || initialUrl.searchParams.has('link') || initialUrl.searchParams.has('linkToken'))
  window.history.replaceState({}, '', invitationUrlWithoutSecret(window.location.href));

function show(element, message) { element.textContent = message; element.hidden = !message; }
function clearError() { show(elements.error, ''); }
function labelStatus(value) {
  const labels = { open: 'Offen', planning: 'In Planung', invited: 'Eingeladen', assessed: 'Beurteilt', acknowledged: 'Bestätigt', proof_ready: 'Nachweis bereit', archived_verified: 'Archiv geprüft', complete: 'Abgeschlossen' };
  return labels[value] || value || 'Status ausstehend';
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
  const acknowledged = value.status === 'acknowledged' || value.status === 'complete';
  elements['case-heading'].textContent = acknowledged ? 'Ihre Aufgabe ist bestätigt' : 'Ihre Schulungsaufgabe';
  details(value);
  elements['participant-response'].hidden = true;
  elements['answer-yes'].disabled = false;
  elements['typed-name'].disabled = false;
  elements['submit-response'].disabled = false;
  elements['submit-response'].textContent = 'Teilnahmebestätigung übermitteln';
  if (acknowledged) {
    show(elements['action-state'], value.status === 'complete'
      ? 'Der Schulungsdienst meldet diesen Fall als abgeschlossen.'
      : 'Der Schulungsdienst meldet Ihre Teilnahmebestätigung als gespeichert.');
  } else if (!claimedActorKey) {
    show(elements['action-state'], 'Öffnen Sie den ursprünglichen Einladungslink, damit der Server die Einladung mit Ihrem verifizierten Konto verbinden kann.');
  } else if (claimedActorKey !== value.personKey) {
    show(elements['action-state'], 'Die Einladung und die angezeigte Person stimmen nicht überein. Die Bestätigung bleibt gesperrt.');
  } else if (value.evidence?.facts?.trainerPass !== true) {
    show(elements['action-state'], 'Die bestandene Trainerbeurteilung ist im aktuellen Serverstand noch nicht bestätigt. Sie können Ihre Teilnahme erst danach bestätigen.');
  } else if (participantResponseReady(value, true)) {
    show(elements['action-state'], 'Bitte bestätigen Sie nur Ihre eigene Teilnahme. Ihre Antwort und Ihr eingegebener Name werden vom Server geprüft und gespeichert.');
    elements['participant-response'].hidden = false;
  } else {
    show(elements['action-state'], 'Für diesen Fall ist derzeit keine Teilnahmebestätigung möglich. Bitte wenden Sie sich an die zuständige Stelle.');
  }
}

async function fetchCase() {
  if (!invite.caseId) throw new Error('In diesem Einladungslink fehlt eine gültige Fallnummer.');
  const value = await apiRequest(configValue, `/cases/${encodeURIComponent(invite.caseId)}`, bearerToken);
  if (claimedActorKey && value.personKey !== claimedActorKey)
    throw new Error('Die Einladung und der zugeordnete Fall stimmen nicht überein.');
  return value;
}

async function loadCase() { renderCase(await fetchCase()); }

async function acceptGoogleCredential(credential) {
  clearError();
  elements['sign-in'].disabled = true;
  elements['identity-status'].textContent = 'Verifiziertes Konto wird geprüft …';
  try {
    if (linkToken) {
      const claim = await apiRequest(configValue, '/participant-links/claim', credential, {
        method: 'POST', body: JSON.stringify({ linkToken }),
      });
      if (claim.role !== 'assigned_participant' || typeof claim.actorKey !== 'string' || !claim.actorKey)
        throw new Error('Die Einladung ist keinem teilnehmenden Konto zugeordnet.');
      claimedActorKey = claim.actorKey;
      linkToken = '';
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

async function submitResponse(event) {
  event.preventDefault();
  clearError();
  if (!participantResponseReady(snapshot, Boolean(claimedActorKey))) return;
  const typedName = elements['typed-name'].value.trim();
  if (!typedName || typedName.length > 200) {
    elements['typed-name'].setCustomValidity('Bitte geben Sie Ihren Vor- und Nachnamen ein (maximal 200 Zeichen).');
    elements['typed-name'].reportValidity();
    return;
  }
  elements['typed-name'].setCustomValidity('');
  const payload = { caseId: invite.caseId, answer: 'yes', typedName };
  if (!responseAttempt) responseAttempt = { idempotencyKey: crypto.randomUUID(), payload };
  if (JSON.stringify(responseAttempt.payload) !== JSON.stringify(payload)) {
    show(elements.error, 'Für eine sichere Wiederholung muss dieselbe Antwort verwendet werden. Bitte laden Sie die ursprüngliche Einladung erneut.');
    return;
  }
  elements['answer-yes'].disabled = true;
  elements['typed-name'].disabled = true;
  elements['submit-response'].disabled = true;
  elements['submit-response'].textContent = 'Wird übermittelt …';
  show(elements['action-state'], 'Ihre Antwort wird serverseitig geprüft …');
  try {
    const receipt = await apiRequest(configValue, '/participant-responses', bearerToken, {
      method: 'POST',
      body: JSON.stringify({ ...responseAttempt.payload, idempotencyKey: responseAttempt.idempotencyKey }),
    });
    if (receipt.status !== 'verified' || receipt.actionId !== 'acceptParticipantAcknowledgement' ||
        receipt.caseId !== invite.caseId || typeof receipt.responseId !== 'string' || !receipt.responseId || typeof receipt.revision !== 'string')
      throw new Error('Der Dienst hat keine gültige Bestätigung der gespeicherten Antwort geliefert.');
    const latest = await fetchCase();
    if (latest.revision !== receipt.revision || latest.status !== 'acknowledged')
      throw new Error('Die Antwort wurde quittiert, aber der neue Fallstand konnte nicht eindeutig zurückgelesen werden. Bitte laden Sie den Fall neu.');
    responseAttempt = undefined;
    renderCase(latest);
    show(elements.notice, 'Der Schulungsdienst hat Ihre Teilnahmebestätigung gespeichert und den Fallstand zurückgelesen.');
  } catch (error) {
    show(elements['action-state'], error.message || 'Die Antwort ist noch nicht bestätigt.');
    show(elements.error, error.message || 'Die Antwort konnte nicht bestätigt werden.');
    const retryable = !error.status || error.status === 503;
    elements['answer-yes'].disabled = true;
    elements['typed-name'].disabled = true;
    elements['submit-response'].disabled = !retryable;
    elements['submit-response'].textContent = retryable ? 'Mit derselben Antwort erneut versuchen' : 'Erneutes Senden gesperrt';
  }
}

elements['case-id'].textContent = invite.caseId || 'Keine gültige Fallnummer im Link';
elements['sign-in'].addEventListener('click', () => void signIn());
elements['participant-response'].addEventListener('submit', event => void submitResponse(event));

try {
  if (invite.insecureQueryToken) throw new Error('Der Einladungslink ist nicht sicher formatiert. Öffnen Sie den Link erneut aus der Einladungs-E-Mail.');
  if (!invite.caseId) throw new Error('In diesem Einladungslink fehlt eine gültige Fallnummer.');
  config = readConfig(configValue);
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
