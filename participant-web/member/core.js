const ROLES = ['assigned_trainer', 'assigned_participant'];
const ACTIONS = { assigned_trainer: 'open_trainer_form', assigned_participant: 'open_participant_form' };
const MARKER = /^(0|[1-9]\d*)\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function text(value, max = 1000) { return typeof value === 'string' && value.trim() && value.length <= max; }
function invalid() { return new Error('Der Dienst hat keine gültigen Zugangsdaten geliefert. Bitte versuchen Sie es erneut.'); }
function timestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }

export function readMemberConfig(value) {
  if (!value || !text(value.googleClientId, 300) || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(value.googleClientId) ||
      typeof value.logoutCookieName !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.logoutCookieName)) throw invalid();
  return { googleClientId: value.googleClientId, logoutCookieName: value.logoutCookieName };
}

export function readMemberProfile(value) {
  if (!value || !text(value.personKey, 200) || !text(value.displayName, 200) || !text(value.email, 320) ||
      !text(value.initials, 12) || !Array.isArray(value.roles) || !value.roles.length ||
      value.roles.some(role => !ROLES.includes(role)) || new Set(value.roles).size !== value.roles.length) throw invalid();
  return { personKey: value.personKey, displayName: value.displayName, email: value.email, initials: value.initials, roles: [...value.roles] };
}

export function readMemberSession(value, now = Date.now()) {
  if (!value || !timestamp(value.expiresAt) || Date.parse(value.expiresAt) <= now ||
      !Number.isSafeInteger(value.generation) || value.generation < 0) throw invalid();
  return { profile: readMemberProfile(value.profile), expiresAt: value.expiresAt, generation: value.generation };
}

export function readMemberTasks(value, expectedProfile) {
  const profile = readMemberProfile(value?.profile);
  if (profile.personKey !== expectedProfile.personKey || profile.email !== expectedProfile.email ||
      !timestamp(value.checkedAt) || !Array.isArray(value.tasks)) throw invalid();
  const ids = new Set();
  const tasks = value.tasks.map(task => {
    const unscheduled = task?.phase === 'planning' && task?.state === 'blocked' && !task?.action && task?.sessionId === '';
    if (!task || !text(task.id, 300) || ids.has(task.id) || !profile.roles.includes(task.role) ||
        !text(task.caseId, 200) || (!unscheduled && !text(task.sessionId, 200)) || !text(task.requestId, 200) ||
        !text(task.title, 500) || !['theory', 'practice', 'planning'].includes(task.phase) ||
        !['ready', 'blocked', 'complete'].includes(task.state) || !text(task.statusLabel, 200) ||
        typeof task.reason !== 'string' || task.reason.length > 2000 ||
        (task.startsAt !== undefined && !timestamp(task.startsAt)) || (task.endsAt !== undefined && !timestamp(task.endsAt)) ||
        (task.counterpartName !== undefined && !text(task.counterpartName, 300)) ||
        (task.sourceMaterial !== undefined && !text(task.sourceMaterial, 2000))) throw invalid();
    if (task.action && (task.state !== 'ready' || task.action.id !== ACTIONS[task.role] || !text(task.action.label, 200))) throw invalid();
    ids.add(task.id);
    return { id: task.id, role: task.role, caseId: task.caseId, sessionId: task.sessionId, requestId: task.requestId,
      title: task.title, phase: task.phase, startsAt: task.startsAt, endsAt: task.endsAt,
      counterpartName: task.counterpartName, sourceMaterial: task.sourceMaterial, state: task.state,
      statusLabel: task.statusLabel, reason: task.reason, ...(task.action ? { action: { ...task.action } } : {}) };
  });
  return { profile, tasks, checkedAt: value.checkedAt };
}

