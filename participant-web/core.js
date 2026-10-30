export function readConfig(config = {}) {
  const apiOrigin = String(config.apiOrigin || '').trim();
  if (!apiOrigin) throw new Error('Die Fall-API ist noch nicht konfiguriert.');
  let url;
  try { url = new URL(apiOrigin); } catch { throw new Error('Die konfigurierte Fall-API-Adresse ist ungültig.'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Die Fall-API muss eine sichere HTTPS-Ursprungsadresse sein.');
  const identityProvider = String(config.identityProvider || '');
  const googleClientId = String(config.googleClientId || '').trim();
  return { apiOrigin: url.origin, identityProvider, googleClientId };
}

export function readInvitation(url) {
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const caseId = parsed.searchParams.get('case') || parsed.searchParams.get('caseId') || fragment.get('case') || fragment.get('caseId') || '';
  const insecureQueryToken = parsed.searchParams.has('link') || parsed.searchParams.has('linkToken');
  const linkToken = insecureQueryToken ? '' : fragment.get('link') || fragment.get('linkToken') || '';
  return {
    caseId: /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(caseId) ? caseId : '',
    linkToken: /^[A-Za-z0-9_-]{32,256}$/.test(linkToken) ? linkToken : '',
    insecureQueryToken,
  };
}

export function invitationUrlWithoutSecret(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete('link');
  parsed.searchParams.delete('linkToken');
  for (const key of [...parsed.searchParams.keys()]) if (!['case', 'caseId'].includes(key)) parsed.searchParams.delete(key);
  parsed.hash = '';
  return `${parsed.pathname}${parsed.search}`;
}

export function participantResponseReady(snapshot, verifiedParticipantClaim) {
  return verifiedParticipantClaim === true && snapshot?.evidence?.facts?.trainerPass === true && snapshot?.status === 'assessed';
}

export function isRetryableSubmissionError(error) {
  if (!error || error.status === undefined || error.status === null) return true;
  const status = Number(error.status);
  return Number.isInteger(status) && status >= 500 && status <= 599;
}

export function canRetryParticipantResponse(error, attemptCount, maxAttempts = 3) {
  return isRetryableSubmissionError(error) && Number.isInteger(attemptCount) && attemptCount > 0 &&
    Number.isInteger(maxAttempts) && maxAttempts > 0 && attemptCount < maxAttempts;
}

export async function apiRequest(config, path, token, options = {}, fetchImpl = fetch) {
  const safeConfig = readConfig(config);
  if (!token) throw new Error('Für diesen Schritt ist eine verifizierte Anmeldung erforderlich.');
  const response = await fetchImpl(`${safeConfig.apiOrigin}${path}`, {
    ...options,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    cache: 'no-store',
  });
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    const messages = {
      401: 'Anmeldung oder Einladung ist ungültig oder abgelaufen. Bitte melden Sie sich erneut an oder wenden Sie sich an die zuständige Stelle.',
      403: 'Dieses Konto ist diesem Fall nicht zugeordnet. Verwenden Sie das für die Einladung bestimmte Konto.',
      404: 'Der Fall wurde nicht gefunden.',
      409: 'Der Fall hat sich geändert oder es fehlen noch serverseitig geprüfte Nachweise. Bitte laden Sie den Fall neu.',
      503: 'Der geschützte Dienst ist noch nicht verfügbar.',
    };
    const error = new Error(messages[response.status] || 'Die Anfrage konnte nicht abgeschlossen werden.');
    error.status = response.status;
    error.serverMessage = typeof body.error === 'string' ? body.error : '';
    throw error;
  }
  return body;
}
