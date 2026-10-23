/** Version 6 records one Calendar RSVP snapshot per participant and phase. */
var DEMO_SCHEMA = Object.freeze({
  version: 6,
  folderName: 'Cosanum Training Prototype',
  spreadsheetName: 'catalogue-and-skill-matrix',
  sheets: Object.freeze({
    Topics: ['topic_id', 'display_name', 'source_material', 'theory_required', 'practice_required', 'theory_minutes', 'practice_minutes', 'group_suitability', 'progression_rule', 'demo_marker', 'configured_target_level'],
    People: ['person_key', 'email', 'demo_role', 'demo_marker', 'persona_id', 'display_alias'],
    Skills: ['person_key', 'topic_id', 'skill_level', 'status_mark', 'demo_marker'],
    Requests: ['request_id', 'action_id', 'topic_id', 'target_level', 'status', 'created_at', 'demo_marker', 'mode'],
    ParticipantCases: ['case_id', 'request_id', 'person_key', 'current_level', 'target_level', 'status', 'created_at', 'demo_marker'],
    Sessions: ['session_id', 'request_id', 'phase', 'phase_order', 'mode', 'trainer_key', 'duration_minutes', 'theory_session_id', 'status', 'created_at', 'demo_marker', 'calendar_event_id', 'start_utc', 'end_utc', 'calendar_event_url'],
    SessionCases: ['session_id', 'case_id', 'request_id', 'person_key', 'demo_marker'],
    SessionRsvps: ['session_id', 'case_id', 'person_key', 'calendar_event_id', 'response_status', 'checked_at', 'flag', 'flagged_at', 'demo_marker']
  })
});

function assertHeaders_(actual, expected, sheetName) {
  if (actual.length !== expected.length || expected.some(function (name, i) { return actual[i] !== name; })) {
    throw new Error('Schemafehler in ' + sheetName + ': erwartete Spalten ' + expected.join(', '));
  }
}

function rowObjects_(values, headers) {
  return values.slice(1).filter(function (row) { return row[0] !== ''; }).map(function (row) {
    var item = {};
    headers.forEach(function (header, i) { item[header] = row[i] === undefined ? '' : row[i]; });
    return item;
  });
}
