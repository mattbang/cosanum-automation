/** Increment 03: synthetic phase planning only. No calendar or message services. */
function phasePlanModel_(requestId, mode, tables) {
  if (mode !== 'group' && mode !== 'individual') throw new Error('Bitte Gruppe oder Einzeltraining wählen.');
  var request = tables.Requests.filter(function (r) { return r.request_id === requestId; })[0];
  if (!request) throw new Error('Entwurf nicht gefunden.');
  if (request.mode && request.mode !== mode) throw new Error('Dieser Entwurf hat bereits einen anderen Modus.');
  var topic = tables.Topics.filter(function (t) { return t.topic_id === request.topic_id; })[0];
  if (!topic) throw new Error('Thema nicht gefunden.');
  var cases = tables.ParticipantCases.filter(function (c) { return c.request_id === requestId; });
  if (!cases.length || new Set(cases.map(function (c) { return c.case_id; })).size !== cases.length) throw new Error('Personenfälle fehlen oder sind doppelt.');
  cases.forEach(function (c) {
    var skill = tables.Skills.filter(function (s) { return s.person_key === c.person_key && s.topic_id === request.topic_id; });
    if (skill.length !== 1 || !eligibility_(topic, skill[0].skill_level, Number(request.target_level)).allowed) {
      throw new Error('Skillprüfung für ' + c.person_key + ' ist nicht mehr gültig. Demo-Sheet prüfen.');
    }
  });
  var daniel = tables.People.filter(function (p) { return p.person_key === 'MATT'; })[0];
  if (!daniel) throw new Error('Daniel fehlt in der Demo-Personenliste.');
  var requiresIndividualPractice = /Praxis einzeln/i.test(String(topic.group_suitability));
  var phases = [];
  var theory = demoFlag_(topic.theory_required);
  var practice = demoFlag_(topic.practice_required);
  if (!theory) throw new Error('Theoriephase fehlt im Demo-Katalog.');
  if (Number(topic.theory_minutes) !== 60 || (practice && Number(topic.practice_minutes) !== 180)) {
    throw new Error('Planungsdauern im Demo-Katalog weichen von 60/180 Minuten ab.');
  }
  var caseGroups = mode === 'group' ? [cases] : cases.map(function (c) { return [c]; });
  caseGroups.forEach(function (group) { phases.push(planSession_('theory', 1, mode, group, requestId, 60, '', tables, daniel)); });
  if (practice) {
    var practiceGroups = mode === 'group' && !requiresIndividualPractice ? [cases] : cases.map(function (c) { return [c]; });
    practiceGroups.forEach(function (group) {
      var theorySession = phases.filter(function (p) { return p.phase === 'theory' && group.every(function (c) { return p.caseIds.indexOf(c.case_id) >= 0; }); })[0];
      phases.push(planSession_('practice', 2, practiceGroups.length === 1 && mode === 'group' && !requiresIndividualPractice ? 'group' : 'individual', group, requestId, 180, theorySession.sessionId, tables, daniel));
    });
  }
  return { requestId: requestId, topicId: request.topic_id, mode: mode, targetLevel: Number(request.target_level),
    phases: phases, rule: practice ? 'Zielstufe erst nach bestandener Theorie und Praxis.' : 'Zielstufe erst nach bestandener Theorie.' };
}

function planSession_(phase, order, mode, cases, requestId, minutes, theorySessionId, tables, daniel) {
  var suffix = cases.length === 1 ? '-' + cases[0].person_key : '-GROUP';
  var sessionId = 'SES-' + requestId.slice(4) + '-' + phase.toUpperCase() + suffix;
  var choices = mode === 'group' ? [{ key: 'MATT', label: String(daniel.display_alias) + ' (Daniel)' }] :
    tables.People.filter(function (p) {
      if (!/Einzeltraining|Coach|Supervisor|HCM/i.test(String(p.demo_role))) return false;
      if (cases.some(function (c) { return c.person_key === p.person_key; })) return false;
      var skill = tables.Skills.filter(function (s) { return s.person_key === p.person_key && s.topic_id === tables.Requests.filter(function (r) { return r.request_id === requestId; })[0].topic_id; });
      return skill.length === 1 && Number(skill[0].skill_level) === 4;
    }).map(function (p) { return { key: String(p.person_key), label: String(p.display_alias) + ' (' + p.person_key + ')' }; });
  return { sessionId: sessionId, phase: phase, order: order, mode: mode, caseIds: cases.map(function (c) { return c.case_id; }),
    personKeys: cases.map(function (c) { return c.person_key; }), durationMinutes: minutes, theorySessionId: theorySessionId,
    trainerChoices: choices, trainerKey: mode === 'group' ? 'MATT' : '' };
}

