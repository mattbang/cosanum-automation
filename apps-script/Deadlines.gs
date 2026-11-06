/** Calendar-day deadline projections and append-only owner changes. */
function deadlineDay_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Frist muss ein Datum im Format JJJJ-MM-TT sein.');
  var parts = value.split('-').map(Number);
  var stamp = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  if (parts[0] < 1000 || new Date(stamp).toISOString().slice(0, 10) !== value) throw new Error('Ungültiges Fristdatum.');
  return stamp / 86400000;
}

function deadlineLocalDate_(instant) {
  var date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error('Ungültiger Zeitpunkt für die Fristprüfung.');
  return Utilities.formatDate(date, 'Europe/Zurich', 'yyyy-MM-dd');
}

function deadlineText_(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength || /^[=+@-]/.test(value.trim()) || /[\r\n\t\x00-\x1f]/.test(value)) {
    throw new Error(label + ' fehlt oder ist ungültig.');
  }
  return value.trim();
}

function deadlineCaseIds_(row) {
  if (row.case_scope_json === '' || row.case_scope_json === undefined || row.case_scope_json === null) return null;
  var ids;
  try { ids = JSON.parse(row.case_scope_json); }
  catch (_) { throw new Error('Ungültiger Frist-Geltungsbereich.'); }
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(function (id) {
    return typeof id !== 'string' || !id || id !== id.trim();
  })) throw new Error('Ungültiger Frist-Geltungsbereich.');
  if (row.source === 'policy' && (ids.length !== 1 || ids[0] !== row.case_id)) throw new Error('Frist-Geltungsbereich passt nicht zum Personenfall.');
  return ids;
}

function deadlineScopeBindings_(tables, requestId) {
  var cases = tables.ParticipantCases.filter(function (row) {
    return row.request_id === requestId && row.demo_marker === '[DEMO]';
  });
  var ids = new Set(cases.map(function (row) { return row.case_id; }));
  if (!cases.length || ids.size !== cases.length || new Set(cases.map(function (row) { return row.person_key; })).size !== cases.length || cases.some(function (row) {
    return typeof row.case_id !== 'string' || !row.case_id || !row.person_key || tables.ParticipantCases.filter(function (candidate) { return candidate.case_id === row.case_id; }).length !== 1;
  })) throw new Error('Personenfallregister für die Frist ist widersprüchlich.');
  (tables.DeadlineChanges || []).filter(function (row) { return row.request_id === requestId; }).forEach(function (row) {
    var scope = deadlineCaseIds_(row);
    if ((row.source !== 'request' && row.source !== 'policy') ||
        (row.source === 'request' && String(row.case_id || '') !== '') ||
        (row.source === 'policy' && !ids.has(row.case_id)) ||
        (scope && scope.some(function (id) { return !ids.has(id); }))) {
      throw new Error('Frist-Geltungsbereich passt nicht zu den Personenfällen des Auftrags.');
    }
  });
  return cases;
}

function deadlineStream_(rows, requestId, caseId, source) {
  var found = (rows || []).filter(function (row) {
    return row.request_id === requestId && String(row.case_id || '') === caseId && row.source === source;
  });
  found.forEach(function (row, index) {
    deadlineDay_(row.due_date);
    deadlineCaseIds_(row);
    if (row.demo_marker !== '[DEMO]' || Number(row.revision) !== index + 1 || Number(row.previous_revision) !== index ||
        !row.change_id || !row.source_reference || row.owner_key !== 'MATT' || !row.reason || !row.actor_email ||
        !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(String(row.recorded_at)) || !Number.isFinite(Date.parse(row.recorded_at))) {
      throw new Error('Fristhistorie ist widersprüchlich; Register prüfen.');
    }
  });
  if (new Set(found.map(function (row) { return row.change_id; })).size !== found.length) throw new Error('Doppelte Friständerung im Register.');
  return found;
}

function deadlineSourceView_(history) {
  if (!history.length) return null;
  var latest = history[history.length - 1];
  return { date: latest.due_date, originalDate: history[0].due_date, revision: Number(latest.revision),
    source: latest.source, reference: latest.source_reference, ownerKey: latest.owner_key,
    history: history.map(function (row) { var ids = deadlineCaseIds_(row); return { date: row.due_date, revision: Number(row.revision), reference: row.source_reference,
      reason: row.reason, recordedAt: row.recorded_at, actorEmail: row.actor_email, caseIds: ids,
      legacyGlobal: row.source === 'request' && ids === null }; }) };
}

