"""Focused, offline archive handshake tests. Run: python3 -m unittest scripts/test_archive_proof.py"""

import base64
import copy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlparse
import zipfile

from scripts import archive_proof as archive


CASE = 'CASE-DEMO-001'
PROOF = 'PRF-DEMO-001'


def docx_bytes():
    target = io.BytesIO()
    with zipfile.ZipFile(target, 'w') as file:
        file.writestr('[Content_Types].xml', '<Types/>')
        file.writestr('word/document.xml', '<document/>')
    return target.getvalue()


class FakeSource:
    def __init__(self):
        proof = dict(zip(archive.SHEETS['Proofs'], [
            PROOF, 1, 'REQ-DEMO-001', CASE, 'SUMNER', 'TC_R052', 'a' * 64,
            '2026-10-23T21:15:11.457Z', 'person-folder', 'doc-1', 'pdf-1',
            'pending_local_archive', '[DEMO]']))
        self.tables = {
            'Proofs': [proof], 'ArchiveReceipts': [],
            'SessionCases': [dict(zip(archive.SHEETS['SessionCases'],
                                      ['SES-1', CASE, 'REQ-DEMO-001', 'SUMNER', '[DEMO]']))],
            'TrainerAssessments': [dict(zip(archive.SHEETS['TrainerAssessments'],
                                            ['TR-1', 'FORM-T', 'SES-1', CASE, 'SUMNER', 'trainer@example.com',
                                             '2026-10-23T21:00:00Z', 'attended', 'passed', '', 'yes',
                                             'accepted', '', '[DEMO]']))],
            'ParticipantAcknowledgements': [dict(zip(archive.SHEETS['ParticipantAcknowledgements'],
                                                    ['ACK-1', 'FORM-A', 'REQ-DEMO-001', 'SES-1', CASE, 'SUMNER',
                                                     'person@example.com', '2026-10-23T21:05:00Z', 'Test Name',
                                                     'yes', 'accepted', '', '[DEMO]']))],
        }
        self.root = {'id': 'demo-root', 'name': 'Cosanum Training Prototype'}
        self.files = {
            'person-folder': {'id': 'person-folder', 'name': 'SUMNER', 'mimeType': 'application/vnd.google-apps.folder', 'parents': ['request-folder']},
            'request-folder': {'id': 'request-folder', 'name': 'REQ-DEMO-001', 'mimeType': 'application/vnd.google-apps.folder', 'parents': ['topic-folder']},
            'topic-folder': {'id': 'topic-folder', 'name': 'TC_R052', 'mimeType': 'application/vnd.google-apps.folder', 'parents': ['archive-folder']},
            'archive-folder': {'id': 'archive-folder', 'name': 'evidence-archive', 'mimeType': 'application/vnd.google-apps.folder', 'parents': ['demo-root']},
            'demo-root': {'id': 'demo-root', 'name': 'Cosanum Training Prototype', 'mimeType': 'application/vnd.google-apps.folder', 'parents': ['root']},
        }
        self.children = [
            {'id': 'doc-1', 'name': PROOF + '-v1 [DEMO]', 'mimeType': 'application/vnd.google-apps.document'},
            {'id': 'pdf-1', 'name': PROOF + '-v1 [DEMO].pdf', 'mimeType': 'application/pdf'},
        ]
        self.pdf_bytes = b'%PDF-1.7\n' + b'a' * 200
        self.docx_bytes = docx_bytes()
        self.fail_pdf = False
        self.fail_proof_update_once = False
        self.writes = []
        self.exports = 0

    def rows(self, tab):
        return copy.deepcopy(self.tables[tab])

    def file(self, file_id):
        return self.files[file_id]

    def list_files(self, query):
        return self.children

    def pdf(self, file_id):
        if self.fail_pdf:
            raise archive.ArchiveError('Disconnected from Drive.')
        assert file_id == 'pdf-1'
        return self.pdf_bytes

    def docx(self, file_id):
        assert file_id == 'doc-1'
        self.exports += 1
        return self.docx_bytes

    def update_row(self, tab, number, values):
        if tab == 'Proofs' and self.fail_proof_update_once:
            self.fail_proof_update_once = False
            raise archive.ArchiveError('Simulated interrupted register write.')
        self.tables[tab][number - 2] = dict(zip(archive.SHEETS[tab], values))
        self.writes.append(('update', tab))

    def append_row(self, tab, values):
        self.tables[tab].append(dict(zip(archive.SHEETS[tab], values)))
        self.writes.append(('append', tab))


class ArchiveProofTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'archive'
        self.source = FakeSource()

    def test_success_and_idempotent_replay(self):
        first = archive.archive_case(self.source, CASE, self.root)
        self.assertEqual(first['status'], 'archived_verified')
        self.assertFalse(first['reused'])
        manifest = json.loads(Path(first['manifest']).read_text())
        self.assertEqual(manifest['source_response_ids']['participant'], ['ACK-1'])
        self.assertEqual(manifest['pdf_sha256'], archive.sha256(self.source.pdf_bytes))
        self.assertEqual(len(self.source.tables['ArchiveReceipts']), 1)
        self.assertEqual(self.source.tables['Proofs'][0]['status'], 'archived_verified')
        self.assertEqual(len(list(self.root.rglob('*.manifest.json'))), 1)
        self.assertIn(PROOF, (self.root / 'index.csv').read_text())
        write_count = len(self.source.writes)
        second = archive.archive_case(self.source, CASE, self.root)
        self.assertTrue(second['reused'])
        self.assertEqual(len(self.source.writes), write_count)
        self.assertEqual(self.source.exports, 1)

    def test_disconnected_source_stays_pending_or_error(self):
        self.source.fail_pdf = True
        with self.assertRaises(archive.ArchiveError):
            archive.archive_case(self.source, CASE, self.root)
        self.assertEqual(self.source.tables['Proofs'][0]['status'], 'archive_error')
        self.assertEqual(self.source.tables['ArchiveReceipts'], [])
        self.source.fail_pdf = False
        self.assertEqual(archive.archive_case(self.source, CASE, self.root)['status'], 'archived_verified')

    def test_corrupt_local_copy_requires_repair(self):
        result = archive.archive_case(self.source, CASE, self.root)
        manifest = Path(result['manifest'])
        pdf = Path(json.loads(manifest.read_text())['local']['pdf_path'])
        pdf.write_bytes(b'%PDF-corrupt')
        with self.assertRaisesRegex(archive.ArchiveError, 'missing or corrupt'):
            archive.archive_case(self.source, CASE, self.root)
        self.assertEqual(self.source.tables['Proofs'][0]['status'], 'archive_error')
        self.assertEqual(len(self.source.tables['ArchiveReceipts']), 1)
        repaired = archive.archive_case(self.source, CASE, self.root, repair=True)
        self.assertEqual(repaired['status'], 'archived_verified')
        self.assertEqual(pdf.read_bytes(), self.source.pdf_bytes)
        self.assertEqual(len(list(self.root.rglob('*.manifest.json'))), 1)
        self.assertEqual(len(self.source.tables['ArchiveReceipts']), 1)

    def test_mismatched_proof_id_blocks_before_files(self):
        self.source.tables['Proofs'][0]['proof_id'] = 'PRF-OTHER'
        with self.assertRaisesRegex(archive.ArchiveError, 'conflicting identity'):
            archive.archive_case(self.source, CASE, self.root)
        self.assertFalse(self.root.exists())
        self.assertFalse(self.source.writes)

    def test_changed_drive_pdf_requires_corrected_version(self):
        archive.archive_case(self.source, CASE, self.root)
        self.source.pdf_bytes = b'%PDF-1.7\n' + b'b' * 200
        with self.assertRaisesRegex(archive.ArchiveError, 'corrected version'):
            archive.archive_case(self.source, CASE, self.root, repair=True)
        self.assertEqual(self.source.tables['Proofs'][0]['status'], 'archive_error')

    def test_corrupt_docx_repair_requires_same_snapshot(self):
        result = archive.archive_case(self.source, CASE, self.root)
        docx = Path(json.loads(Path(result['manifest']).read_text())['local']['editable_path'])
        docx.write_bytes(b'broken')
        with self.assertRaisesRegex(archive.ArchiveError, 'missing or corrupt'):
            archive.archive_case(self.source, CASE, self.root)
        self.source.docx_bytes = docx_bytes() + b'changed-export'
        with self.assertRaisesRegex(archive.ArchiveError, 'corrected version'):
            archive.archive_case(self.source, CASE, self.root, repair=True)
        self.source.docx_bytes = docx_bytes()
        archive.archive_case(self.source, CASE, self.root, repair=True)
        self.assertTrue(archive.valid_docx(docx.read_bytes()))
        self.assertEqual(len(self.source.tables['ArchiveReceipts']), 1)

    def test_interrupted_register_write_recovers_without_duplicate(self):
        self.source.fail_proof_update_once = True
        with self.assertRaisesRegex(archive.ArchiveError, 'interrupted'):
            archive.archive_case(self.source, CASE, self.root)
        self.assertEqual(len(self.source.tables['ArchiveReceipts']), 1)
        self.assertEqual(self.source.tables['Proofs'][0]['status'], 'archive_error')
        retry = archive.archive_case(self.source, CASE, self.root)
        self.assertTrue(retry['reused'])
        self.assertEqual(len(self.source.tables['ArchiveReceipts']), 1)
        self.assertEqual(self.source.tables['ArchiveReceipts'][0]['status'], 'verified')
        self.assertEqual(self.source.tables['Proofs'][0]['status'], 'archived_verified')

    def test_connector_bundle_generates_local_archive_and_exact_write_plan(self):
        bundle = {
            'schema_version': 1, 'captured_at_utc': archive.utc_now(),
            'actor_email': 'owner@example.com', 'demo_root': self.source.root,
            'spreadsheet_id': 'sheet-1', 'proof_folder_id': 'person-folder',
            'doc_id': 'doc-1', 'pdf_id': 'pdf-1', 'files': self.source.files,
            'children': [dict(item, parents=['person-folder']) for item in self.source.children],
            'tables': {},
            'pdf_base64': base64.b64encode(self.source.pdf_bytes).decode(),
            'docx_base64': base64.b64encode(self.source.docx_bytes).decode(),
        }
        tables = dict(self.source.tables)
        tables['People'] = [dict(zip(archive.SHEETS['People'],
                                     ['MATT', 'owner@example.com', 'owner', '[DEMO]', 'PER-01', 'Daniel']))]
        for name, headers in archive.SHEETS.items():
            bundle['tables'][name] = {'headers': headers,
                                      'rows': [[row[key] for key in headers] for row in tables[name]]}
        bundle_path = Path(self.temp.name) / 'bundle.json'
        plan_path = Path(self.temp.name) / 'plan.json'
        bundle_path.write_text(json.dumps(bundle))
        result = archive.bundle_case(bundle_path, CASE, self.root, plan_path)
        self.assertEqual(result['status'], 'pending_connector_commit')
        self.assertEqual(result['operations'], 2)
        plan = json.loads(plan_path.read_text())
        self.assertEqual([item['action'] for item in plan['operations']], ['append', 'update'])
        self.assertEqual([item['tab'] for item in plan['operations']], ['ArchiveReceipts', 'Proofs'])
        self.assertEqual(plan['operations'][1]['expected'][11], 'pending_local_archive')
        self.assertEqual(plan['operations'][1]['values'][11], 'archived_verified')
        self.assertEqual(self.source.tables['ArchiveReceipts'], [])  # No connected write.
        self.assertEqual(self.source.tables['Proofs'][0]['status'], 'pending_local_archive')
        self.assertTrue(Path(result['manifest']).is_file())
        bundle['tables']['ArchiveReceipts']['rows'].append(plan['operations'][0]['values'])
        bundle['tables']['Proofs']['rows'][0] = plan['operations'][1]['values']
        bundle_path.write_text(json.dumps(bundle))
        verified = archive.verify_bundle_commit(bundle_path, CASE, self.root)
        self.assertEqual(verified['receipt_count'], 1)
        bundle['tables']['ArchiveReceipts']['rows'][0][9] = '0' * 64
        bundle_path.write_text(json.dumps(bundle))
        with self.assertRaisesRegex(archive.ArchiveError, 'receipt differs'):
            archive.verify_bundle_commit(bundle_path, CASE, self.root)
        bundle['pdf_id'] = 'wrong-file'
        bundle_path.write_text(json.dumps(bundle))
        plan_path.unlink()
        with self.assertRaisesRegex(archive.ArchiveError, 'pdf_id differs'):
            archive.bundle_case(bundle_path, CASE, self.root, plan_path)
        self.assertFalse(plan_path.exists())


