/** Increment 06: read Calendar guest responses; keep them separate from attendance. */
var RSVP_RESPONSES = Object.freeze(['needsAction', 'accepted', 'tentative', 'declined']);

function priorBusinessDate_(startUtc) {
  var dateText = Utilities.formatDate(new Date(startUtc), SLOT_TIME_ZONE, 'yyyy-MM-dd');
  var day = new Date(dateText + 'T12:00:00Z');
  do { day.setUTCDate(day.getUTCDate() - 1); }
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
  return day.toISOString().slice(0, 10);
}

function rsvpFlag_(response, startUtc, now) {
  if (response === 'declined') return 'declined';
  var today = Utilities.formatDate(now, SLOT_TIME_ZONE, 'yyyy-MM-dd');
  return response === 'needsAction' && today >= priorBusinessDate_(startUtc) ? 'unanswered' : '';
}

function verifiedRsvpEvent_(session, event) {
  if (!event || event.status === 'cancelled' || event.id !== session.calendar_event_id ||
      event.id !== bookingEventId_(session.session_id)) throw new Error('Gebuchter Kalendereintrag fehlt oder wurde verändert.');
  var props = event.extendedProperties && event.extendedProperties.private || {};
  if (props.cosanumSessionId !== session.session_id || props.cosanumRequestId !== session.request_id || props.cosanumMarker !== 'DEMO' ||
      Date.parse(event.start && event.start.dateTime) !== Date.parse(session.start_utc) ||
      Date.parse(event.end && event.end.dateTime) !== Date.parse(session.end_utc) || event.attendeesOmitted === true) {
    throw new Error('Kalendereintrag stimmt nicht mit der Demo-Session überein.');
  }
  return event;
}

function rsvpSnapshotModel_(tables, getEvent, now) {
  var checkedAt = now.toISOString();
  var rows = [], errors = [];
  tables.Sessions.filter(function (s) { return s.demo_marker === '[DEMO]' && s.status === 'invited'; }).forEach(function (session) {
    try {
      if (!session.calendar_event_id || !session.start_utc || !session.end_utc) throw new Error('Kalenderbeleg in der Demo-Session fehlt.');
      var event = verifiedRsvpEvent_(session, getEvent(session.calendar_event_id));
      var links = tables.SessionCases.filter(function (l) { return l.session_id === session.session_id && l.demo_marker === '[DEMO]'; });
      if (!links.length || new Set(links.map(function (l) { return l.case_id; })).size !== links.length) throw new Error('Personenfälle der Session fehlen oder sind doppelt.');
      var sessionRows = links.map(function (link) {
        var cases = tables.ParticipantCases.filter(function (c) { return c.case_id === link.case_id && c.request_id === session.request_id && c.person_key === link.person_key && c.demo_marker === '[DEMO]'; });
        var people = tables.People.filter(function (p) { return p.person_key === link.person_key && p.demo_marker === '[DEMO]'; });
        if (cases.length !== 1 || people.length !== 1) throw new Error('Personenfall oder Testperson nicht eindeutig.');
        var email = String(people[0].email).trim().toLowerCase();
        var attendees = (event.attendees || []).filter(function (a) { return String(a.email || '').trim().toLowerCase() === email; });
        if (attendees.length !== 1) throw new Error('Einladung für einen Personenfall fehlt oder ist doppelt.');
        var response = String(attendees[0].responseStatus || 'needsAction');
        if (RSVP_RESPONSES.indexOf(response) < 0) throw new Error('Unbekannter Kalender-Antwortstatus.');
        return { sessionId: session.session_id, requestId: session.request_id, caseId: link.case_id,
          personKey: link.person_key, personAlias: String(people[0].display_alias),
          phase: session.phase, mode: session.mode, eventId: session.calendar_event_id,
          eventUrl: String(session.calendar_event_url || ''), startUtc: session.start_utc,
          responseStatus: response, checkedAt: checkedAt,
          flag: rsvpFlag_(response, session.start_utc, now) };
      });
      rows = rows.concat(sessionRows);
    } catch (error) {
      errors.push({ sessionId: session.session_id, reason: String(error.message || error) });
    }
  });
  return { checkedAt: checkedAt, rows: rows, errors: errors };
}

function saveRsvpSnapshot_(snapshot, spreadsheet) {
  var sheet = spreadsheet.getSheetByName('SessionRsvps');
  if (!sheet) throw new Error('RSVP-Register fehlt. setupDemo() ausführen.');
  var values = sheet.getDataRange().getValues();
  assertHeaders_(values[0], DEMO_SCHEMA.sheets.SessionRsvps, 'SessionRsvps');
  var existing = {};
  values.slice(1).forEach(function (row, index) {
    var key = String(row[0]) + '\n' + String(row[1]);
    if (existing[key]) throw new Error('Doppelter RSVP-Eintrag im Demo-Sheet.');
    existing[key] = { rowNumber: index + 2, row: row };
  });
  snapshot.rows.forEach(function (item) {
    var key = item.sessionId + '\n' + item.caseId;
    var previous = existing[key];
    if (previous && (previous.row[2] !== item.personKey || previous.row[3] !== item.eventId || previous.row[8] !== '[DEMO]')) {
      throw new Error('Widersprüchlicher RSVP-Eintrag im Demo-Sheet.');
    }
  });
  snapshot.rows.forEach(function (item) {
    var key = item.sessionId + '\n' + item.caseId;
    var previous = existing[key];
    var flaggedAt = item.flag ? previous && previous.row[6] === item.flag && previous.row[7] || item.checkedAt : '';
    var values = [[item.sessionId, item.caseId, item.personKey, item.eventId, item.responseStatus,
      item.checkedAt, item.flag, flaggedAt, '[DEMO]']];
    var rowNumber = previous ? previous.rowNumber : sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, values[0].length).setValues(values);
    existing[key] = { rowNumber: rowNumber, row: values[0] };
    item.flaggedAt = flaggedAt;
  });
  SpreadsheetApp.flush();
  return snapshot;
}

function refreshRsvpStatus() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var snapshot = rsvpSnapshotModel_(readDemoTables_(), calendarBookingGet_, new Date());
    return saveRsvpSnapshot_(snapshot, findDemoSpreadsheet_());
  } finally { lock.releaseLock(); }
}

/** Run after owner consents to script.scriptapp; repeated calls create no second trigger. */
function installRsvpDailyMonitor() {
  var matches = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'refreshRsvpStatus';
  });
  if (matches.length > 1) throw new Error('Mehrere RSVP-Zeittrigger vorhanden. Bitte prüfen.');
  if (matches.length === 1) return { installed: true, reused: true };
  ScriptApp.newTrigger('refreshRsvpStatus').timeBased().atHour(9).everyDays(1).inTimezone(SLOT_TIME_ZONE).create();
  return { installed: true, reused: false };
}
