import { MemberClient } from './core.js';

const ids = ['main', 'notice', 'error', 'loading-view', 'loading-heading', 'login-view', 'access-heading', 'identity-instruction',
  'identity-status', 'sign-in', 'google-button', 'cancel-login', 'retry-logout', 'retry-config', 'member-view', 'greeting',
  'role-intro', 'role-tabs', 'refresh-tasks', 'current-tab', 'complete-tab', 'current-count', 'complete-count', 'task-content',
  'task-loading', 'tasks-error', 'empty-state', 'empty-heading', 'empty-copy', 'task-list', 'role-guidance', 'checked-at',
  'account-control', 'account-button', 'account-menu', 'account-name', 'account-email', 'private-label', 'profile-button',
  'switch-account', 'logout-button', 'profile-dialog', 'profile-details', 'close-profile'];
const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const roleLabels = { assigned_trainer: 'Trainer', assigned_participant: 'Teilnehmende' };
const phaseLabels = { theory: 'Theorie', practice: 'Praxis', planning: 'Planung' };
let selectedRole = '';
let selectedStatus = 'current';
let googleReady = false;
let googlePromise;
let lastForm;
let noticeMessage = '';
let channel;

function setText(element, value) { element.textContent = value || ''; }
function message(element, value) { setText(element, value); element.hidden = !value; }
function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value) setText(element, value);
  return element;
}
function displayTime(value, withDate = true) {
  if (!value) return 'Noch kein Termin';
  return new Intl.DateTimeFormat('de-CH', { ...(withDate ? { day: '2-digit', month: '2-digit', year: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(new Date(value));
}
function taskTime(task) {
  if (!task.startsAt) return 'Termin folgt';
  return `${displayTime(task.startsAt)}${task.endsAt ? ` bis ${displayTime(task.endsAt, false)}` : ''}`;
}
function row(list, label, value) {
  if (!value) return;
  list.append(node('dt', '', label), node('dd', '', value));
}
function setNotice(value) { noticeMessage = value; message(elements.notice, value); }

function closeMenu(restoreFocus = false) {
  const wasOpen = !elements['account-menu'].hidden;
  elements['account-menu'].hidden = true;
  elements['account-button'].setAttribute('aria-expanded', 'false');
  if (restoreFocus && wasOpen && !elements['account-control'].hidden) elements['account-button'].focus();
}
function openMenu(index = 0) {
  elements['account-menu'].hidden = false;
  elements['account-button'].setAttribute('aria-expanded', 'true');
  const buttons = [...elements['account-menu'].querySelectorAll('[role="menuitem"]')];
  buttons.at(index)?.focus();
}
function clearGoogle() {
  googleReady = false;
  elements['google-button'].replaceChildren();
  elements['google-button'].hidden = true;
  window.google?.accounts?.id?.cancel();
}

function renderRoles(profile) {
  if (!profile.roles.includes(selectedRole)) selectedRole = profile.roles[0];
  const roleTabs = elements['role-tabs'];
  roleTabs.hidden = profile.roles.length < 2;
  const previousFocus = document.activeElement?.dataset.role;
  roleTabs.replaceChildren();
  for (const role of profile.roles) {
    const button = node('button', 'button-sm', `Als ${roleLabels[role]}`);
    button.type = 'button';
    button.id = `role-${role}`;
    button.dataset.role = role;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(role === selectedRole));
    button.setAttribute('aria-controls', 'task-content');
    button.tabIndex = role === selectedRole ? 0 : -1;
    button.addEventListener('click', () => { selectedRole = role; client.formOpened(); });
    button.addEventListener('keydown', event => tabKeys(event, [...roleTabs.querySelectorAll('[role="tab"]')]));
    roleTabs.append(button);
  }
  if (previousFocus) roleTabs.querySelector(`[data-role="${previousFocus}"]`)?.focus();
}

function renderTask(task, state) {
  const item = node('li');
  const article = node('article', 'task-card');
  article.setAttribute('aria-labelledby', `task-title-${state.tasks.indexOf(task)}`);
  const heading = node('div', 'task-heading');
  const titleBlock = node('div');
  const title = node('h3', 'heading-6', task.title);
  title.id = `task-title-${state.tasks.indexOf(task)}`;
  titleBlock.append(node('span', 'task-phase caption-4', phaseLabels[task.phase]), title);
  heading.append(titleBlock, node('span', `status-badge caption-4 ${task.state}`, task.statusLabel));
  const details = node('dl', 'task-details body-6');
  row(details, 'Termin', taskTime(task));
  row(details, task.role === 'assigned_trainer' ? 'Teilnehmende Person' : 'Trainer', task.counterpartName);
  row(details, 'Unterlagen', task.sourceMaterial);
  article.append(heading, details);
  if (task.reason) article.append(node('p', 'task-reason body-6', task.reason));
  if (task.action && task.state === 'ready') {
    const action = node('button', 'button button-primary button-sm task-action', state.pendingTaskId === task.id ? 'Zugriff wird geprüft …' : task.action.label);
    action.type = 'button';
    action.dataset.taskAction = task.id;
    action.disabled = Boolean(state.pendingTaskId) || state.phase !== 'ready';
    action.addEventListener('click', () => { setNotice(''); void client.openTask(task.id); });
    article.append(action);
  }
  if (state.readyForm?.taskId === task.id) {
    const handoff = node('div', 'form-handoff');
    handoff.append(node('p', 'body-6', `Verwenden Sie im Formular dasselbe Google-Konto: ${state.profile.email}`));
    const link = node('a', 'button button-secondary button-sm', 'Formular bei Google öffnen');
    link.href = state.readyForm.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    link.dataset.formTask = task.id;
    link.addEventListener('click', event => {
      if (!client.canOpenForm(task.id)) {
        event.preventDefault();
        setNotice('Bitte lassen Sie den Zugriff erneut prüfen, bevor Sie das Formular öffnen.');
        client.formOpened();
        return;
      }
      setNotice('Das Formular öffnet sich bei Google. Aktualisieren Sie nach Ihrer Antwort den Schulungsstand.');
      window.setTimeout(() => client.formOpened(), 0);
    });
    handoff.append(link, node('span', 'caption-4', 'Der Link wurde soeben geprüft und ist hier kurz verfügbar. Ihre Antwort geben Sie bei Google ab.'));
    article.append(handoff);
  }
  item.append(article);
  return item;
}

function renderTasks(state) {
  const all = state.tasks.filter(task => task.role === selectedRole);
  const current = all.filter(task => task.state !== 'complete');
  const complete = all.filter(task => task.state === 'complete');
  setText(elements['current-count'], String(current.length));
  setText(elements['complete-count'], String(complete.length));
  for (const [id, status] of [['current-tab', 'current'], ['complete-tab', 'complete']]) {
    const active = status === selectedStatus;
    elements[id].setAttribute('aria-selected', String(active));
    elements[id].tabIndex = active ? 0 : -1;
  }
  elements['task-content'].setAttribute('aria-labelledby', selectedStatus === 'current' ? 'current-tab' : 'complete-tab');
  const loading = ['loading', 'suspended'].includes(state.phase);
  elements['task-loading'].hidden = !loading;
  elements['tasks-error'].hidden = state.phase !== 'error';
  const tasks = selectedStatus === 'current' ? current : complete;
  const empty = !loading && state.phase === 'ready' && !tasks.length;
  elements['empty-state'].hidden = !empty;
  setText(elements['empty-heading'], selectedStatus === 'current' ? 'Aktuell ist nichts offen' : 'Noch keine abgeschlossene Aufgabe');
  setText(elements['empty-copy'], selectedStatus === 'current' ? 'Sobald Ihnen eine Aufgabe zugeordnet wird, finden Sie hier Ihren nächsten Schritt.' : 'Abgeschlossene Aufgaben erscheinen hier, sobald der Schulungsstand sie bestätigt.');
  const focusedTask = document.activeElement?.dataset.taskAction;
  elements['task-list'].replaceChildren(...(state.phase === 'ready' ? tasks.map(task => renderTask(task, state)) : []));
  if (focusedTask) [...elements['task-list'].querySelectorAll('[data-task-action]')].find(button => button.dataset.taskAction === focusedTask)?.focus();
  if (state.readyForm && lastForm !== state.readyForm) {
    lastForm = state.readyForm;
    requestAnimationFrame(() => [...elements['task-list'].querySelectorAll('[data-form-task]')].find(link => link.dataset.formTask === state.readyForm?.taskId)?.focus());
  }
}

function render(state) {
  const signedIn = Boolean(state.profile);
  const signingIn = state.phase === 'signing_in';
  const pendingLogout = ['logging_out', 'logout_pending'].includes(state.phase);
  const loading = ['booting', 'logging_out'].includes(state.phase) || (state.phase === 'loading' && !signedIn);
  const busy = loading || state.phase === 'loading' || (signingIn && state.authPending);
  elements.main.setAttribute('aria-busy', String(busy));
  message(elements.error, state.error);
  message(elements.notice, noticeMessage);
  elements['loading-view'].hidden = !loading;
  setText(elements['loading-heading'], pendingLogout ? 'Ihre Abmeldung wird bestätigt' : 'Ihr Zugang wird geprüft');
  elements['login-view'].hidden = loading || signedIn;
  elements['member-view'].hidden = !signedIn;
  elements['account-control'].hidden = !signedIn;
  elements['private-label'].hidden = signedIn;
  elements['retry-logout'].hidden = state.phase !== 'logout_pending';
  elements['retry-config'].hidden = state.phase !== 'unavailable';
  elements['sign-in'].hidden = pendingLogout || state.phase === 'unavailable' || (signingIn && googleReady);
  elements['sign-in'].disabled = !client.config || signingIn || busy || pendingLogout;
  setText(elements['sign-in'], signingIn ? 'Anmeldung wird vorbereitet …' : 'Mit Google anmelden');
  elements['cancel-login'].hidden = !signingIn || state.authPending;
  elements['google-button'].hidden = !signingIn || !googleReady || state.authPending;
  setText(elements['access-heading'], state.phase === 'logout_pending' ? 'Abmeldung ausstehend' : 'Willkommen');
  setText(elements['identity-status'], signingIn ? (state.authPending ? 'Ihr Konto wird geprüft …' : 'Wählen Sie Ihr zugewiesenes Google-Konto.') : '');
  elements['identity-instruction'].hidden = pendingLogout;
  if (!signingIn && googleReady) clearGoogle();
  if (!signedIn) {
    closeMenu();
    if (elements['profile-dialog'].open) elements['profile-dialog'].close();
    elements['task-list'].replaceChildren();
    elements['profile-details'].replaceChildren();
    setText(elements['account-button'], ''); setText(elements['account-name'], ''); setText(elements['account-email'], '');
    setText(elements.greeting, '');
    elements['role-tabs'].replaceChildren();
    setText(elements['checked-at'], 'Noch nicht geladen');
    selectedRole = '';
    return;
  }
  const profile = state.profile;
  setText(elements['account-button'], profile.initials);
  elements['account-button'].setAttribute('aria-label', `Kontomenü für ${profile.displayName} öffnen`);
  setText(elements['account-name'], profile.displayName);
  setText(elements['account-email'], profile.email);
  setText(elements.greeting, profile.displayName);
  renderRoles(profile);
  setText(elements['role-intro'], selectedRole === 'assigned_trainer' ? 'Ihre zugeordneten Schulungen und freigegebenen Beurteilungen.' : 'Ihre Termine und persönlichen Schulungsaufgaben.');
  setText(elements['role-guidance'], selectedRole === 'assigned_trainer' ? 'Öffnen Sie eine freigegebene Beurteilung, wenn Sie die zugeordnete Schulung durchgeführt haben.' : 'Ihre Teilnahmebestätigung wird freigegeben, sobald die erforderliche Beurteilung vorliegt.');
  setText(elements['checked-at'], state.checkedAt && state.phase === 'ready' ? displayTime(state.checkedAt) : 'Wird geprüft');
  elements['refresh-tasks'].disabled = state.phase === 'loading' || state.phase === 'suspended';
  renderTasks(state);
}

const client = new MemberClient({
  cookies: { read: () => document.cookie, write: value => { document.cookie = value; } },
  secure: window.location.protocol === 'https:',
  onChange: render,
  notifyLogout: intent => channel?.postMessage({ type: 'logout', ...intent }),
  withMarkerLock: navigator.locks?.request ? callback => navigator.locks.request('cosanum.member.logout-marker', { mode: 'exclusive' }, callback) : undefined,
});

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googlePromise) return googlePromise;
  googlePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.referrerPolicy = 'no-referrer';
    script.addEventListener('load', () => {
      if (window.google?.accounts?.id) resolve();
      else { googlePromise = null; script.remove(); reject(new Error('Google konnte nicht geladen werden. Bitte versuchen Sie es erneut.')); }
    }, { once: true });
    script.addEventListener('error', () => {
      googlePromise = null;
      script.remove();
      reject(new Error('Google konnte nicht geladen werden. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.'));
    }, { once: true });
    document.head.append(script);
  });
  return googlePromise;
}