class ArchiveOAuthTests(unittest.TestCase):
    def test_authorization_url_requests_only_approved_scopes_with_pkce(self):
        url = archive.oauth_authorization_url('example.apps.googleusercontent.com',
                                              'http://localhost:12345/callback', 'random-state', 'pkce-challenge')
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.hostname, 'accounts.google.com')
        self.assertEqual(set(query['scope'][0].split()), set(archive.SCOPES))
        self.assertEqual(query['include_granted_scopes'], ['false'])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertEqual(query['state'], ['random-state'])
        self.assertNotIn('script.deployments', url)
        self.assertEqual(archive.pkce_challenge('abc'), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')

    def test_callback_state_and_exact_scope_gate(self):
        self.assertEqual(archive.callback_code('/callback?state=expected&code=secret', 'expected'), 'secret')
        for callback in ('/callback?state=wrong&code=secret', '/callback?state=expected',
                         '/other?state=expected&code=secret', '/callback?state=expected&error=denied'):
            with self.assertRaises(archive.ArchiveError):
                archive.callback_code(callback, 'expected')
        archive.require_exact_scopes(list(archive.SCOPES))
        with self.assertRaisesRegex(archive.ArchiveError, 'differs'):
            archive.require_exact_scopes(list(archive.SCOPES) + ['https://www.googleapis.com/auth/cloud-platform'])

    def test_auth_does_not_save_when_browser_cannot_open(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / 'clasp.json', Path(temp) / 'archive.json'
            source.write_text(json.dumps({'tokens': {'default': {
                'client_id': 'example.apps.googleusercontent.com', 'client_secret': 'private'}}}))
            fake_server = mock.MagicMock()
            fake_server.__enter__.return_value.server_port = 12345
            with mock.patch.object(archive.http.server, 'HTTPServer', return_value=fake_server), \
                    mock.patch.object(archive.webbrowser, 'open', return_value=False):
                with self.assertRaisesRegex(archive.ArchiveError, 'Could not open'):
                    archive.authorize(source, output)
            self.assertFalse(output.exists())

    def test_existing_clasp_login_is_rejected_as_archive_credential(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'clasp.json'
            path.write_text(json.dumps({'tokens': {'default': {'client_id': 'x',
                                                               'client_secret': 'x', 'refresh_token': 'x'}}}))
            with self.assertRaisesRegex(archive.ArchiveError, 'not the broad clasp login'):
                archive.GoogleApi(path)

    def test_no_browser_prints_scope_limited_url_without_code_or_token(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / 'clasp.json', Path(temp) / 'archive.json'
            source.write_text(json.dumps({'tokens': {'default': {
                'client_id': 'example.apps.googleusercontent.com', 'client_secret': 'private'}}}))
            fake_server = mock.MagicMock()
            fake_server.__enter__.return_value.server_port = 12345
            capture = io.StringIO()
            with mock.patch.object(archive.http.server, 'HTTPServer', return_value=fake_server), \
                    mock.patch.object(archive.webbrowser, 'open') as browser, redirect_stdout(capture):
                with self.assertRaisesRegex(archive.ArchiveError, 'No valid OAuth callback'):
                    archive.authorize(source, output, no_browser=True)
            browser.assert_not_called()
            self.assertFalse(output.exists())
            url = capture.getvalue().strip().splitlines()[-1]
            query = parse_qs(urlparse(url).query)
            self.assertEqual(set(query['scope'][0].split()), set(archive.SCOPES))
            self.assertNotIn('code', query)
            self.assertNotIn('access_token', query)


if __name__ == '__main__':
    unittest.main()
