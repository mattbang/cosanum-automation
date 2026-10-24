/** Version 12 adds reminder delivery and Process & Quality follow-up ledgers. */
var DEMO_SCHEMA = Object.freeze({
  version: 12,
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
    SessionRsvps: ['session_id', 'case_id', 'person_key', 'calendar_event_id', 'response_status', 'checked_at', 'flag', 'flagged_at', 'demo_marker'],
    TrainerForms: ['session_id', 'case_id', 'person_key', 'trainer_key', 'trainer_email', 'form_id', 'form_url', 'created_at', 'demo_marker', 'verified_at', 'verified_by'],
    TrainerAssessments: ['response_id', 'form_id', 'session_id', 'case_id', 'person_key', 'reporter_email', 'submitted_at', 'attendance', 'assessment', 'note', 'attestation', 'disposition', 'reason', 'demo_marker'],
    ParticipantForms: ['session_id', 'case_id', 'request_id', 'person_key', 'participant_email', 'form_id', 'form_url', 'created_at', 'demo_marker', 'verified_at', 'verified_by'],
    ParticipantAcknowledgements: ['response_id', 'form_id', 'request_id', 'session_id', 'case_id', 'person_key', 'respondent_email', 'submitted_at', 'typed_name', 'affirmative', 'disposition', 'reason', 'demo_marker'],
    Proofs: ['proof_id', 'proof_version', 'request_id', 'case_id', 'person_key', 'topic_id', 'source_hash', 'created_at', 'folder_id', 'doc_id', 'pdf_id', 'status', 'demo_marker'],
    ArchiveReceipts: ['proof_id', 'proof_version', 'case_id', 'request_id', 'person_key', 'topic_id', 'source_hash', 'doc_id', 'pdf_id', 'drive_pdf_sha256', 'local_pdf_sha256', 'local_docx_sha256', 'local_pdf_path', 'local_docx_path', 'manifest_path', 'verified_at', 'status', 'demo_marker'],
    SkillUpdates: ['idempotency_key', 'case_id', 'request_id', 'person_key', 'topic_id', 'previous_level', 'target_level', 'proof_id', 'proof_version', 'source_hash', 'archive_verified_at', 'applied_at', 'status', 'reason', 'demo_marker'],
    MessageLedger: ['send_key', 'purpose', 'template_version', 'request_id', 'case_id', 'session_id', 'recipient_email', 'due_at_utc', 'attempted_at_utc', 'sent_at_utc', 'state', 'error_summary', 'demo_marker'],
    FollowUps: ['action_id', 'case_id', 'session_id', 'request_id', 'action', 'note', 'actor_email', 'recorded_at_utc', 'demo_marker']
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