async function signIn() {
  setNotice('');
  const flow = await client.startLogin();
  if (!flow) return;
  try {
    await loadGoogleIdentity();
    if (!client.current(flow.epoch) || client.state.phase !== 'signing_in') return;
    window.google.accounts.id.initialize({ client_id: flow.googleClientId, nonce: flow.nonce,
      auto_select: false, button_auto_select: false, ux_mode: 'popup',
      callback: response => {
        const credential = response?.credential;
        if (response) response.credential = undefined;
        void client.acceptCredential(credential, flow.epoch);
      } });
    googleReady = true;
    render(client.state);
    window.google.accounts.id.renderButton(elements['google-button'], { type: 'standard', theme: 'outline', size: 'large',
      text: 'signin_with', locale: 'de', width: Math.min(320, Math.floor(elements['google-button'].getBoundingClientRect().width)) });
  } catch (error) { client.fail(error, flow.epoch); }
}

async function signOut(switchAccount) {
  closeMenu();
  if (elements['profile-dialog'].open) elements['profile-dialog'].close();
  clearGoogle();
  window.google?.accounts?.id?.disableAutoSelect();
  setNotice('');
  await client.logout();
  if (client.state.phase === 'signed_out') {
    setNotice(switchAccount ? 'Sie können jetzt ein anderes Konto wählen. Ihr Google-Konto bleibt angemeldet.' : 'Sie sind vom Schulungszugang abgemeldet. Ihr Google-Konto bleibt angemeldet.');
    elements['sign-in'].focus();
  }
}

