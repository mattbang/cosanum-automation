/** Pure eligibility rule. The Sheet is the only source of attained levels. */
function eligibility_(topic, rawLevel, target) {
  if (rawLevel === '–' || rawLevel === '-') return { allowed: false, reason: 'Diese Tätigkeit ist für die Person nicht vorgesehen (–). Bitte den Matrixeintrag im Demo-Sheet prüfen.' };
  if (rawLevel === '' || rawLevel === null || rawLevel === undefined) return { allowed: false, reason: 'Die Skillstufe ist leer oder unbekannt. Bitte zuerst den Matrixeintrag im Demo-Sheet korrigieren.' };
  var current = Number(rawLevel);
  if (!Number.isInteger(current) || current < 0 || current > 4) return { allowed: false, reason: 'Ungültige Skillstufe im Demo-Sheet. Bitte den Matrixeintrag prüfen.' };
  if (topic.progression_rule === '0→1→2→3') {
    if (!Number.isInteger(target) || target < 1 || target > 3) return { allowed: false, reason: 'Für dieses Thema ist nur eine Zielstufe von 1 bis 3 erlaubt.' };
    if (current >= 3) return { allowed: false, reason: 'Für Stufe ' + current + ' gibt es in dieser Demo keine weitere Progression.' };
    if (target <= current) return { allowed: false, reason: 'Stufe ' + target + ' ist bereits erreicht. Für Stufe ' + current + ' ist nur Stufe ' + (current + 1) + ' die nächste Progression.' };
    if (target !== current + 1) return { allowed: false, reason: 'Stufe ' + current + ' darf nur direkt zu Stufe ' + (current + 1) + ' führen. Übersprungene Stufen sind gesperrt.' };
    return { allowed: true, reason: 'Nächste Skillstufe zulässig.' };
  }
  var configured = Number(topic.configured_target_level);
  if (!Number.isInteger(configured) || configured < 1 || configured > 3) throw new Error('Explizite Zielstufe für ' + topic.topic_id + ' fehlt oder ist ungültig.');
  if (target !== configured) return { allowed: false, reason: 'Für dieses Thema ist ausschliesslich die konfigurierte Zielstufe ' + configured + ' erlaubt.' };
  if (current >= configured) return { allowed: false, reason: 'Die konfigurierte Zielstufe ' + configured + ' ist bereits erreicht oder unterschritten.' };
  return { allowed: true, reason: 'Explizit konfigurierte Zielstufe zulässig.' };
}

function getIntakeData() {
  var tables = readDemoTables_();
  catalogueView_(tables.Topics, tables.People);
  return {
    marker: '[DEMO]',
    topics: tables.Topics.map(function (t) { return {
      id: String(t.topic_id), name: String(t.display_name),
      progression: t.progression_rule === '0→1→2→3',
      configuredTarget: t.progression_rule === '0→1→2→3' ? null : Number(t.configured_target_level)
    }; }),
    people: tables.People.map(function (p) { return { key: String(p.person_key), alias: String(p.display_alias), personaId: String(p.persona_id), role: String(p.demo_role) }; })
  };
}

function intakeSelection_(input, tables) {
  if (!input || typeof input !== 'object') throw new Error('Auswahl fehlt.');
  var topic = tables.Topics.filter(function (t) { return t.topic_id === input.topicId; })[0];
  if (!topic) throw new Error('Bitte eines der fünf Demo-Themen wählen.');
  var keys = input.personKeys;
  if (!Array.isArray(keys) || !keys.length || keys.length > 4 || new Set(keys).size !== keys.length) throw new Error('Bitte eine bis vier verschiedene Testpersonen wählen.');
  var target = Number(input.targetLevel);
  if (!Number.isInteger(target)) throw new Error('Bitte eine gültige Zielstufe wählen.');
  var spreadsheet = findDemoSpreadsheet_();
  var sheet = spreadsheet.getSheetByName('Skills');
  var rows = keys.map(function (key) {
    var person = tables.People.filter(function (p) { return p.person_key === key; })[0];
    if (!person) throw new Error('Unbekannte Testperson: ' + key);
    var matches = tables.Skills.filter(function (s) { return s.person_key === key && s.topic_id === topic.topic_id; });
    if (matches.length !== 1) throw new Error('Die Demo-Matrix enthält keinen eindeutigen Eintrag für ' + key + '.');
    var skill = matches[0];
    var index = tables.Skills.indexOf(skill) + 2;
    var result = eligibility_(topic, skill.skill_level, target);
    return {
      personKey: key, personAlias: String(person.display_alias), currentLevel: skill.skill_level === '' ? '' : String(skill.skill_level),
      targetLevel: target, allowed: result.allowed, reason: result.reason,
      sheetUrl: demoSheetLink_(spreadsheet, sheet, index)
    };
  });
  return { topicId: topic.topic_id, topicName: String(topic.display_name), targetLevel: target,
    rows: rows, allAllowed: rows.every(function (row) { return row.allowed; }) };
}

