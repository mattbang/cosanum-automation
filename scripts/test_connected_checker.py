"""Offline checks for the connected reader's schema and fail-closed helpers."""

import unittest
import tempfile
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from scripts import archive_proof as archive
from scripts import check_connected_case as checker
from scripts.test_archive_proof import FakeSource, CASE


class FakeApi:
    def __init__(self, ranges):
        self.ranges = ranges
        self.calls = []

    def json(self, url):
        self.calls.append(url)
        return {'valueRanges': self.ranges}


class ConnectedCheckerTests(unittest.TestCase):
    def full_case(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        archive_root = Path(temp.name) / 'archive'
        source = FakeSource()
        source.actor = 'owner@example.test'
        archive.archive_case(source, CASE, archive_root)
        proof = source.tables['Proofs'][0]
        tables = deepcopy(source.tables)
        tables.update({
            'Requests': [{'request_id': 'REQ-DEMO-001', 'topic_id': 'TC_R052', 'target_level': 1, 'demo_marker': '[DEMO]'}],
            'ParticipantCases': [{'case_id': CASE, 'request_id': 'REQ-DEMO-001', 'person_key': 'SUMNER', 'current_level': 0, 'target_level': 1, 'demo_marker': '[DEMO]'}],
            'People': [{'person_key': 'SUMNER', 'email': 'person@example.com', 'demo_marker': '[DEMO]'}],
            'Sessions': [{'session_id': 'SES-1', 'request_id': 'REQ-DEMO-001', 'trainer_key': 'TRAINER', 'status': 'invited', 'calendar_event_id': 'EVENT-1', 'start_utc': '2026-10-23T19:00:00Z', 'end_utc': '2026-10-23T20:00:00Z', 'demo_marker': '[DEMO]'}],
            'TrainerForms': [{'case_id': CASE, 'session_id': 'SES-1', 'trainer_key': 'TRAINER', 'trainer_email': 'trainer@example.com', 'form_id': 'FORM-T', 'verified_at': '2026-10-23T20:00:00Z', 'verified_by': 'forms-api:owner@example.test', 'demo_marker': '[DEMO]'}],
            'ParticipantForms': [{'case_id': CASE, 'session_id': 'SES-1', 'person_key': 'SUMNER', 'participant_email': 'person@example.com', 'form_id': 'FORM-A', 'verified_at': '2026-10-23T20:00:00Z', 'verified_by': 'forms-api:owner@example.test', 'demo_marker': '[DEMO]'}],
            'Skills': [{'person_key': 'SUMNER', 'topic_id': 'TC_R052', 'skill_level': 1, 'demo_marker': '[DEMO]'}],
            'SkillUpdates': [{'case_id': CASE, 'request_id': 'REQ-DEMO-001', 'person_key': 'SUMNER', 'topic_id': 'TC_R052', 'previous_level': 0, 'target_level': 1, 'proof_id': proof['proof_id'], 'proof_version': proof['proof_version'], 'source_hash': proof['source_hash'], 'status': 'applied', 'idempotency_key': 'synthetic-key', 'demo_marker': '[DEMO]'}],
        })
        return source, tables, archive_root

    def test_full_snapshot_and_tampering_are_read_only(self):
        source, tables, archive_root = self.full_case()
        write_count = len(source.writes)
        with mock.patch.object(checker, 'read_tables', return_value=tables):
            result = checker.snapshot(source, CASE, archive_root)
        self.assertEqual(result['accepted_trainer_reports'], 1)
        self.assertEqual(len(source.writes), write_count, 'readback never writes')
        mutations = [
            ('missing response', lambda t: t['TrainerAssessments'].clear()),
            ('duplicate response', lambda t: t['TrainerAssessments'].append(deepcopy(t['TrainerAssessments'][0]))),
            ('wrong person', lambda t: t['ParticipantAcknowledgements'][0].update(person_key='OTHER')),
            ('wrong target', lambda t: t['Requests'][0].update(target_level=2)),
        ]
        for label, mutate in mutations:
            altered = deepcopy(tables)
            mutate(altered)
            with self.subTest(label=label), mock.patch.object(checker, 'read_tables', return_value=altered):
                with self.assertRaises(checker.CheckFailure):
                    checker.snapshot(source, CASE, archive_root)
        source.pdf_bytes = b'%PDF-1.7\nchanged'
        with mock.patch.object(checker, 'read_tables', return_value=tables):
            with self.assertRaises((checker.CheckFailure, archive.ArchiveError)):
                checker.snapshot(source, CASE, archive_root)
        self.assertEqual(len(source.writes), write_count)

    def test_batch_read_accepts_exact_headers_without_network(self):
        headers = {**archive.SHEETS, **checker.EXTRA_HEADERS}
        api = FakeApi([{'values': [columns, ['synthetic-id']]} for columns in headers.values()])
        tables = checker.read_tables(SimpleNamespace(api=api, sheets='fake-sheets', spreadsheet='fake-id'))
        self.assertEqual(set(tables), set(headers))
        self.assertTrue(all(len(rows) == 1 for rows in tables.values()))
        self.assertEqual(len(api.calls), 1)
        self.assertIn('values:batchGet', api.calls[0])

    def test_missing_or_changed_sheet_schema_fails_closed(self):
        headers = {**archive.SHEETS, **checker.EXTRA_HEADERS}
        ranges = [{'values': [columns]} for columns in headers.values()]
        source = SimpleNamespace(api=FakeApi(ranges[:-1]), sheets='fake', spreadsheet='fake')
        with self.assertRaises(checker.CheckFailure):
            checker.read_tables(source)
        ranges[0] = {'values': [['wrong_header']]}
        source.api = FakeApi(ranges)
        with self.assertRaises(checker.CheckFailure):
            checker.read_tables(source)

    def test_duplicate_identity_and_invalid_time_fail_closed(self):
        with self.assertRaises(checker.CheckFailure):
            checker.exactly([{'id': 'x'}, {'id': 'x'}], 'synthetic case')
        with self.assertRaises(checker.CheckFailure):
            checker.exactly([], 'synthetic case')
        with self.assertRaises(checker.CheckFailure):
            checker.as_time('2026-10-28T11:00:00')
        self.assertTrue(checker.same_local_path('data/example.pdf', Path(checker.ROOT) / 'data/example.pdf'))


if __name__ == '__main__':
    unittest.main()
