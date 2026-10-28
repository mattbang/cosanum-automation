"""Offline checks for the connected reader's schema and fail-closed helpers."""

import unittest
from pathlib import Path
from types import SimpleNamespace

from scripts import archive_proof as archive
from scripts import check_connected_case as checker


class FakeApi:
    def __init__(self, ranges):
        self.ranges = ranges
        self.calls = []

    def json(self, url):
        self.calls.append(url)
        return {'valueRanges': self.ranges}


class ConnectedCheckerTests(unittest.TestCase):
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
