// Public, browser-only workflow. No Google APIs, network requests, or real training records.
// SIM_PURE_START
const SIM_TOPICS = [{ id: 'TC_R052', name: 'Hochregallager · Theorie' }];

function simCreate(input, id) {
  const keys = input.participants;
  if (!/^A-\d{4}$/.test(id)) throw Error('Ungültige Demoauftragsnummer.');
  if (!SIM_TOPICS.some(topic => topic.id === input.topicId)) throw Error('Bitte ein Demothema wählen.');
  if (!['group', 'individual'].includes(input.mode) || !Array.isArray(keys) ||
      keys.length < 1 || keys.length > 3 || new Set(keys).size !== keys.length ||
      keys.some(key => !['ma1', 'ma2', 'ma3'].includes(key)) ||
      (input.mode === 'individual' && keys.length !== 1)) throw Error('Bitte einen gültigen Schulungsmodus und teilnehmende Personen wählen.');
  if (!['hcm4', 'pq', 'lead'].includes(input.trainer) ||
      (input.mode === 'group' && keys.length > 1 && input.trainer === 'hcm4')) throw Error('Diese schulende Rolle ist für die Auswahl nicht zulässig.');
  const slot = input.slot;
  if (!slot || !Number.isInteger(slot.day) || slot.day < 0 || slot.day > 4 ||
      !HOURS.includes(slot.hour) ||
      !commonSlots([input.trainer, ...keys], slot.day).includes(slot.hour)) throw Error('Bitte einen gemeinsamen freien Termin wählen.');
  return { id, topicId: input.topicId, mode: input.mode, trainer: input.trainer,
    slot: { day: slot.day, hour: slot.hour }, slotText: input.slotText,
    booked: false, people: keys.map(key => ({ key, rsvp: null, assessment: null,
      acknowledged: false, proof: false, archive: false, skill: false })) };
}

function simPerson(caseState, key) {
  const person = caseState.people.find(row => row.key === key);
  if (!person) throw Error('Person gehört nicht zu diesem Demoauftrag.');
  return person;
}

function simApply(caseState, action) {
  if (!caseState || !action || typeof action !== 'object') throw Error('Demoaktion fehlt.');
  const next = JSON.parse(JSON.stringify(caseState));
  if (action.type === 'book') {
    if (next.booked) throw Error('Der Termin ist bereits gebucht.');
    next.booked = true;
    return next;
  }
  if (!next.booked) throw Error('Zuerst den Termin buchen.');
  const person = simPerson(next, action.personKey);
  switch (action.type) {
    case 'rsvp':
      if (person.rsvp || !['accepted', 'declined'].includes(action.value)) throw Error('Die Rückmeldung ist bereits erfasst oder ungültig.');
      person.rsvp = action.value;
      break;
    case 'assess':
      if (person.rsvp !== 'accepted' || person.assessment || !['passed', 'failed', 'absent'].includes(action.value)) throw Error('Der Trainerbericht ist hier nicht zulässig.');
      person.assessment = action.value;
      break;
    case 'acknowledge':
      if (person.assessment !== 'passed' || person.acknowledged) throw Error('Erst nach bestandenem Trainerbericht bestätigen.');
      person.acknowledged = true;
      break;
    case 'proof':
      if (!person.acknowledged || person.proof) throw Error('Persönliche Bestätigung fehlt oder Nachweis besteht bereits.');
      person.proof = true;
      break;
    case 'archive':
      if (!person.proof || person.archive) throw Error('Erst den persönlichen Nachweis erstellen.');
      person.archive = true;
      break;
    case 'skill':
      if (!person.archive || person.skill) throw Error('Erst beide Archive prüfen.');
      person.skill = true;
      break;
    default:
      throw Error('Unbekannte Demoaktion.');
  }
  return next;
}