function deadlineCaseView_(request, personCase, auditCase, rows, now) {
  var requestHistory = deadlineStream_(rows, request.request_id, '', 'request');
  requestHistory = requestHistory.filter(function (row) {
    var scope = deadlineCaseIds_(row);
    return scope === null || scope.indexOf(personCase.case_id) >= 0;
  });
  var policyHistory = deadlineStream_(rows, request.request_id, personCase.case_id, 'policy');
  var completionTime = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(auditCase.skillAppliedAt || '') ? Date.parse(auditCase.skillAppliedAt) : NaN;
  if (auditCase.state === 'complete' && Number.isFinite(completionTime)) {
    requestHistory = requestHistory.filter(function (row) { return Date.parse(row.recorded_at) <= completionTime; });
    policyHistory = policyHistory.filter(function (row) { return Date.parse(row.recorded_at) <= completionTime; });
  }
  var requestDate = deadlineSourceView_(requestHistory);
  var policyDate = deadlineSourceView_(policyHistory);
  var sources = [requestDate, policyDate].filter(Boolean).sort(function (a, b) { return a.date.localeCompare(b.date); });
  var effective = sources.length ? sources[0].date : '';
  var today = deadlineLocalDate_(now);
  var remaining = effective ? deadlineDay_(effective) - deadlineDay_(today) : null;
  var rawStatus = String(personCase.status || request.status || '');
  var state = !effective ? 'unset' : remaining < 0 ? 'overdue' : remaining === 0 ? 'due_today' : 'upcoming';
  var daysLate = null;
  if (request.status === 'cancelled' || rawStatus === 'cancelled') state = 'cancelled';
  else if (rawStatus === 'exception_approved') state = 'exception_approved';
  else if (auditCase.state === 'complete') {
    state = effective ? 'completed_time_unknown' : 'completed_no_deadline';
    if (effective && Number.isFinite(completionTime)) {
      daysLate = Math.max(0, deadlineDay_(deadlineLocalDate_(auditCase.skillAppliedAt)) - deadlineDay_(effective));
      state = daysLate ? 'completed_late' : 'completed_on_time';
    }
  }
  return { date: effective, today: today, state: state, request: requestDate, policy: policyDate,
    daysRemaining: remaining, daysOverdue: state === 'overdue' ? -remaining : 0, daysLate: daysLate,
    workflowState: auditCase.state, editable: auditCase.state !== 'complete' && state !== 'cancelled' && state !== 'exception_approved' };
}

function deadlineRequestView_(tables, request, view, now) {
  var rows = tables.DeadlineChanges || [];
  deadlineScopeBindings_(tables, request.request_id);
  var source = deadlineSourceView_(deadlineStream_(rows, request.request_id, '', 'request'));
  view.cases.forEach(function (row) {
    var personCase = proofUnique_(tables.ParticipantCases, function (candidate) {
      return candidate.case_id === row.caseId && candidate.request_id === request.request_id && candidate.demo_marker === '[DEMO]';
    }, 'Personenfall für die Frist');
    row.deadline = deadlineCaseView_(request, personCase, row, rows, now);
  });
  var active = view.cases.filter(function (row) { return row.deadline.editable; });
  var dates = active.map(function (row) { return row.deadline.date; }).filter(Boolean).sort();
  view.deadline = { request: source, date: dates[0] || (source ? source.date : ''),
    overdueCount: active.filter(function (row) { return row.deadline.state === 'overdue'; }).length,
    dueTodayCount: active.filter(function (row) { return row.deadline.state === 'due_today'; }).length,
    unsetCount: active.filter(function (row) { return row.deadline.state === 'unset'; }).length };
  return view;
}

