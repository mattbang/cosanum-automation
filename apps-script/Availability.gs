/** Increment 04: read-only Zurich business-hour slot proposals. */
var SLOT_TIME_ZONE = 'Europe/Zurich';
var SLOT_HORIZON_DAYS = 21;

function localDatePlusDays_(dateText, days) {
  var pieces = dateText.split('-').map(Number);
  var day = new Date(Date.UTC(pieces[0], pieces[1] - 1, pieces[2] + days));
  return day.getUTCFullYear() + '-' + String(day.getUTCMonth() + 1).padStart(2, '0') + '-' + String(day.getUTCDate()).padStart(2, '0');
}

function businessDay_(dateText) {
  var parts = dateText.split('-').map(Number);
  var day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return day >= 1 && day <= 5;
}

function localDateTime_(dateText, minutes) {
  var hour = String(Math.floor(minutes / 60)).padStart(2, '0');
  var minute = String(minutes % 60).padStart(2, '0');
  return Utilities.parseDate(dateText + ' ' + hour + ':' + minute, SLOT_TIME_ZONE, 'yyyy-MM-dd HH:mm');
}

function calendarWindow_(now, days) {
  var today = Utilities.formatDate(now, SLOT_TIME_ZONE, 'yyyy-MM-dd');
  return { start: now.toISOString(), end: localDateTime_(localDatePlusDays_(today, days), 17 * 60).toISOString(), today: today };
}

function validatedCalendars_(people, response) {
  var byEmail = response && response.calendars || {};
  return people.map(function (person) {
    var result = { key: person.person_key, alias: String(person.display_alias || person.person_key), email: String(person.email || ''), ok: false, busy: [], error: '' };
    if (response && response.globalError) result.error = response.globalError;
    else if (!result.email) result.error = 'Kalenderadresse fehlt.';
    else {
      var calendar = byEmail[result.email];
      if (!calendar) result.error = 'Keine Kalenderantwort erhalten.';
      else if (calendar.errors && calendar.errors.length) result.error = calendar.errors.map(function (e) { return String(e.reason || 'unbekannter Fehler'); }).join(', ');
      else if (!Array.isArray(calendar.busy)) result.error = 'Keine gültigen Frei/Belegt-Daten erhalten.';
      else {
        result.busy = calendar.busy.map(function (entry) {
          return { start: Date.parse(entry.start), end: Date.parse(entry.end) };
        });
        if (result.busy.some(function (entry) { return !Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end < entry.start; })) {
          result.error = 'Ungültiges Belegt-Intervall in der Kalenderantwort.';
          result.busy = [];
        } else {
          result.busy = result.busy.filter(function (entry) { return entry.end > entry.start; });
          result.ok = true;
        }
      }
    }
    return result;
  });
}

function requiredPeopleForSession_(sessionId, tables) {
  var sessions = tables.Sessions.filter(function (s) { return s.session_id === sessionId; });
  if (sessions.length !== 1) throw new Error('Geplante Session nicht eindeutig gefunden.');
  var session = sessions[0];
  if (session.status !== 'planned' || session.demo_marker !== '[DEMO]' || [60, 180].indexOf(Number(session.duration_minutes)) < 0) {
    throw new Error('Nur gültige Demo-Sessions mit 60/180 Minuten können geprüft werden.');
  }
  var links = tables.SessionCases.filter(function (link) { return link.session_id === sessionId; });
  if (!links.length || new Set(links.map(function (link) { return link.case_id; })).size !== links.length) {
    throw new Error('Personenfälle der Session fehlen oder sind doppelt.');
  }
  var keys = [session.trainer_key];
  links.forEach(function (link) {
    var cases = tables.ParticipantCases.filter(function (c) { return c.case_id === link.case_id; });
    if (cases.length !== 1 || cases[0].request_id !== session.request_id || cases[0].person_key !== link.person_key || link.request_id !== session.request_id) {
      throw new Error('Personenfall und Session passen nicht zusammen.');
    }
    keys.push(link.person_key);
  });
  keys = Array.from(new Set(keys));
  var people = keys.map(function (key) {
    var matches = tables.People.filter(function (p) { return p.person_key === key && p.demo_marker === '[DEMO]'; });
    if (matches.length !== 1 || !matches[0].email) throw new Error('Kalenderadresse für ' + key + ' fehlt oder ist nicht eindeutig.');
    return matches[0];
  });
  if (new Set(people.map(function (p) { return String(p.email).toLowerCase(); })).size !== people.length) {
    throw new Error('Mehrere Demo-Personen benutzen dieselbe Kalenderadresse.');
  }
  return { session: session, people: people };
}