function getIntakePreview(input) {
  return intakeSelection_(input, readDemoTables_());
}

/** Retry key comes from the browser and is persisted before returning. */
function saveDraftRequest(input) {
  if (!input || typeof input.actionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.actionId)) {
    throw new Error('Ungültige Aktions-ID. Bitte die Seite neu laden.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tables = readDemoTables_();
    var existing = tables.Requests.filter(function (r) { return r.action_id === input.actionId; });
    if (existing.length > 1) throw new Error('Doppelte Aktions-ID im Demo-Sheet. Bitte prüfen.');
    if (existing.length) {
      var saved = existing[0];
      var savedCases = tables.ParticipantCases.filter(function (c) { return c.request_id === saved.request_id; });
      var submitted = (input.personKeys || []).slice().sort().join('|');
      var stored = savedCases.map(function (c) { return c.person_key; }).sort().join('|');
      if (savedCases.length !== input.personKeys.length) throw new Error('Entwurf ist unvollständig gespeichert. Bitte den Demo-Sheet-Eintrag prüfen.');
      if (saved.topic_id !== input.topicId || Number(saved.target_level) !== Number(input.targetLevel) || submitted !== stored) {
        throw new Error('Diese Aktions-ID gehört bereits zu einem anderen Entwurf. Bitte die Seite neu laden.');
      }
      return draftResult_(saved, savedCases, true);
    }
    var preview = intakeSelection_(input, tables);
    if (!preview.allAllowed) throw new Error('Mindestens eine Person ist gesperrt. Matrix prüfen und Auswahl erneut laden.');
    var spreadsheet = findDemoSpreadsheet_();
    var requestId = 'REQ-' + input.actionId.toUpperCase();
    var now = new Date().toISOString();
    var request = [requestId, input.actionId, preview.topicId, preview.targetLevel, 'draft', now, '[DEMO]', ''];
    var cases = preview.rows.map(function (row) { return [
      'CASE-' + input.actionId.toUpperCase() + '-' + row.personKey,
      requestId, row.personKey, Number(row.currentLevel), row.targetLevel, 'draft', now, '[DEMO]'
    ]; });
    var casesSheet = spreadsheet.getSheetByName('ParticipantCases');
    var requestsSheet = spreadsheet.getSheetByName('Requests');
    var orphan = tables.ParticipantCases.filter(function (c) { return c.request_id === requestId; });
    if (orphan.length) {
      var expected = cases.map(function (c) { return c[0]; }).sort().join('|');
      var actual = orphan.map(function (c) { return c.case_id; }).sort().join('|');
      var inconsistent = orphan.some(function (savedCase) {
        var planned = cases.filter(function (c) { return c[0] === savedCase.case_id; })[0];
        return !planned || savedCase.person_key !== planned[2] || Number(savedCase.current_level) !== planned[3] || Number(savedCase.target_level) !== planned[4];
      });
      if (expected !== actual || inconsistent) throw new Error('Widersprüchliche Fallzeilen für diese Aktions-ID. Bitte den Demo-Sheet-Eintrag prüfen.');
    } else {
      casesSheet.getRange(casesSheet.getLastRow() + 1, 1, cases.length, cases[0].length).setValues(cases);
    }
    requestsSheet.appendRow(request);
    SpreadsheetApp.flush();
    return draftResult_({request_id: requestId, status: 'draft', mode: ''}, cases.map(function (c) { return {case_id: c[0], person_key: c[2]}; }), false);
  } finally {
    lock.releaseLock();
  }
}

function draftResult_(request, cases, reused) {
  return { requestId: String(request.request_id), status: String(request.status), mode: String(request.mode || ''), reused: reused,
    cases: cases.map(function (c) { return { caseId: String(c.case_id), personKey: String(c.person_key) }; }) };
}
