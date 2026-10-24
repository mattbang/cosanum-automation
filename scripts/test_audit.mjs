import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const headers = ['send_key','purpose','template_version','request_id','case_id','session_id','recipient_email','due_at_utc','attempted_at_utc','sent_at_utc','state','error_summary','demo_marker'];
const cases = ['CASE-R-A', 'CASE-R-B'];
const owner = 'owner@example.test', ccs = 'ccs@example.test';
function makeSheet(initial = []) {
  return { rows: [headers, ...initial], getDataRange() { return { getValues: () => this.rows.map(row => [...row]) }; },
    appendRow(row) { this.rows.push([...row]); }, getRange(r, c) { return { setValues: values => values[0].forEach((v, i) => { this.rows[r - 1][c - 1 + i] = v; }) }; } };
}
function setup() {
  const ledger = makeSheet(), sent = [], completed = new Set();
  const tables = {
    Topics: [{ topic_id: 'TC_R052', display_name: 'Lagerregal', demo_marker: '[DEMO]' }],
    People: [{ person_key: 'MATT', email: owner, demo_marker: '[DEMO]' },
      { person_key: 'A', email: 'a@example.test', display_alias: 'Anna', demo_marker: '[DEMO]' },
      { person_key: 'B', email: 'b@example.test', display_alias: 'Ben', demo_marker: '[DEMO]' }],
    Requests: [{ request_id: 'REQ-R', topic_id: 'TC_R052', mode: 'group', created_at: '2026-10-20T10:00:00Z', demo_marker: '[DEMO]' }],
    ParticipantCases: cases.map((id, i) => ({ case_id: id, request_id: 'REQ-R', person_key: i ? 'B' : 'A', current_level: 0, target_level: 1, demo_marker: '[DEMO]' })),
    SessionCases: cases.map(id => ({ case_id: id, request_id: 'REQ-R', session_id: `SES-${id}`, demo_marker: '[DEMO]' })),
    Sessions: cases.map(id => ({ session_id: `SES-${id}`, request_id: 'REQ-R', phase: 'theory', status: 'invited', start_utc: '2026-10-20T11:00:00Z', end_utc: '2026-10-20T12:00:00Z', calendar_event_id: `EVENT-${id}`, calendar_event_url: 'https://calendar.google.com/calendar/event?id=' + id, demo_marker: '[DEMO]' })),
    SessionRsvps: [], TrainerForms: [], ParticipantForms: [], TrainerAssessments: [], ParticipantAcknowledgements: [],
    Proofs: [], ArchiveReceipts: [], SkillUpdates: [], MessageLedger: [], Skills: []
  };
  const ctx = vm.createContext({ Date, Object, Array, Number, String, RegExp, Error, Set, encodeURIComponent });
  for (const name of ['NotificationTemplates.gs', 'Audit.gs']) vm.runInContext(fs.readFileSync('apps-script/' + name, 'utf8'), ctx);
  ctx.DEMO_SCHEMA = { sheets: { MessageLedger: headers } };
  ctx.SLOT_TIME_ZONE = 'Europe/Zurich';
  ctx.Utilities = { formatDate: value => new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' }).format(value) };
  ctx.proofUnique_ = (rows, predicate, label) => { const m = rows.filter(predicate); if (m.length !== 1) throw Error(label); return m[0]; };
  ctx.proofEmail_ = value => String(value || '').toLowerCase().trim();
  ctx.getPrivateFixture_ = () => ({ People: [['MATT', owner, '', '[DEMO]'], ['A', 'a@example.test', '', '[DEMO]'], ['B', 'b@example.test', '', '[DEMO]'], ['CCS', ccs, '', '[DEMO]']] });
  ctx.validateFixture_ = () => {};
  ctx.Session = { getEffectiveUser: () => ({ getEmail: () => owner }) };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => ccs }) };
  ctx.followUpDue_ = (s, days) => ({ dueAt: new Date(Date.parse(s.start_utc) + days * 86400000) });
  ctx.followUpNow_ = x => x;
  ctx.acceptedTrainerPassRow_ = (t, sessionId, caseId) => t.TrainerAssessments.find(row => row.session_id === sessionId && row.case_id === caseId && row.disposition === 'accepted' && row.attendance === 'attended' && row.assessment === 'passed') || null;
  ctx.reconcileParticipantResponsesLocked_ = () => [];
  const realCompletionGate = ctx.auditCompletionGate_;
  ctx.auditCompletionGate_ = (_, row) => { if (!completed.has(row.case_id)) throw Error('not complete'); };
  ctx.followUpLedgerRow_ = (_, key) => {
    const found = ledger.rows.slice(1).filter(row => row[0] === key);
    if (found.length > 1) throw Error('duplicate ledger');
    return found.length ? Object.fromEntries(headers.map((key, i) => [key, found[0][i]])) : null;
  };
  ctx.followUpSetState_ = (sheet, key, state, stamp, error) => {
    const row = sheet.rows.find(row => row[0] === key); if (!row) throw Error('missing row');
    row[9] = stamp; row[10] = state; row[11] = error;
  };
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  ctx.SpreadsheetApp = { flush() {} };
  ctx.findDemoSpreadsheet_ = () => ({ getUrl: () => 'https://docs.google.com/spreadsheets/d/test/edit', getSheetByName: () => ledger });
  ctx.readDemoTables_ = () => ({ ...tables, MessageLedger: ledger.rows.slice(1).map(row => Object.fromEntries(headers.map((key, i) => [key, row[i]]))) });
  const gateway = { sheet: ledger, remainingQuota: () => 100, dashboardUrl: () => 'https://script.google.com/macros/s/test/exec', sendEmail: m => sent.push(m) };
  return { ctx, tables, ledger, sent, completed, gateway, realCompletionGate };
}
const at = new Date('2026-10-26T12:00:00Z');
{
  const { ctx, completed, sent, gateway, ledger } = setup();
  completed.add(cases[1]);
  const first = ctx.processAuditNoticesCore_(at, gateway);
  assert.equal(first.requests[0].state, 'waiting');
  assert.equal(first.requests[0].requestNo, 1);
  assert.equal(first.requests[0].plannedSessions, 2);
  assert.equal(first.requests[0].bookedSessions, 2);
  assert.equal(sent.length, 0, 'one completed person cannot close two-person group');
  completed.add(cases[0]);
  const second = ctx.processAuditNoticesCore_(at, gateway);
  assert.equal(second.requests[0].state, 'complete');
  assert.equal(second.results[0].state, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, `${owner},${ccs}`);
  assert.match(sent[0].body, /Anna, Ben/);
  assert.match(sent[0].body, /20\.10\.2026/);
  ctx.processAuditNoticesCore_(at, gateway);
  assert.equal(sent.length, 1); assert.equal(ledger.rows.length, 2);
}
{
  const { ctx, completed, sent, gateway } = setup();
  completed.add(cases[0]); completed.add(cases[1]);
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => owner }) };
  ctx.processAuditNoticesCore_(at, gateway);
  assert.equal(sent[0].to, owner, 'owner and CCS roles at same inbox are deduplicated');
}
{
  const { ctx, completed, sent, gateway } = setup();
  completed.add(cases[0]);
  assert.equal(ctx.processAuditNoticesCore_(at, gateway).results.length, 0);
  completed.add(cases[1]);
  assert.equal(ctx.processAuditNoticesCore_(at, gateway).results[0].state, 'sent');
  assert.equal(sent.length, 1, 'reverse completion order has same whole-request gate');
}
for (const cause of ['declined', 'failed', 'acknowledgement_overdue', 'archive_error']) {
  const { ctx, tables, completed, sent, gateway } = setup();
  completed.add(cases[0]);
  if (cause === 'declined') tables.SessionRsvps.push({ case_id: cases[1], session_id: `SES-${cases[1]}`, response_status: 'declined', demo_marker: '[DEMO]' });
  if (cause === 'failed') tables.TrainerAssessments.push({ case_id: cases[1], session_id: `SES-${cases[1]}`, attendance: 'attended', assessment: 'needs_follow_up', disposition: 'accepted' });
  if (cause === 'acknowledgement_overdue') tables.TrainerAssessments.push({ case_id: cases[1], session_id: `SES-${cases[1]}`, attendance: 'attended', assessment: 'passed', disposition: 'accepted' });
  if (cause === 'archive_error') tables.Proofs.push({ case_id: cases[1], status: 'archive_error', demo_marker: '[DEMO]' });
  const first = ctx.processAuditNoticesCore_(at, gateway);
  assert.equal(first.requests[0].state, 'open', cause);
  assert.equal(first.requests[0].cases[1].reasonCode, cause);
  assert.equal(sent.length, 1, cause);
  assert.equal(sent[0].to, owner, 'exception is separate from completion');
  assert.match(sent[0].subject, /Klärung erforderlich/);
  ctx.processAuditNoticesCore_(at, gateway);
  assert.equal(sent.length, 1, 'same exception must not resend');
}
{
  const { ctx, tables, sent, gateway } = setup();
  tables.TrainerAssessments.push({ case_id: cases[1], session_id: `SES-${cases[1]}`, attendance: 'attended', assessment: 'passed', disposition: 'accepted' });
  tables.ParticipantForms.push({ case_id: cases[1], session_id: `SES-${cases[1]}`, demo_marker: '[DEMO]' });
  ctx.reconcileParticipantResponsesLocked_ = () => {
    tables.ParticipantAcknowledgements.push({ case_id: cases[1], session_id: `SES-${cases[1]}`, response_id: 'RAW-1', disposition: 'accepted', demo_marker: '[DEMO]' });
  };
  const result = ctx.processAuditNoticesCore_(at, gateway);
  assert.equal(result.requests[0].cases[1].reasonCode, '');
  assert.equal(sent.length, 0, 'accepted raw Form answer suppresses overdue exception');
}
{
  const { ctx, tables, sent, gateway } = setup();
  tables.TrainerAssessments.push({ case_id: cases[1], session_id: `SES-${cases[1]}`, attendance: 'attended', assessment: 'passed', disposition: 'accepted' });
  tables.ParticipantForms.push({ case_id: cases[1], session_id: `SES-${cases[1]}`, demo_marker: '[DEMO]' });
  ctx.reconcileParticipantResponsesLocked_ = () => { throw Error('Forms temporarily unavailable'); };
  assert.throws(() => ctx.processAuditNoticesCore_(at, gateway), /Forms temporarily unavailable/);
  assert.equal(sent.length, 0, 'audit sends fail closed on Forms read failure');
}
{
  const { ctx, tables, sent, gateway } = setup();
  tables.SessionRsvps.push({ case_id: cases[0], session_id: `SES-${cases[0]}`, response_status: 'declined', demo_marker: '[DEMO]' });
  ctx.processAuditNoticesCore_(at, gateway);
  tables.SessionRsvps[0].response_status = 'accepted';
  tables.TrainerAssessments.push({ case_id: cases[0], session_id: `SES-${cases[0]}`, attendance: 'attended', assessment: 'needs_follow_up', disposition: 'accepted' });
  ctx.processAuditNoticesCore_(at, gateway);
  assert.equal(sent.length, 2, 'different actionable reason receives separate notice');
}
{
  const { ctx, completed, sent, gateway, ledger } = setup();
  completed.add(cases[0]); completed.add(cases[1]);
  ledger.rows.push(['completion:REQ-R', 'completion_notice', 3, 'REQ-R', '', '', owner, '', '', '', 'reserved', '', '[DEMO]']);
  assert.equal(ctx.processAuditNoticesCore_(at, gateway).results[0].state, 'unknown');
  assert.equal(sent.length, 0, 'ambiguous reservation cannot auto retry');
  assert.equal(ledger.rows[1][10], 'unknown');
}
{
  const { ctx, completed, sent, gateway } = setup();
  completed.add(cases[0]); completed.add(cases[1]);
  gateway.remainingQuota = () => 1;
  assert.equal(ctx.processAuditNoticesCore_(at, gateway).results[0].state, 'pending_quota');
  assert.equal(sent.length, 0);
}
{
  const { ctx, tables, realCompletionGate } = setup();
  const c = tables.ParticipantCases[0];
  const gate = { personCase: c, request: tables.Requests[0], proof: { proof_id: 'PRF-A', source_hash: 'expected' }, receipt: {} };
  tables.Skills = [{ person_key: 'A', topic_id: 'TC_R052', skill_level: 1, demo_marker: '[DEMO]' }];
  ctx.skillArchiveGate_ = () => gate;
  ctx.skillUpdateExisting_ = () => ({ status: 'applied' });
  ctx.proofSourceModel_ = (snapshot) => {
    assert.equal(snapshot.Skills[0].skill_level, 0, 'source recheck uses pre-update level');
    assert.equal(tables.Skills[0].skill_level, 1, 'live table remains intact');
    return { source: true };
  };
  ctx.proofHash_ = () => 'expected';
  assert.equal(realCompletionGate(tables, c).model.source, true);
  ctx.proofHash_ = () => 'changed';
  assert.throws(() => realCompletionGate(tables, c), /Originalbelege/);
}
{
  const { ctx, tables } = setup();
  ctx.Session = { getEffectiveUser: () => ({ getEmail: () => 'outsider@example.test' }) };
  assert.throws(() => ctx.auditView_(tables, at, 'https://docs.google.com/spreadsheets/d/test/edit'), /Eigentümerkonto/);
}
console.log('Audit notices, evidence gate and two-person request tests passed');
