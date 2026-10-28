#!/usr/bin/env python3
"""Repeat read-only connected evidence checks for one synthetic person case."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import archive_proof as archive


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'data/dedicated-demo/target_config.json'
REPORTS = ROOT / 'data/connected-checks'
EXTRA_HEADERS = {
    'Requests': ['request_id', 'action_id', 'topic_id', 'target_level', 'status', 'created_at', 'demo_marker', 'mode'],
    'ParticipantCases': ['case_id', 'request_id', 'person_key', 'current_level', 'target_level', 'status', 'created_at', 'demo_marker'],
    'Sessions': ['session_id', 'request_id', 'phase', 'phase_order', 'mode', 'trainer_key', 'duration_minutes', 'theory_session_id', 'status', 'created_at', 'demo_marker', 'calendar_event_id', 'start_utc', 'end_utc', 'calendar_event_url'],
    'TrainerForms': ['session_id', 'case_id', 'person_key', 'trainer_key', 'trainer_email', 'form_id', 'form_url', 'created_at', 'demo_marker', 'verified_at', 'verified_by'],
    'ParticipantForms': ['session_id', 'case_id', 'request_id', 'person_key', 'participant_email', 'form_id', 'form_url', 'created_at', 'demo_marker', 'verified_at', 'verified_by'],
    'Skills': ['person_key', 'topic_id', 'skill_level', 'status_mark', 'demo_marker'],
    'SkillUpdates': ['idempotency_key', 'case_id', 'request_id', 'person_key', 'topic_id', 'previous_level', 'target_level', 'proof_id', 'proof_version', 'source_hash', 'archive_verified_at', 'applied_at', 'status', 'reason', 'demo_marker'],
}
OPEN_GATES = [
    'Numbered /exec UI behavior and deployed version are not checked by these APIs.',
    'Current Forms VERIFIED settings and raw Form responses are not checked by the archive credential.',
    'Live Calendar events, guests, and invitations are not checked by the archive credential.',
    'Fresh cross-account submissions, negative scenarios, mail, and mobile handoffs need separate connected tests.',
]


class CheckFailure(Exception):
    pass


def exactly(rows: list[dict], label: str) -> dict:
    if len(rows) != 1:
        raise CheckFailure(f'{label}: expected one row, found {len(rows)}.')
    return rows[0]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailure(message)


def as_time(value: object) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        raise CheckFailure('A stored timestamp is invalid.') from None
    if parsed.tzinfo is None:
        raise CheckFailure('A stored timestamp has no time zone.')
    return parsed


def read_tables(source: archive.Source) -> dict[str, list[dict]]:
    headers = {**archive.SHEETS, **EXTRA_HEADERS}
    query = urlencode([('ranges', f'{tab}!A1:Z') for tab in headers] +
                      [('valueRenderOption', 'UNFORMATTED_VALUE')])
    result = source.api.json(f'{source.sheets}/spreadsheets/{source.spreadsheet}/values:batchGet?{query}')
    ranges = result.get('valueRanges', [])
    if len(ranges) != len(headers):
        raise CheckFailure('Connected batch read returned the wrong number of Sheet tabs.')
    tables = {}
    for (tab, expected), item in zip(headers.items(), ranges):
        values = item.get('values', [])
        if not values or values[0] != expected:
            raise CheckFailure(f'{tab}: Sheet headers differ from the reviewed schema.')
        tables[tab] = [dict(zip(expected, row + [''] * (len(expected) - len(row))))
                       for row in values[1:] if row and row[0] != '']
    return tables


class CachedSource:
    def __init__(self, source: archive.Source, tables: dict[str, list[dict]]):
        self.source = source
        self.tables = tables
        self.root = source.root

    def rows(self, tab: str) -> list[dict]:
        return self.tables[tab]

    def file(self, file_id: str) -> dict:
        return self.source.file(file_id)

    def list_files(self, query: str) -> list[dict]:
        return self.source.list_files(query)

    def metadata_files(self, proof_id: str) -> list[dict]:
        return self.source.metadata_files(proof_id)

    def pdf(self, file_id: str) -> bytes:
        return self.source.pdf(file_id)


def same_local_path(saved: object, expected: object) -> bool:
    path = Path(str(saved))
    return (path if path.is_absolute() else ROOT / path).resolve() == Path(str(expected)).resolve()


def snapshot(source: archive.Source, case_id: str, archive_root: Path) -> dict:
    """Read the live Sheet/Drive state; never invoke a Google data write method."""
    tables = read_tables(source)
    case = exactly([r for r in tables['ParticipantCases'] if r['case_id'] == case_id], 'person case')
    require(case['demo_marker'] == '[DEMO]', 'Person case is outside the demo fixture.')
    request = exactly([r for r in tables['Requests'] if r['request_id'] == case['request_id']], 'request')
    require(request['demo_marker'] == '[DEMO]' and request['topic_id'], 'Request or topic does not match the demo case.')
    require(str(request['target_level']) == str(case['target_level']), 'Request and person-case targets differ.')
    person = exactly([r for r in tables['People'] if r['person_key'] == case['person_key']], 'assigned person')
    require(person['demo_marker'] == '[DEMO]', 'Assigned person is outside the demo fixture.')

    links = [r for r in tables['SessionCases'] if r['case_id'] == case_id]
    require(bool(links), 'Person case has no linked session.')
    require(len({r['session_id'] for r in links}) == len(links), 'Person case has duplicate session links.')
    require(all(r['request_id'] == request['request_id'] and r['person_key'] == case['person_key']
                and r['demo_marker'] == '[DEMO]' for r in links), 'Session/person links differ from the case.')
    sessions = []
    for link in links:
        row = exactly([r for r in tables['Sessions'] if r['session_id'] == link['session_id']], 'linked session')
        require(row['request_id'] == request['request_id'] and row['demo_marker'] == '[DEMO]',
                'Session request or demo marker differs.')
        require(row['status'] == 'invited' and all(row[k] for k in ('calendar_event_id', 'start_utc', 'end_utc')),
                'Session lacks a saved invitation receipt.')
        require(as_time(row['end_utc']) > as_time(row['start_utc']), 'Session time range is invalid.')
        sessions.append(row)

    for session in sessions:
        sid = session['session_id']
        trainer_form = exactly([r for r in tables['TrainerForms'] if r['case_id'] == case_id
                                and r['session_id'] == sid], 'trainer Form')
        participant_form = exactly([r for r in tables['ParticipantForms'] if r['case_id'] == case_id
                                    and r['session_id'] == sid], 'participant Form')
        for form in (trainer_form, participant_form):
            require(form['demo_marker'] == '[DEMO]' and form['form_id'] and form['verified_at']
                    and form['verified_by'] == 'forms-api:' + source.actor,
                    'Stored Form assignment or verification stamp is incomplete.')
        require(trainer_form['trainer_key'] == session['trainer_key'], 'Trainer Form assignment differs from session.')
        require(participant_form['person_key'] == case['person_key'] and
                participant_form['participant_email'].lower() == person['email'].lower(),
                'Participant Form assignment differs from person case.')
        trainer = exactly([r for r in tables['TrainerAssessments'] if r['case_id'] == case_id
                           and r['session_id'] == sid and r['disposition'] == 'accepted'], 'accepted trainer report')
        participant = exactly([r for r in tables['ParticipantAcknowledgements'] if r['case_id'] == case_id
                               and r['session_id'] == sid and r['disposition'] == 'accepted'], 'accepted acknowledgement')
        require(trainer['person_key'] == case['person_key'] and
                trainer['form_id'] == trainer_form['form_id'] and
                trainer['reporter_email'].lower() == trainer_form['trainer_email'].lower() and
                trainer['attendance'] == 'attended' and trainer['assessment'] == 'passed' and
                trainer['attestation'] == 'yes', 'Trainer report does not match the assigned passing Form.')
        require(participant['person_key'] == case['person_key'] and
                participant['request_id'] == request['request_id'] and
                participant['form_id'] == participant_form['form_id'] and
                participant['respondent_email'].lower() == person['email'].lower() and
                participant['affirmative'] == 'yes', 'Acknowledgement does not match the assigned person/Form.')
        require(as_time(trainer['submitted_at']) >= as_time(session['end_utc']) and
                as_time(participant['submitted_at']) >= as_time(trainer['submitted_at']),
                'A report or acknowledgement precedes its required gate.')

    proof = exactly([r for r in tables['Proofs'] if r['case_id'] == case_id], 'individual proof')
    require(proof['request_id'] == request['request_id'] and proof['person_key'] == case['person_key'] and
            proof['topic_id'] == request['topic_id'] and proof['status'] == 'archived_verified' and
            proof['demo_marker'] == '[DEMO]', 'Proof identity or archived status differs.')
    cached = CachedSource(source, tables)
    archive.folder_and_files(cached, proof)
    proof_sessions, response_ids = archive.source_ids(cached, proof)
    require(set(proof_sessions) == {r['session_id'] for r in sessions}, 'Proof sources omit a linked session.')
    drive_hash = archive.sha256(source.pdf(proof['pdf_id']))
    pdf_path, docx_path, manifest_path = archive.archive_paths(archive_root, proof)
    require(manifest_path.is_file(), 'Local archive manifest is missing.')
    manifest = json.loads(manifest_path.read_text())
    require(archive.verify_existing(manifest, proof, pdf_path, docx_path, drive_hash),
            'Local PDF or DOCX differs from the current Drive PDF/manifest.')
    require(manifest.get('session_ids') == proof_sessions and
            manifest.get('source_response_ids') == response_ids, 'Manifest sources differ from accepted rows.')
    receipt = exactly([r for r in tables['ArchiveReceipts'] if r['proof_id'] == proof['proof_id']],
                      'verified archive receipt')
    expected_receipt = archive.receipt_values(proof, manifest, manifest_path)
    receipt_differences = [key for key, value in zip(archive.SHEETS['ArchiveReceipts'], expected_receipt)
                           if not (same_local_path(receipt[key], value) if key in
                                   ('local_pdf_path', 'local_docx_path', 'manifest_path') else
                                   str(receipt[key]) == str(value))]
    require(not receipt_differences,
            'Archive receipt differs from the manifest or current Drive PDF in: ' +
            ', '.join(receipt_differences))

    skill = exactly([r for r in tables['SkillUpdates'] if r['case_id'] == case_id], 'skill update')
    require(skill['status'] == 'applied' and skill['request_id'] == request['request_id'] and
            skill['person_key'] == case['person_key'] and skill['topic_id'] == request['topic_id'] and
            skill['proof_id'] == proof['proof_id'] and str(skill['proof_version']) == str(proof['proof_version']) and
            skill['source_hash'] == proof['source_hash'] and
            str(skill['previous_level']) == str(case['current_level']) and
            str(skill['target_level']) == str(case['target_level']) and skill['demo_marker'] == '[DEMO]',
            'Applied skill update does not match the person case and proof.')
    matrix = exactly([r for r in tables['Skills'] if r['person_key'] == case['person_key']
                      and r['topic_id'] == request['topic_id']], 'skill matrix entry')
    require(str(matrix['skill_level']) == str(case['target_level']) and matrix['demo_marker'] == '[DEMO]',
            'Current demo skill matrix does not equal this case target.')
    return {
        'request_id': request['request_id'], 'case_id': case_id,
        'session_ids': sorted(r['session_id'] for r in sessions),
        'form_pairs': len(sessions), 'accepted_trainer_reports': len(sessions),
        'accepted_acknowledgements': len(sessions), 'proof_id': proof['proof_id'],
        'proof_version': proof['proof_version'], 'drive_pdf_sha256': drive_hash,
        'archive_receipts': 1, 'skill_update_key': skill['idempotency_key'],
        'matrix_level': matrix['skill_level'],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case-id', required=True)
    parser.add_argument('--sheet-id', required=True, help='Exact dedicated Sheet ID from the private case record')
    parser.add_argument('--repeat', type=int, default=1)
    args = parser.parse_args()
    if not 1 <= args.repeat <= 5:
        parser.error('--repeat must be from 1 to 5')
    case_id = archive.safe_id(args.case_id, 'case ID')
    sheet_id = archive.safe_id(args.sheet_id, 'Sheet ID')
    target = json.loads(TARGET.read_text())
    expected_owner = target['expectedOwner'].lower()
    credential = ROOT / target['archiveAuthFile']
    if not credential.resolve().is_relative_to((ROOT / 'data/dedicated-demo').resolve()):
        parser.error('Archive credential must be inside the dedicated private data directory.')
    started = archive.utc_now()
    attempts = []
    try:
        source = archive.Source(archive.GoogleApi(credential))
        require(source.actor == expected_owner, 'Connected actor is not the dedicated demo owner.')
        require(source.spreadsheet == sheet_id, 'Discovered Sheet does not match the requested dedicated target.')
        for number in range(1, args.repeat + 1):
            try:
                result = snapshot(source, case_id, ROOT / 'archive/dedicated-demo')
                attempts.append({'run': number, 'status': 'pass', 'snapshot': result})
            except (CheckFailure, archive.ArchiveError, OSError, ValueError, KeyError, TypeError) as exc:
                attempts.append({'run': number, 'status': 'fail', 'reason': str(exc)})
    except (CheckFailure, archive.ArchiveError, OSError, ValueError, KeyError, TypeError) as exc:
        attempts.append({'run': 0, 'status': 'fail', 'reason': str(exc)})
    stable = len(attempts) == args.repeat and all(item['status'] == 'pass' for item in attempts) and all(
        item['snapshot'] == attempts[0]['snapshot'] for item in attempts)
    report = {
        'schema_version': 1, 'evidence_level': 'connected_persisted_readback',
        'release_acceptance': 'not_established', 'started_at_utc': started,
        'finished_at_utc': archive.utc_now(), 'expected_owner': expected_owner,
        'sheet_id': sheet_id, 'case_id': case_id, 'repetitions': args.repeat,
        'status': 'pass' if stable else 'fail', 'attempts': attempts,
        'open_gates': OPEN_GATES,
    }
    directory = REPORTS / (started.replace(':', '-').replace('.', '-') + '-' + uuid4().hex[:8])
    directory.mkdir(parents=True, mode=0o700)
    report_path = directory / 'report.json'
    summary_path = directory / 'summary.md'
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    summary_path.write_text(
        '# Connected case readback\n\n'
        f"- Status: **{report['status']}** ({len([x for x in attempts if x['status'] == 'pass'])}/{args.repeat} reads)\n"
        f"- Case: `{case_id}`\n- Sheet: `{sheet_id}`\n"
        '- Evidence: persisted Sheet and Drive readback plus local archive integrity.\n'
        '- Release acceptance: **not established**.\n\n'
        '## Open gates\n\n' + ''.join(f'- {gate}\n' for gate in OPEN_GATES)
    )
    report_path.chmod(0o600)
    summary_path.chmod(0o600)
    print(json.dumps({'status': report['status'], 'passed_reads': len([x for x in attempts if x['status'] == 'pass']),
                      'repetitions': args.repeat, 'report': str(directory),
                      'release_acceptance': report['release_acceptance']}))
    return 0 if stable else 1


if __name__ == '__main__':
    raise SystemExit(main())