function simPersonStatus(person, booked) {
  if (!booked) return 'Termin noch nicht gebucht';
  if (person.rsvp === 'declined') return 'Offen: Einladung abgelehnt';
  if (!person.rsvp) return 'Einladung: Antwort ausstehend';
  if (person.assessment === 'failed') return 'Offen: Trainerbericht nicht bestanden';
  if (person.assessment === 'absent') return 'Offen: Person nicht anwesend';
  if (!person.assessment) return 'Trainerbericht ausstehend';
  if (!person.acknowledged) return 'Persönliche Bestätigung ausstehend';
  if (!person.proof) return 'Individueller Nachweis ausstehend';
  if (!person.archive) return 'Drive- und lokales Archiv ausstehend';
  if (!person.skill) return 'Skillübernahme ausstehend';
  return 'Abgeschlossen · Skillstufe 0 → 1';
}

function simOverall(caseState) {
  if (caseState.people.every(person => person.skill)) return 'Abgeschlossen';
  if (caseState.people.some(person => person.rsvp === 'declined' ||
      ['failed', 'absent'].includes(person.assessment))) return 'Klärung erforderlich';
  return 'In Bearbeitung';
}
// SIM_PURE_END

const simElements = {
  topic: document.getElementById('sim-topic'),
  start: document.getElementById('sim-start'),
  reset: document.getElementById('sim-reset'),
  status: document.getElementById('sim-status'),
  caseView: document.getElementById('sim-case'),
  role: document.getElementById('sim-role'),
  people: document.getElementById('sim-people')
};
let simCase = null;
let simCounter = 0;

function simStore() {
  try { sessionStorage.setItem('cosanum-public-simulator-v1', JSON.stringify({ caseState: simCase, counter: simCounter })); } catch (_) { /* Tab storage is optional. */ }
}

function simRestore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('cosanum-public-simulator-v1') || 'null');
    if (saved && Number.isInteger(saved.counter) && saved.counter >= 0 && saved.counter <= 9999) {
      simCounter = saved.counter;
      const candidate = saved.caseState;
      if (candidate && /^A-\d{4}$/.test(candidate.id) &&
          SIM_TOPICS.some(topic => topic.id === candidate.topicId) &&
          ['group', 'individual'].includes(candidate.mode) &&
          ['hcm4', 'pq', 'lead'].includes(candidate.trainer) &&
          Array.isArray(candidate.people) && candidate.people.length >= 1 && candidate.people.length <= 3 &&
          candidate.people.every(person => ['ma1', 'ma2', 'ma3'].includes(person.key)) &&
          candidate.slot && Number.isInteger(candidate.slot.day) && Number.isInteger(candidate.slot.hour)) {
        simCase = candidate;
        simElements.topic.value = candidate.topicId;
        document.getElementById('mode').value = candidate.mode;
        document.getElementById('trainer').value = candidate.trainer;
        document.querySelectorAll('#participants input').forEach(box => {
          box.checked = candidate.people.some(person => person.key === box.value);
        });
        state.day = candidate.slot.day;
        state.slot = { day: candidate.slot.day, hour: candidate.slot.hour };
        render();
      }
    }
  } catch (_) { /* Start a fresh tab-only run. */ }
}

function simButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    try { simCase = simApply(simCase, action); simStore(); simRender(); }
    catch (error) { simElements.status.textContent = error.message; }
  });
  return button;
}

function simRenderRoles() {
  const role = simElements.role;
  if (role.dataset.caseId === simCase.id) return;
  role.replaceChildren(new Option('Process & Quality', 'pq'),
    new Option('Trainer:in · ' + ROLE[simCase.trainer], 'trainer'));
  simCase.people.forEach(person => role.add(new Option(ROLE[person.key], person.key)));
  role.dataset.caseId = simCase.id;
  role.value = 'pq';
}