export function validatedFormUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Der Formularlink konnte nicht sicher geprüft werden.'); }
  if (typeof value !== 'string' || url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port ||
      url.username || url.password || url.href !== `${url.origin}${url.pathname}` || !/^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform\/?$/.test(url.pathname))
    throw new Error('Der Formularlink konnte nicht sicher geprüft werden.');
  return url.href;
}

export function readCookie(cookieString, name) {
  const prefix = `${name}=`;
  const found = String(cookieString).split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

export function readLogoutIntent(value) {
  const match = typeof value === 'string' && MARKER.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('Die Abmeldung ist noch nicht bestätigt. Bitte laden Sie die Seite erneut.');
  return { marker: value, generation: Number(match[1]), logoutId: match[2] };
}

export function logoutCookie(name, marker, secure, clear = false) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(name)) throw invalid();
  if (!clear) readLogoutIntent(marker);
  return `${name}=${clear ? '' : marker}; Path=/; SameSite=Strict; Max-Age=${clear ? 0 : 86400}${secure ? '; Secure' : ''}`;
}

export async function memberRequest(path, { method = 'GET', body, signal } = {}, fetchImpl = (...args) => globalThis.fetch(...args)) {
  if (!/^\/member\/(config|auth\/challenge|session|tasks|tasks\/open|logout)$/.test(path) || !['GET', 'POST'].includes(method)) throw invalid();
  const response = await fetchImpl(path, { method, credentials: 'same-origin', cache: 'no-store', signal,
    headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Member-Request': '1' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) });
  let result;
  try { result = await response.json(); } catch { throw new Error('Der Dienst konnte nicht gelesen werden. Bitte versuchen Sie es erneut.'); }
  if (!response.ok) {
    const messages = {
      400: 'Die Anfrage konnte nicht geprüft werden. Bitte starten Sie den Schritt erneut.',
      401: 'Ihre Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.',
      403: 'Dieses Konto hat keinen Zugriff auf diese Aufgabe. Verwenden Sie Ihr zugewiesenes Konto.',
      404: 'Diese Aufgabe ist nicht mehr verfügbar. Bitte aktualisieren Sie den Stand.',
      409: 'Die Aufgabe oder Ihr Zugang hat sich geändert. Bitte aktualisieren Sie den Stand.',
      429: 'Zu viele Anfragen. Bitte warten Sie kurz und versuchen Sie es erneut.',
      503: 'Ihre Schulungsdaten sind zurzeit nicht verfügbar. Bitte versuchen Sie es erneut.',
    };
    const error = new Error(messages[response.status] || 'Der Dienst ist zurzeit nicht erreichbar. Bitte versuchen Sie es erneut.');
    error.status = response.status;
    throw error;
  }
  return result;
}

export class MemberClient {
  constructor({ fetchImpl = (...args) => globalThis.fetch(...args), cookies, now = Date.now, randomUUID = () => crypto.randomUUID(), secure = true,
    onChange = () => {}, notifyLogout = () => {}, setTimer = (...args) => globalThis.setTimeout(...args),
    clearTimer = (...args) => globalThis.clearTimeout(...args), withMarkerLock } = {}) {
    this.fetchImpl = fetchImpl;
    this.cookies = cookies;
    this.now = now;
    this.randomUUID = randomUUID;
    this.secure = secure;
    this.onChange = onChange;
    this.notifyLogout = notifyLogout;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.withMarkerLock = withMarkerLock;
    this.epoch = 0;
    this.revokedThroughGeneration = -1;
    this.requests = new Set();
    this.state = { phase: 'booting', profile: null, tasks: [], readyForm: null, error: '', authPending: false };
  }

  update(value) { this.state = { ...this.state, ...value }; this.onChange(this.state); }
  nextEpoch() {
    this.epoch += 1;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    return this.epoch;
  }
  marker() { return this.config ? readCookie(this.cookies.read(), this.config.logoutCookieName) : ''; }
  lockedMarker(callback) {
    if (typeof this.withMarkerLock !== 'function')
      throw new Error('Ihr Browser unterstützt den sicheren Schulungszugang nicht. Bitte verwenden Sie einen aktuellen Browser.');
    return this.withMarkerLock(callback);
  }
  clearTimers() { this.clearTimer(this.expiryTimer); this.clearTimer(this.formTimer); }
  erase(phase, error = '') {
    this.clearTimers();
    this.update({ phase, profile: null, tasks: [], readyForm: null, expiresAt: null, generation: null,
      checkedAt: null, pendingTaskId: null, authPending: false, error });
  }
  current(epoch, allowPending = false) {
    if (this.disposed || epoch !== this.epoch) return false;
    if (!allowPending && this.marker()) {
      this.nextEpoch();
      this.erase('logout_pending', 'Ihre Abmeldung wird noch bestätigt.');
      return false;
    }
    if (!allowPending && this.state.expiresAt && Date.parse(this.state.expiresAt) <= this.now()) {
      this.expire();
      return false;
    }
    return true;
  }
  async request(path, options) {
    const controller = new AbortController();
    this.requests.add(controller);
    try { return await memberRequest(path, { ...options, signal: controller.signal }, this.fetchImpl); }
    finally { this.requests.delete(controller); }
  }
  validateSession(value) {
    const session = readMemberSession(value, this.now());
    if (session.generation <= this.revokedThroughGeneration) {
      const error = new Error('Diese Anmeldung wurde bereits abgemeldet. Bitte melden Sie sich erneut an.');
      error.status = 401;
      throw error;
    }
    return session;
  }
  scheduleExpiry() {
    this.clearTimer(this.expiryTimer);
    const remaining = Date.parse(this.state.expiresAt) - this.now();
    if (remaining <= 0) return this.expire();
    this.expiryTimer = this.setTimer(() => this.scheduleExpiry(), Math.min(remaining, 2147483647));
  }
  expire() { this.nextEpoch(); this.erase('expired', 'Ihre Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.'); }
  fail(error, epoch) {
    if (!this.current(epoch)) return;
    const message = error?.name === 'AbortError' ? 'Die Anfrage wurde unterbrochen. Bitte versuchen Sie es erneut.' :
      error?.message || 'Der Dienst ist zurzeit nicht erreichbar. Bitte versuchen Sie es erneut.';
    if ([401, 403].includes(error?.status)) this.erase('signed_out', message);
    else this.update({ phase: this.state.profile ? 'error' : 'signed_out', tasks: [], readyForm: null, pendingTaskId: null, authPending: false, error: message });
  }

  async initialize() {
    const epoch = this.nextEpoch();
    this.markerLockReady = false;
    this.erase('booting');
    try {
      await this.lockedMarker(() => {});
      if (epoch !== this.epoch || this.disposed) return;
      this.markerLockReady = true;
      const config = readMemberConfig(await this.request('/member/config'));
      if (epoch !== this.epoch || this.disposed) return;
      this.config = config;
      if (this.marker()) return this.retryLogout();
      return this.restore();
    } catch (error) {
      if (epoch === this.epoch && !this.disposed) this.erase('unavailable', error.message || 'Der Zugang ist zurzeit nicht verfügbar.');
    }
  }

  async restore() {
    if (!this.config || !this.markerLockReady) return this.initialize();
    if (this.marker() || this.pendingIntent) return this.retryLogout();
    const hadProfile = Boolean(this.state.profile);
    const epoch = this.nextEpoch();
    this.update({ phase: 'loading', tasks: [], readyForm: null, pendingTaskId: null, error: '' });
    try {
      const session = this.validateSession(await this.request('/member/session'));
      if (!this.current(epoch)) return;
      this.update({ ...session, authPending: false });
      this.scheduleExpiry();
      await this.loadTasks(epoch);
    } catch (error) {
      if (error?.status === 401 && !hadProfile && this.current(epoch)) this.erase('signed_out');
      else this.fail(error, epoch);
    }
  }

  async loadTasks(epoch) {
    const result = await this.request('/member/tasks');
    if (!this.current(epoch)) return;
    const list = readMemberTasks(result, this.state.profile);
    this.update({ ...list, phase: 'ready', readyForm: null, pendingTaskId: null, error: '' });
  }

  async startLogin() {
    if (!this.config || !this.markerLockReady || this.state.profile || this.state.phase === 'signing_in') return null;
    if (this.marker() || this.pendingIntent) { await this.retryLogout(); return null; }
    const epoch = this.nextEpoch();
    this.erase('signing_in');
    try {
      const challenge = await this.request('/member/auth/challenge', { method: 'POST' });
      if (!this.current(epoch)) return null;
      if (!text(challenge?.nonce, 1000)) throw invalid();
      return { googleClientId: this.config.googleClientId, nonce: challenge.nonce, epoch };
    } catch (error) { this.fail(error, epoch); return null; }
  }

  cancelLogin() {
    if (this.state.phase === 'signing_in' && !this.state.authPending) {
      this.nextEpoch(); this.erase('signed_out');
    }
  }

  async acceptCredential(credential, epoch) {
    if (!this.current(epoch) || this.state.phase !== 'signing_in' || this.state.authPending) return;
    if (!text(credential, 20000)) { this.fail(invalid(), epoch); return; }
    this.update({ authPending: true, error: '' });
    try {
      const session = this.validateSession(await this.request('/member/session', { method: 'POST', body: { credential } }));
      credential = '';
      if (!this.current(epoch)) return;
      this.update({ ...session, phase: 'loading', authPending: false });
      this.scheduleExpiry();
      await this.loadTasks(epoch);
    } catch (error) { this.fail(error, epoch); }
    finally { credential = ''; }
  }

  async logout() {
    const generation = this.state.generation;
    if (!Number.isSafeInteger(generation) || generation < 0) return;
    const logoutId = this.randomUUID();
    this.pendingIntent = { ...readLogoutIntent(`${generation}.${logoutId}`), persisted: false };
    return this.retryLogout(true);
  }

  retryLogout(announce = false) {
    if (this.logoutInFlight) return this.logoutInFlight;
    this.logoutInFlight = this.finishLogout(announce).finally(() => { this.logoutInFlight = null; });
    return this.logoutInFlight;
  }

  async finishLogout(announce) {
    if (!this.config) return;
    const epoch = this.nextEpoch();
    this.erase('logging_out');
    try {
      while (this.current(epoch, true)) {
        const intent = await this.lockedMarker(() => {
          if (!this.current(epoch, true)) return null;
          const marker = this.marker();
          const existing = marker ? { ...readLogoutIntent(marker), persisted: true } : null;
          const pending = this.pendingIntent;
          const selected = existing && (!pending || existing.generation >= pending.generation) ? existing : pending;
          if (!selected) throw new Error('Die Abmeldung konnte nicht vorbereitet werden. Bitte laden Sie die Seite erneut.');
          this.pendingIntent = selected;
          this.revokedThroughGeneration = Math.max(this.revokedThroughGeneration, selected.generation);
          if (!selected.persisted) {
            this.cookies.write(logoutCookie(this.config.logoutCookieName, selected.marker, this.secure));
            if (this.marker() !== selected.marker) throw new Error('Die Abmeldung konnte nicht vorgemerkt werden. Bitte erlauben Sie Cookies und versuchen Sie es erneut.');
            selected.persisted = true;
          }
          return selected;
        });
        if (!intent || !this.current(epoch, true)) return;
        if (announce) { this.notifyLogout({ generation: intent.generation, logoutId: intent.logoutId }); announce = false; }
        const response = await this.request('/member/logout', { method: 'POST', body: { generation: intent.generation, logoutId: intent.logoutId } });
        if (!this.current(epoch, true)) return;
        if (response?.signedOut !== true) throw new Error('Die Abmeldung ist noch nicht bestätigt. Bitte versuchen Sie es erneut.');
        const complete = await this.lockedMarker(() => {
          if (!this.current(epoch, true)) return false;
          const currentMarker = this.marker();
          if (currentMarker && currentMarker !== intent.marker) {
            this.pendingIntent = { ...readLogoutIntent(currentMarker), persisted: true };
            return false;
          }
          if (currentMarker === intent.marker) this.cookies.write(logoutCookie(this.config.logoutCookieName, '', this.secure, true));
          const remainingMarker = this.marker();
          if (remainingMarker === intent.marker) throw new Error('Die Abmeldung wird noch bestätigt. Bitte versuchen Sie es erneut.');
          if (remainingMarker) {
            this.pendingIntent = { ...readLogoutIntent(remainingMarker), persisted: true };
            return false;
          }
          return true;
        });
        if (!this.current(epoch, true)) return;
        if (!complete || this.marker()) continue;
        this.pendingIntent = null;
        this.erase('signed_out');
        return;
      }
    } catch (error) {
      if (this.current(epoch, true)) this.erase('logout_pending', error.message || 'Ihre Abmeldung konnte noch nicht bestätigt werden. Bitte versuchen Sie es erneut.');
    }
  }

  externalLogout(value) {
    let incoming;
    try { incoming = readLogoutIntent(`${value?.generation}.${value?.logoutId}`); } catch { return false; }
    this.revokedThroughGeneration = Math.max(this.revokedThroughGeneration, incoming.generation);
    const generation = this.state.generation ?? this.pendingIntent?.generation;
    if (Number.isSafeInteger(generation) && incoming.generation < generation) return false;
    if (this.logoutInFlight) return this.logoutInFlight;
    if (!this.marker() && !this.state.profile && !this.pendingIntent) return false;
    this.nextEpoch();
    this.erase(this.marker() ? 'logout_pending' : 'signed_out');
    if (this.marker() || this.pendingIntent) return this.retryLogout();
    return true;
  }

  async openTask(taskId) {
    if (this.state.phase !== 'ready' || !this.state.profile) return;
    const task = this.state.tasks.find(item => item.id === taskId);
    if (!task?.action || task.state !== 'ready' || !this.state.profile.roles.includes(task.role)) return;
    const epoch = this.nextEpoch();
    if (!this.current(epoch)) return;
    this.clearTimer(this.formTimer);
    this.update({ readyForm: null, pendingTaskId: task.id, error: '' });
    try {
      const ref = { role: task.role, caseId: task.caseId, sessionId: task.sessionId, action: task.action.id };
      const result = await this.request('/member/tasks/open', { method: 'POST', body: ref });
      if (!this.current(epoch)) return;
      if (!timestamp(result?.checkedAt)) throw invalid();
      const url = validatedFormUrl(result.url);
      this.update({ readyForm: { taskId, url, checkedAt: result.checkedAt, validUntil: this.now() + 60000 }, pendingTaskId: null });
      this.formTimer = this.setTimer(() => this.update({ readyForm: null }), 60000);
    } catch (error) { this.fail(error, epoch); }
  }

  canOpenForm(taskId) {
    const ready = this.state.readyForm;
    return this.current(this.epoch) && this.state.phase === 'ready' && ready?.taskId === taskId && ready.validUntil > this.now();
  }
  formOpened() { this.clearTimer(this.formTimer); this.update({ readyForm: null }); }
  suspend() {
    this.nextEpoch();
    this.clearTimer(this.formTimer);
    const wasAuthenticated = Boolean(this.state.profile);
    this.update({ tasks: [], readyForm: null, pendingTaskId: null, ...(wasAuthenticated ? { phase: 'suspended' } : {}) });
  }
  dispose() { this.disposed = true; this.nextEpoch(); this.clearTimers(); this.state = { phase: 'disposed', profile: null, tasks: [], readyForm: null }; }
}
