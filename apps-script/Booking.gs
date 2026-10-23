/** Increment 05: one invitation event per planned demo session. */
var BOOKING_CALENDAR_ID = 'primary';

function bookingEventId_(sessionId) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sessionId, Utilities.Charset.UTF_8);
  return 'cosanum' + digest.map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function safeEventLabel_(value) {
  var label = String(value || '').replace(/[\r\n\t<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label || label.length > 160) throw new Error('Ungültiger Anzeigetext für die Kalendereinladung.');
  return label;
}

function bookingMembers_(session, tables) {
  var links = tables.SessionCases.filter(function (link) { return link.session_id === session.session_id; });
  return Array.from(new Set([session.trainer_key].concat(links.map(function (link) { return link.person_key; }))));
}

function validateBookingOrder_(session, slot, tables, getEvent) {
  var start = Date.parse(slot.startUtc);
  var end = Date.parse(slot.endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Ungültiges Terminintervall.');
  if (session.theory_session_id) {
    var theories = tables.Sessions.filter(function (s) { return s.session_id === session.theory_session_id; });
    if (theories.length !== 1 || theories[0].request_id !== session.request_id || theories[0].phase !== 'theory' || theories[0].status !== 'invited' || !theories[0].calendar_event_id) {
      throw new Error('Zuerst muss der verknüpfte Theorietermin gebucht werden.');
    }
    var theory = theories[0];
    var theoryEvent = getEvent(theory.calendar_event_id);
    if (!theoryEvent || theoryEvent.status === 'cancelled' || theory.calendar_event_id !== bookingEventId_(theory.session_id) ||
        Date.parse(theoryEvent.end && theoryEvent.end.dateTime) !== Date.parse(theory.end_utc)) {
      throw new Error('Der gebuchte Theorietermin konnte nicht bestätigt werden.');
    }
    if (start < Date.parse(theory.end_utc)) throw new Error('Praxis muss nach dem Theorietermin beginnen.');
  }
  var members = bookingMembers_(session, tables);
  tables.Sessions.forEach(function (other) {
    if (other.session_id === session.session_id || other.status !== 'invited') return;
    if (!other.start_utc || !other.end_utc || !other.calendar_event_id) throw new Error('Ein gebuchter Termin hat einen unvollständigen Kalendereintrag.');
    if (members.some(function (key) { return bookingMembers_(other, tables).indexOf(key) >= 0; }) &&
        start < Date.parse(other.end_utc) && end > Date.parse(other.start_utc)) {
      throw new Error('Der Termin überschneidet sich mit einer bereits gebuchten Phase.');
    }
  });
}

function bookingEvent_(required, tables, slot) {
  var session = required.session;
  var requests = tables.Requests.filter(function (r) { return r.request_id === session.request_id && r.demo_marker === '[DEMO]'; });
  if (requests.length !== 1) throw new Error('Demo-Auftrag für die Einladung nicht eindeutig.');
  var topics = tables.Topics.filter(function (t) { return t.topic_id === requests[0].topic_id && t.demo_marker === '[DEMO]'; });
  if (topics.length !== 1) throw new Error('Demo-Thema für die Einladung nicht eindeutig.');
  var trainer = required.people.filter(function (p) { return p.person_key === session.trainer_key; })[0];
  if (!trainer) throw new Error('Trainer für die Einladung fehlt.');
  var topic = safeEventLabel_(topics[0].display_name);
  var trainerName = safeEventLabel_(trainer.display_alias);
  var phase = session.phase === 'theory' ? 'Theorie' : session.phase === 'practice' ? 'Praxis' : '';
  if (!phase) throw new Error('Unbekannte Schulungsphase.');
  return {
    id: bookingEventId_(session.session_id),
    summary: '[DEMO] Schulung: ' + topic + ' · ' + phase,
    description: [
      'Schulungsthema: ' + topic,
      'Teil: ' + phase + ' (' + Number(session.duration_minutes) + ' Minuten)',
      'Schulende Person: ' + trainerName,
      'Material: nicht bereitgestellt',
      '',
      'Bitte beantworten Sie die Kalendereinladung. Wenn Sie nicht teilnehmen können,',
      'lehnen Sie ab; Daniel klärt einen Ersatztermin.',
      '',
      'Auftrag: ' + session.request_id + ' · Termin: ' + session.session_id + ' [DEMO]'
    ].join('\n'),
    start: { dateTime: slot.startLocal, timeZone: SLOT_TIME_ZONE },
    end: { dateTime: slot.endLocal, timeZone: SLOT_TIME_ZONE },
    attendees: required.people.map(function (p) { return { email: String(p.email) }; }),
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    extendedProperties: { private: { cosanumSessionId: session.session_id, cosanumRequestId: session.request_id, cosanumMarker: 'DEMO' } }
  };
}

function verifyBookingEvent_(event, expected, slot) {
  if (!event || event.status === 'cancelled' || event.id !== expected.id) throw new Error('Kalendereintrag fehlt oder wurde verändert.');
  var privateProps = event.extendedProperties && event.extendedProperties.private || {};
  if (privateProps.cosanumSessionId !== expected.extendedProperties.private.cosanumSessionId ||
      privateProps.cosanumRequestId !== expected.extendedProperties.private.cosanumRequestId || privateProps.cosanumMarker !== 'DEMO') {
    throw new Error('Kalendereintrag gehört nicht zu dieser Demo-Session.');
  }
  if (Date.parse(event.start && event.start.dateTime) !== Date.parse(slot.startUtc) ||
      Date.parse(event.end && event.end.dateTime) !== Date.parse(slot.endUtc)) {
    throw new Error('Kalenderzeit und ausgewählter Vorschlag stimmen nicht überein.');
  }
  var actual = (event.attendees || []).map(function (a) { return String(a.email || '').toLowerCase(); });
  if (event.organizer && event.organizer.email) actual.push(String(event.organizer.email).toLowerCase());
  var expectedEmails = expected.attendees.map(function (a) { return String(a.email).toLowerCase(); });
  if (expectedEmails.some(function (email) { return actual.indexOf(email) < 0; })) throw new Error('Kalendereinladung enthält nicht alle vorgesehenen Personen.');
  return { eventId: event.id, eventUrl: String(event.htmlLink || ''), startUtc: slot.startUtc, endUtc: slot.endUtc };
}

function bookingResult_(session, receipt, reused) {
  return { sessionId: session.session_id, requestId: session.request_id, eventId: receipt.eventId,
    eventUrl: receipt.eventUrl, startUtc: receipt.startUtc, endUtc: receipt.endUtc,
    startLocal: Utilities.formatDate(new Date(receipt.startUtc), SLOT_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    endLocal: Utilities.formatDate(new Date(receipt.endUtc), SLOT_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    timeZone: SLOT_TIME_ZONE, reused: reused };
}

/** Dependencies are explicit so retry and failure behavior can be verified locally. */
function bookSessionCore_(input, services) {
  if (!input || typeof input.sessionId !== 'string' || typeof input.startUtc !== 'string' || typeof input.endUtc !== 'string') {
    throw new Error('Session und ausgewählter Vorschlag fehlen.');
  }
  var tables = services.readTables();
  var sessions = tables.Sessions.filter(function (s) { return s.session_id === input.sessionId; });
  if (sessions.length !== 1 || sessions[0].demo_marker !== '[DEMO]') throw new Error('Demo-Session nicht eindeutig gefunden.');
  var session = sessions[0];
  if (['planned', 'invited'].indexOf(session.status) < 0) throw new Error('Diese Session kann nicht gebucht werden.');
  var required = requiredPeopleForSession_(session.session_id, Object.assign({}, tables, {
    Sessions: [Object.assign({}, session, { status: 'planned' })]
  }));
  var selected = { startUtc: input.startUtc, endUtc: input.endUtc };
  var expectedId = bookingEventId_(session.session_id);
  if (session.calendar_event_id && session.calendar_event_id !== expectedId) throw new Error('Widersprüchliche Kalender-ID im Demo-Sheet.');
  if (session.start_utc && session.start_utc !== selected.startUtc || session.end_utc && session.end_utc !== selected.endUtc) {
    throw new Error('Diese Session ist bereits für einen anderen Termin gebucht.');
  }
  var existing = services.getEvent(expectedId);
  if (session.status === 'invited' && !existing) throw new Error('Gebuchter Kalendereintrag fehlt. Bitte prüfen.');
  if (existing) {
    var existingSlot = { startUtc: selected.startUtc, endUtc: selected.endUtc,
      startLocal: Utilities.formatDate(new Date(selected.startUtc), SLOT_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      endLocal: Utilities.formatDate(new Date(selected.endUtc), SLOT_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") };
    var expectedExisting = bookingEvent_(required, tables, existingSlot);
    var recovered = verifyBookingEvent_(existing, expectedExisting, existingSlot);
    services.saveReceipt(session, recovered);
    return bookingResult_(session, recovered, true);
  }
  if (session.status !== 'planned' || session.calendar_event_id || session.start_utc || session.end_utc || session.calendar_event_url) {
    throw new Error('Unvollständige Buchungsdaten im Demo-Sheet.');
  }
  var now = services.now();
  var window = calendarWindow_(now, SLOT_HORIZON_DAYS);
  var response = services.freeBusy(required.people.map(function (p) { return String(p.email); }), window.start, window.end);
  var calendars = validatedCalendars_(required.people, response);
  if (calendars.some(function (c) { return !c.ok; })) throw new Error('Kalenderzugriff fehlt. Es wurde kein Termin gebucht.');
  var matches = availableCandidates_(now, Number(session.duration_minutes), calendars, SLOT_HORIZON_DAYS).filter(function (slot) {
    return slot.startUtc === selected.startUtc && slot.endUtc === selected.endUtc;
  });
  if (matches.length !== 1) throw new Error('Der ausgewählte Vorschlag ist nicht mehr frei. Bitte neu prüfen.');
  var slot = matches[0];
  validateBookingOrder_(session, slot, tables, services.getEvent);
  var eventBody = bookingEvent_(required, tables, slot);
  var event;
  try {
    event = services.insertEvent(eventBody);
  } catch (error) {
    event = services.getEvent(expectedId);
    if (!event) throw error;
  }
  var receipt = verifyBookingEvent_(event, eventBody, slot);
  services.saveReceipt(session, receipt);
  return bookingResult_(session, receipt, false);
}

function calendarBookingGet_(eventId) {
  try { return Calendar.Events.get(BOOKING_CALENDAR_ID, eventId); }
  catch (error) {
    if (/\b404\b|not found/i.test(String(error.message || error))) return null;
    throw error;
  }
}

function saveBookingReceipt_(session, receipt) {
  var sheet = findDemoSpreadsheet_().getSheetByName('Sessions');
  var values = sheet.getDataRange().getValues();
  assertHeaders_(values[0], DEMO_SCHEMA.sheets.Sessions, 'Sessions');
  var matching = [];
  values.slice(1).forEach(function (row, index) { if (row[0] === session.session_id) matching.push({ row: row, number: index + 2 }); });
  if (matching.length !== 1) throw new Error('Sessionzeile für Kalendereintrag nicht eindeutig.');
  var row = matching[0].row;
  if (['planned', 'invited'].indexOf(row[8]) < 0) throw new Error('Sessionstatus hat sich während der Buchung geändert.');
  if (row[11] && row[11] !== receipt.eventId || row[12] && row[12] !== receipt.startUtc || row[13] && row[13] !== receipt.endUtc) {
    throw new Error('Widersprüchlicher Kalendereintrag im Demo-Sheet.');
  }
  sheet.getRange(matching[0].number, 12, 1, 4).setValues([[receipt.eventId, receipt.startUtc, receipt.endUtc, receipt.eventUrl]]);
  sheet.getRange(matching[0].number, 9).setValue('invited');
  SpreadsheetApp.flush();
}

function bookSelectedSlot(input) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return bookSessionCore_(input, {
      readTables: readDemoTables_, now: function () { return new Date(); }, freeBusy: queryCalendarFreeBusy_,
      getEvent: calendarBookingGet_,
      insertEvent: function (body) { return Calendar.Events.insert(body, BOOKING_CALENDAR_ID, { sendUpdates: 'all' }); },
      saveReceipt: saveBookingReceipt_
    });
  } finally { lock.releaseLock(); }
}