function simRenderPerson(person) {
  const card = document.createElement('article');
  card.className = 'sim-person';
  const heading = document.createElement('h4');
  heading.textContent = ROLE[person.key];
  card.appendChild(heading);
  const status = document.createElement('p');
  status.className = 'sim-state';
  status.textContent = simPersonStatus(person, simCase.booked);
  card.appendChild(status);
  const actions = document.createElement('div');
  actions.className = 'sim-actions';
  const actor = simElements.role.value;
  if (actor === person.key && simCase.booked && !person.rsvp) {
    actions.append(simButton('Einladung zusagen', { type: 'rsvp', personKey: person.key, value: 'accepted' }),
      simButton('Einladung ablehnen', { type: 'rsvp', personKey: person.key, value: 'declined' }));
  } else if (actor === 'trainer' && person.rsvp === 'accepted' && !person.assessment) {
    actions.append(simButton('Bestanden', { type: 'assess', personKey: person.key, value: 'passed' }),
      simButton('Nicht bestanden', { type: 'assess', personKey: person.key, value: 'failed' }),
      simButton('Abwesend', { type: 'assess', personKey: person.key, value: 'absent' }));
  } else if (actor === person.key && person.assessment === 'passed' && !person.acknowledged) {
    actions.append(simButton('Teilnahme bestätigen', { type: 'acknowledge', personKey: person.key }));
  } else if (actor === 'pq' && person.acknowledged && !person.proof) {
    actions.append(simButton('Nachweis erstellen', { type: 'proof', personKey: person.key }));
  } else if (actor === 'pq' && person.proof && !person.archive) {
    actions.append(simButton('Beide Archive prüfen', { type: 'archive', personKey: person.key }));
  } else if (actor === 'pq' && person.archive && !person.skill) {
    actions.append(simButton('Skillstufe übernehmen', { type: 'skill', personKey: person.key }));
  }
  if (actions.childElementCount) card.appendChild(actions);
  return card;
}

function simRender() {
  simElements.caseView.hidden = !simCase;
  simElements.reset.hidden = !simCase;
  simElements.start.hidden = !!simCase;
  if (!simCase) {
    simElements.status.textContent = 'Thema und freien Termin wählen, dann einen eigenen Demoauftrag starten.';
    return;
  }
  simRenderRoles();
  const topic = SIM_TOPICS.find(row => row.id === simCase.topicId);
  simElements.status.textContent = simCase.id + ' · ' + simOverall(simCase) + ' · ' + topic.name + ' · ' + simCase.slotText + '. Alle Aktionen sind simuliert.';
  const booking = document.getElementById('sim-booking');
  booking.replaceChildren();
  if (!simCase.booked && simElements.role.value === 'pq') booking.appendChild(simButton('Termin buchen (Simulation)', { type: 'book' }));
  else booking.textContent = simCase.booked ? 'Beispieltermin gebucht. Die ausgewählten Personen können nun antworten.' : 'Für die Buchung zur Rolle Process & Quality wechseln.';
  simElements.people.replaceChildren(...simCase.people.map(simRenderPerson));
}

SIM_TOPICS.forEach(topic => simElements.topic.add(new Option(topic.name, topic.id)));
simElements.start.addEventListener('click', () => {
  try {
    if (simCounter >= 9999) throw Error('Der lokale Nummernraum ist voll. Bitte den Tab schliessen und neu öffnen.');
    const nextId = 'A-' + String(simCounter + 1).padStart(4, '0');
    simCase = simCreate({ topicId: simElements.topic.value,
      mode: document.getElementById('mode').value,
      trainer: document.getElementById('trainer').value,
      participants: participants(), slot: state.slot,
      slotText: state.slot ? slotLabel(state.slot) : '' }, nextId);
    simCounter++;
    simStore();
    simRender();
  } catch (error) { simElements.status.textContent = error.message; }
});
simElements.reset.addEventListener('click', () => { simCase = null; simStore(); simRender(); });
simElements.role.addEventListener('change', simRender);
simRestore();
simRender();