function getPhasePlanPreview(requestId, mode) {
  return phasePlanModel_(requestId, mode, readDemoTables_());
}

/** A later skill writer must call this gate using verified phase pass states. */
function canCompleteTargetLevel_(plan, passedSessionIds, caseId) {
  var linked = plan.phases.filter(function (p) { return p.caseIds.indexOf(caseId) >= 0; });
  if (!linked.length || linked.some(function (p) { return passedSessionIds.indexOf(p.sessionId) < 0; })) return false;
  return linked.every(function (p) { return !p.theorySessionId || passedSessionIds.indexOf(p.theorySessionId) >= 0; });
}

function savePhasePlan(input) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var plan = phasePlanModel_(input && input.requestId, input && input.mode, tables);
    var selected = input.trainers || {};
    var expectedKeys = plan.phases.filter(function (p) { return p.mode === 'individual'; }).map(function (p) { return p.sessionId; });
    if (Object.keys(selected).some(function (key) { return expectedKeys.indexOf(key) < 0; })) throw new Error('Unbekannte Trainerzuordnung.');
    plan.phases.forEach(function (p) {
      if (p.mode === 'individual') {
        if (!p.trainerChoices.some(function (t) { return t.key === selected[p.sessionId]; })) throw new Error('Kein qualifizierter Einzeltrainer für ' + p.sessionId + ' gewählt.');
        p.trainerKey = selected[p.sessionId];
      }
    });
    var spreadsheet = findDemoSpreadsheet_();
    var sessionSheet = spreadsheet.getSheetByName('Sessions');
    var linkSheet = spreadsheet.getSheetByName('SessionCases');
    var requestSheet = spreadsheet.getSheetByName('Requests');
    var existing = tables.Sessions.filter(function (s) { return s.request_id === plan.requestId; });
    var expectedIds = plan.phases.map(function (p) { return p.sessionId; });
    if (existing.some(function (s) { return expectedIds.indexOf(s.session_id) < 0; }) || new Set(existing.map(function (s) { return s.session_id; })).size !== existing.length) throw new Error('Widersprüchliche Sessionzeilen im Demo-Sheet.');
    var now = new Date().toISOString();
    var newSessions = [];
    var newLinks = [];
    plan.phases.forEach(function (p) {
      var saved = existing.filter(function (s) { return s.session_id === p.sessionId; })[0];
      if (saved) {
        if (saved.phase !== p.phase || Number(saved.phase_order) !== p.order || saved.mode !== p.mode || saved.trainer_key !== p.trainerKey || Number(saved.duration_minutes) !== p.durationMinutes || String(saved.theory_session_id || '') !== p.theorySessionId || ['planned', 'invited'].indexOf(saved.status) < 0) throw new Error('Vorhandener Phasenplan weicht ab.');
      } else newSessions.push([p.sessionId, plan.requestId, p.phase, p.order, p.mode, p.trainerKey, p.durationMinutes, p.theorySessionId, 'planned', now, '[DEMO]', '', '', '', '']);
      p.caseIds.forEach(function (caseId, i) {
        var links = tables.SessionCases.filter(function (l) { return l.session_id === p.sessionId && l.case_id === caseId; });
        if (links.length > 1 || (links.length && (links[0].request_id !== plan.requestId || links[0].person_key !== p.personKeys[i]))) throw new Error('Widersprüchlicher Session-Fall-Link.');
        if (!links.length) newLinks.push([p.sessionId, caseId, plan.requestId, p.personKeys[i], '[DEMO]']);
      });
    });
    if (tables.SessionCases.some(function (l) { return l.request_id === plan.requestId && (!plan.phases.some(function (p) { return p.sessionId === l.session_id && p.caseIds.indexOf(l.case_id) >= 0; })) })) throw new Error('Unerwarteter Session-Fall-Link.');
    if (newSessions.length) sessionSheet.getRange(sessionSheet.getLastRow() + 1, 1, newSessions.length, newSessions[0].length).setValues(newSessions);
    if (newLinks.length) linkSheet.getRange(linkSheet.getLastRow() + 1, 1, newLinks.length, newLinks[0].length).setValues(newLinks);
    var requestRows = tables.Requests.filter(function (r) { return r.request_id === plan.requestId; });
    if (requestRows.length !== 1) throw new Error('Auftragszeile ist nicht eindeutig.');
    if (!requestRows[0].mode) {
      var allRequests = requestSheet.getDataRange().getValues();
      var row = allRequests.findIndex(function (r) { return r[0] === plan.requestId; }) + 1;
      requestSheet.getRange(row, 8).setValue(plan.mode);
    }
    SpreadsheetApp.flush();
    return { plan: plan, reused: !newSessions.length && !newLinks.length };
  } finally { lock.releaseLock(); }
}