function deadlineChange_(input, tables, now, actorEmail) {
  if (!input || typeof input.actionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.actionId)) throw new Error('Ungültige Fristaktions-ID.');
  var request = proofUnique_(tables.Requests, function (row) { return row.request_id === input.requestId && row.demo_marker === '[DEMO]'; }, 'Demo-Auftrag für die Frist');
  var requestCases = deadlineScopeBindings_(tables, request.request_id);
  if (input.caseId !== undefined && typeof input.caseId !== 'string') throw new Error('Ungültige Personenfall-ID.');
  var caseId = input.caseId || '';
  var source = caseId ? 'policy' : 'request';
  deadlineDay_(input.date);
  var reference = deadlineText_(input.reference, 'Quellenreferenz mit Version', 160);
  var reason = deadlineText_(input.reason, 'Änderungsgrund', 500);
  if (caseId && input.policyApproved !== true) throw new Error('Nur eine bereits freigegebene Vorgabe darf erfasst werden.');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision === Number.MAX_SAFE_INTEGER) throw new Error('Ungültige Fristversion.');
  var history = deadlineStream_(tables.DeadlineChanges, request.request_id, caseId, source);
  var command = { change_id: input.actionId, request_id: request.request_id, case_id: caseId, source: source,
    due_date: input.date, source_reference: reference, owner_key: 'MATT', previous_revision: input.expectedRevision,
    revision: input.expectedRevision + 1, reason: reason, recorded_at: now.toISOString(), actor_email: actorEmail, demo_marker: '[DEMO]' };
  var replay = (tables.DeadlineChanges || []).filter(function (row) { return row.change_id === input.actionId; });
  if (replay.length > 1) throw new Error('Doppelte Fristaktions-ID.');
  if (replay.length) {
    var exact = ['request_id', 'case_id', 'source', 'due_date', 'source_reference', 'owner_key', 'previous_revision', 'reason', 'actor_email'].every(function (key) {
      return String(replay[0][key]) === String(command[key]);
    });
    if (!exact) throw new Error('Diese Fristaktions-ID gehört zu einer anderen Änderung.');
    return { row: replay[0], reused: true };
  }
  if (history.length !== input.expectedRevision) throw new Error('Frist wurde inzwischen geändert. Register neu lesen.');
  var cases = requestCases.filter(function (row) { return !caseId || row.case_id === caseId; });
  if (!cases.length || (caseId && cases.length !== 1)) throw new Error('Personenfall gehört nicht eindeutig zum Auftrag.');
  var editableCases = cases.filter(function (row) {
    var audit = auditCase_(tables, row, now);
    return deadlineCaseView_(request, row, audit, tables.DeadlineChanges || [], now).editable;
  });
  if (!editableCases.length || (caseId && editableCases.length !== 1)) throw new Error('Abgeschlossene, stornierte oder ausgenommene Fälle behalten ihre Frist.');
  command.case_scope_json = JSON.stringify(editableCases.map(function (row) { return row.case_id; }).sort());
  return { row: command, reused: false };
}

function saveRequestDeadline_(input) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return deadlineSaveLocked_(input);
  } finally { lock.releaseLock(); }
}

function deadlineSaveLocked_(input) {
  var tables = readDemoTables_();
  var owner = auditOwner_(tables);
  var change = deadlineChange_(input, tables, new Date(), owner);
  var sheet = findDemoSpreadsheet_().getSheetByName('DeadlineChanges');
  if (!sheet) throw new Error('Fristregister fehlt. Zuerst das geprüfte Schema-Setup ausführen.');
  if (!change.reused) {
    sheet.appendRow(DEMO_SCHEMA.sheets.DeadlineChanges.map(function (key) { return change.row[key]; }));
    SpreadsheetApp.flush();
  }
  var reread = readDemoTables_();
  var saved = deadlineStream_(reread.DeadlineChanges, change.row.request_id, change.row.case_id, change.row.source).filter(function (row) { return row.change_id === change.row.change_id; });
  if (saved.length !== 1 || DEMO_SCHEMA.sheets.DeadlineChanges.some(function (key) { return String(saved[0][key]) !== String(change.row[key]); })) throw new Error('Frist konnte nicht bestätigt werden. Dieselbe Aktion erneut versuchen.');
  return { requestId: change.row.request_id, caseId: change.row.case_id, revision: Number(change.row.revision), date: change.row.due_date,
    caseIds: deadlineCaseIds_(change.row), recordedAt: change.row.recorded_at, reused: change.reused };
}

function deadlineDraftInput_(input) {
  var initial = input.initialDeadline;
  if (!initial || typeof initial !== 'object') throw new Error('Anfragefrist fehlt.');
  deadlineDay_(initial.date);
  return { actionId: input.actionId, date: initial.date, reference: deadlineText_(initial.reference, 'Anfragequelle', 160),
    expectedRevision: 0, reason: 'Erstmalige Frist aus der Bedarfsanfrage' };
}

function deadlineSaveDraftLocked_(input, requestId) {
  var command = deadlineDraftInput_(input);
  command.requestId = requestId;
  return deadlineSaveLocked_(command);
}
