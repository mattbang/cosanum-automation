import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const root = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(await fs.readFile(resolve(root, 'data/demo_fixture.json'), 'utf8'));
const schema = {
  Topics: ['topic_id', 'display_name', 'source_material', 'theory_required', 'practice_required', 'theory_minutes', 'practice_minutes', 'group_suitability', 'progression_rule', 'demo_marker', 'configured_target_level'],
  People: ['person_key', 'email', 'demo_role', 'demo_marker', 'persona_id', 'display_alias'],
  Skills: ['person_key', 'topic_id', 'skill_level', 'status_mark', 'demo_marker'],
  Requests: ['request_id', 'action_id', 'topic_id', 'target_level', 'status', 'created_at', 'demo_marker', 'mode'],
  ParticipantCases: ['case_id', 'request_id', 'person_key', 'current_level', 'target_level', 'status', 'created_at', 'demo_marker'],
  Sessions: ['session_id', 'request_id', 'phase', 'phase_order', 'mode', 'trainer_key', 'duration_minutes', 'theory_session_id', 'status', 'created_at', 'demo_marker', 'calendar_event_id', 'start_utc', 'end_utc', 'calendar_event_url'],
  SessionCases: ['session_id', 'case_id', 'request_id', 'person_key', 'demo_marker']
};
const workbook = Workbook.create();
for (const [name, headers] of Object.entries(schema)) {
  const rows = fixture[name];
  const sheet = workbook.worksheets.add(name);
  const lastColumn = String.fromCharCode(64 + headers.length);
  sheet.getRange(`A1:${lastColumn}${rows.length + 1}`).values = [headers, ...rows];
  sheet.getRange(`A1:${lastColumn}1`).format = {
    fill: '#1D3854',
    font: { name: 'Arial', bold: true, color: '#FFFFFF', size: 11 }
  };
  if (rows.length) sheet.getRange(`A2:${lastColumn}${rows.length + 1}`).format.font = { name: 'Arial', size: 10 };
  sheet.getRange(`A1:${lastColumn}${rows.length + 1}`).format.rowHeight = 24;
  sheet.freezePanes.freezeRows(1);
  for (let column = 1; column <= headers.length; column++) {
    const letter = String.fromCharCode(64 + column);
    const maxLength = Math.max(headers[column - 1].length, ...rows.map(row => String(row[column - 1] ?? '').length));
    sheet.getRange(`${letter}:${letter}`).format.columnWidth = Math.min(52, Math.max(14, maxLength + 2));
  }
}
workbook.recalculate();
for (const name of Object.keys(schema)) {
  const result = await workbook.inspect({ kind: 'table', range: `${name}!A1:C6`, include: 'values', tableMaxRows: 6, tableMaxCols: 3 });
  console.log(name, result.ndjson);
}
const outputPath = resolve(root, 'data/demo_fixture.xlsx');
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`Wrote ignored ${outputPath}`);