function availableCandidates_(now, durationMinutes, calendars, days) {
  var today = Utilities.formatDate(now, SLOT_TIME_ZONE, 'yyyy-MM-dd');
  var candidates = [];
  var minimumStart = now.getTime() + 15 * 60 * 1000;
  for (var offset = 0; offset < days; offset++) {
    var dateText = localDatePlusDays_(today, offset);
    if (!businessDay_(dateText)) continue;
    for (var minute = 9 * 60; minute + durationMinutes <= 17 * 60; minute += 30) {
      var start = localDateTime_(dateText, minute);
      var end = localDateTime_(dateText, minute + durationMinutes);
      if (start.getTime() <= minimumStart) continue;
      if (calendars.some(function (c) { return c.busy.some(function (b) { return start.getTime() < b.end && end.getTime() > b.start; }); })) continue;
      candidates.push({
        startUtc: start.toISOString(), endUtc: end.toISOString(),
        startLocal: Utilities.formatDate(start, SLOT_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        endLocal: Utilities.formatDate(end, SLOT_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        localDate: dateText, period: minute < 12 * 60 ? 'Vormittag' : 'Nachmittag',
        timeZone: SLOT_TIME_ZONE
      });
    }
  }
  return candidates;
}

function chooseVariedSlots_(candidates) {
  if (!candidates.length) return [];
  var selected = [candidates[0]];
  function pick(test) { return candidates.find(function (c) { return selected.indexOf(c) < 0 && test(c); }); }
  var second = pick(function (c) { return c.localDate !== selected[0].localDate && c.period !== selected[0].period; }) ||
    pick(function (c) { return c.localDate !== selected[0].localDate; }) ||
    pick(function (c) { return Math.abs(Date.parse(c.startUtc) - Date.parse(selected[0].startUtc)) >= 120 * 60000; }) ||
    pick(function () { return true; });
  if (second) selected.push(second);
  var third = pick(function (c) { return selected.every(function (s) { return c.localDate !== s.localDate; }); }) ||
    pick(function (c) { return selected.every(function (s) { return Math.abs(Date.parse(c.startUtc) - Date.parse(s.startUtc)) >= 120 * 60000; }); }) ||
    pick(function () { return true; });
  if (third) selected.push(third);
  return selected;
}

function slotProposalModel_(sessionId, tables, now, gateway) {
  var required = requiredPeopleForSession_(sessionId, tables);
  var window = calendarWindow_(now, SLOT_HORIZON_DAYS);
  var reply = gateway(required.people.map(function (p) { return String(p.email); }), window.start, window.end);
  var calendars = validatedCalendars_(required.people, reply);
  var blocked = calendars.filter(function (c) { return !c.ok; });
  var proposals = blocked.length ? [] : chooseVariedSlots_(availableCandidates_(now, Number(required.session.duration_minutes), calendars, SLOT_HORIZON_DAYS));
  var reason = blocked.length ? 'Mindestens ein Kalender ist nicht lesbar. Es werden keine Termine vorgeschlagen.' :
    proposals.length < 3 ? 'Im Zeitraum von 21 Tagen wurden nur ' + proposals.length + ' freie Vorschläge gefunden.' : '';
  return { sessionId: sessionId, durationMinutes: Number(required.session.duration_minutes), timeZone: SLOT_TIME_ZONE,
    windowStartUtc: window.start, windowEndUtc: window.end, calendars: calendars, proposals: proposals, reason: reason };
}

function getSlotProposals(sessionId) {
  return slotProposalModel_(sessionId, readDemoTables_(), new Date(), queryCalendarFreeBusy_);
}

/** Administrator diagnostic: each of the four test calendars gets an explicit result. */
function checkDemoCalendarAccess() {
  var tables = readDemoTables_();
  var people = tables.People.filter(function (p) { return p.demo_marker === '[DEMO]'; });
  if (people.length !== 4) throw new Error('Vier Demo-Kalender werden erwartet.');
  var window = calendarWindow_(new Date(), 7);
  return { timeZone: SLOT_TIME_ZONE, calendars: validatedCalendars_(people,
    queryCalendarFreeBusy_(people.map(function (p) { return String(p.email); }), window.start, window.end)) };
}