function tabKeys(event, tabs) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = tabs.indexOf(event.currentTarget);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click();
  const id = tabs[next].id;
  document.getElementById(id)?.focus();
}

elements['sign-in'].addEventListener('click', () => { void signIn(); });
elements['cancel-login'].addEventListener('click', () => { clearGoogle(); client.cancelLogin(); elements['sign-in'].focus(); });
elements['retry-logout'].addEventListener('click', () => { void client.retryLogout(); });
elements['retry-config'].addEventListener('click', () => { void client.initialize(); });
elements['refresh-tasks'].addEventListener('click', () => { setNotice(''); void client.restore(); });
elements['logout-button'].addEventListener('click', () => { void signOut(false); });
elements['switch-account'].addEventListener('click', () => { void signOut(true); });
elements['account-button'].addEventListener('click', () => { elements['account-menu'].hidden ? openMenu() : closeMenu(true); });
elements['account-button'].addEventListener('keydown', event => {
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu(event.key === 'ArrowUp' ? -1 : 0); }
});
elements['account-menu'].addEventListener('keydown', event => {
  const buttons = [...elements['account-menu'].querySelectorAll('[role="menuitem"]')];
  const index = buttons.indexOf(document.activeElement);
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
  if (event.key === 'Tab') closeMenu();
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
});
document.addEventListener('pointerdown', event => { if (!elements['account-control'].contains(event.target)) closeMenu(); });
document.addEventListener('focusin', event => { if (!elements['account-control'].contains(event.target)) closeMenu(); });
elements['profile-button'].addEventListener('click', () => {
  closeMenu();
  const profile = client.state.profile;
  if (!profile) return;
  elements['profile-details'].replaceChildren();
  row(elements['profile-details'], 'Name', profile.displayName);
  row(elements['profile-details'], 'Google-Konto', profile.email);
  row(elements['profile-details'], 'Zugewiesene Rollen', profile.roles.map(role => roleLabels[role]).join(', '));
  elements['profile-dialog'].showModal();
  elements['close-profile'].focus();
});
elements['close-profile'].addEventListener('click', () => { elements['profile-dialog'].close(); elements['account-button'].focus(); });
elements['profile-dialog'].addEventListener('cancel', () => { elements['account-button'].focus(); });
for (const [id, status] of [['current-tab', 'current'], ['complete-tab', 'complete']]) {
  elements[id].addEventListener('click', () => { selectedStatus = status; client.formOpened(); });
  elements[id].addEventListener('keydown', event => tabKeys(event, [elements['current-tab'], elements['complete-tab']]));
}

if ('BroadcastChannel' in window) {
  channel = new BroadcastChannel('cosanum.member.session');
  channel.addEventListener('message', event => {
    if (event.data?.type !== 'logout') return;
    const handled = client.externalLogout(event.data);
    if (handled === false) return;
    clearGoogle();
    window.google?.accounts?.id?.disableAutoSelect();
    setNotice('Der Schulungszugang wurde in einem anderen Fenster abgemeldet.');
    void handled;
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && client.state.profile) {
    closeMenu();
    if (elements['profile-dialog'].open) elements['profile-dialog'].close();
    client.suspend();
  } else if (!document.hidden && (client.marker() || client.pendingIntent || client.state.profile)) void client.restore();
});
window.addEventListener('pageshow', event => {
  if (event.persisted && (client.marker() || client.pendingIntent || client.state.profile)) void client.restore();
});
window.addEventListener('pagehide', event => {
  clearGoogle();
  if (event.persisted) client.suspend();
  else { client.dispose(); channel?.close(); }
});

void client.initialize();
