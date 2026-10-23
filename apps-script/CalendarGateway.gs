/** Read-only Google Calendar free/busy gateway. No event methods belong here. */
function queryCalendarFreeBusy_(emails, timeMin, timeMax) {
  try {
    return Calendar.Freebusy.query({
      timeMin: timeMin,
      timeMax: timeMax,
      timeZone: 'Europe/Zurich',
      items: emails.map(function (email) { return { id: email }; })
    });
  } catch (error) {
    return { globalError: 'Kalenderabfrage nicht möglich: ' + String(error.message || error), calendars: {} };
  }
}
