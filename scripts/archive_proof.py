#!/usr/bin/env python3
"""Mirror one [DEMO] proof from Drive, then acknowledge its verified local copy.

The only Google writes are ArchiveReceipts and the corresponding Proofs status.
Use a separate, ignored OAuth token with only the two required API scopes.
"""

from __future__ import annotations

import argparse
import base64
import copy
import csv
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen
import webbrowser

try:
    import certifi
except ImportError:
    certifi = None


ROOT = Path(__file__).resolve().parents[1]
SCOPES = (
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
)
SHEETS = {
    'People': ['person_key', 'email', 'demo_role', 'demo_marker', 'persona_id', 'display_alias'],
    'Proofs': ['proof_id', 'proof_version', 'request_id', 'case_id', 'person_key', 'topic_id', 'source_hash', 'created_at', 'folder_id', 'doc_id', 'pdf_id', 'status', 'demo_marker'],
    'ArchiveReceipts': ['proof_id', 'proof_version', 'case_id', 'request_id', 'person_key', 'topic_id', 'source_hash', 'doc_id', 'pdf_id', 'drive_pdf_sha256', 'local_pdf_sha256', 'local_docx_sha256', 'local_pdf_path', 'local_docx_path', 'manifest_path', 'verified_at', 'status', 'demo_marker'],
    'SessionCases': ['session_id', 'case_id', 'request_id', 'person_key', 'demo_marker'],
    'TrainerAssessments': ['response_id', 'form_id', 'session_id', 'case_id', 'person_key', 'reporter_email', 'submitted_at', 'attendance', 'assessment', 'note', 'attestation', 'disposition', 'reason', 'demo_marker'],
    'ParticipantAcknowledgements': ['response_id', 'form_id', 'request_id', 'session_id', 'case_id', 'person_key', 'respondent_email', 'submitted_at', 'typed_name', 'affirmative', 'disposition', 'reason', 'demo_marker'],
}
SAFE_ID = re.compile(r'^[A-Za-z0-9_-]{2,120}$')
HEX64 = re.compile(r'^[0-9a-f]{64}$')


class ArchiveError(Exception):
    pass


def tls_context():
    return ssl.create_default_context(cafile=certifi.where()) if certifi else ssl.create_default_context()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_id(value: object, label: str) -> str:
    value = str(value)
    if not SAFE_ID.fullmatch(value):
        raise ArchiveError(f'Invalid {label}; refusing archive path.')
    return value


def one(rows: list[dict], label: str) -> dict:
    if len(rows) != 1:
        raise ArchiveError(f'Expected exactly one {label}; found {len(rows)}.')
    return rows[0]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.archive-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def api_url(base: str, path: str, **params: str) -> str:
    return base.rstrip('/') + '/' + path.lstrip('/') + ('?' + urlencode(params) if params else '')


def require_exact_scopes(value: str | list[str]) -> None:
    granted = set(value.split() if isinstance(value, str) else value)
    if granted != set(SCOPES):
        raise ArchiveError('OAuth grant differs from the two approved archive scopes; no credential saved.')


def pkce_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).rstrip(b'=').decode('ascii')


def oauth_authorization_url(client_id: str, redirect: str, state: str, challenge: str) -> str:
    return api_url('https://accounts.google.com', 'o/oauth2/v2/auth',
                   client_id=client_id, redirect_uri=redirect, response_type='code',
                   scope=' '.join(SCOPES), access_type='offline', prompt='consent',
                   include_granted_scopes='false', state=state,
                   code_challenge=challenge, code_challenge_method='S256')


def callback_code(path: str, state: str) -> str:
    parsed = urlparse(path)
    query = parse_qs(parsed.query)
    if (parsed.path != '/callback' or query.get('state') != [state] or
            query.get('error') or len(query.get('code', [])) != 1):
        raise ArchiveError('OAuth callback path, state, or response is invalid.')
    return query['code'][0]


def oauth_request(url: str, *, body: bytes | None = None) -> dict:
    headers = {'Content-Type': 'application/x-www-form-urlencoded'} if body else {}
    try:
        with urlopen(Request(url, data=body, headers=headers, method='POST' if body else 'GET'),
                     timeout=30, context=tls_context()) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError):
        raise ArchiveError(f'OAuth request to {urlparse(url).hostname} failed; no credential saved.') from None


def authorize(clasp_credentials: Path, archive_credentials: Path, *, no_browser: bool = False) -> None:
    if archive_credentials.exists():
        raise ArchiveError('Archive credential file already exists; refusing to replace it.')
    if clasp_credentials.resolve() == archive_credentials.resolve():
        raise ArchiveError('Archive credential must use a separate file.')
    try:
        existing = json.loads(clasp_credentials.read_text())['tokens']['default']
        client_id, client_secret = existing['client_id'], existing['client_secret']
    except (OSError, ValueError, KeyError):
        raise ArchiveError('Cannot read the existing local clasp OAuth client metadata.') from None
    if not client_id.endswith('.apps.googleusercontent.com') or not client_secret:
        raise ArchiveError('Existing clasp OAuth client metadata is invalid.')
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = pkce_challenge(verifier)
    result = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            expected_host = f'localhost:{self.server.server_port}'
            try:
                if self.headers.get('Host') != expected_host:
                    raise ArchiveError('OAuth callback host is invalid.')
                result['code'] = callback_code(self.path, state)
            except ArchiveError:
                self.send_error(400)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'Local archive authorization received. Return to the terminal.')

        def log_message(self, *_):
            pass  # Callback URL contains the OAuth code; never log it.

    with http.server.HTTPServer(('localhost', 0), Callback) as server:
        server.timeout = 180
        redirect = f'http://localhost:{server.server_port}/callback'
        url = oauth_authorization_url(client_id, redirect, state, challenge)
        if no_browser:
            # Contains client ID, state, and PKCE challenge, but no code or token.
            print('Open this Google authorization URL in the same computer browser:', flush=True)
            print(url, flush=True)
        else:
            print('Opening Google OAuth for Drive read-only and Sheets access only.')
            if not webbrowser.open(url):
                raise ArchiveError('Could not open the system browser for OAuth; retry with --no-browser.')
        server.handle_request()
    if not result.get('code'):
        raise ArchiveError('No valid OAuth callback arrived; no credential saved.')
    token = oauth_request('https://oauth2.googleapis.com/token', body=urlencode({
        'client_id': client_id, 'client_secret': client_secret, 'code': result['code'],
        'redirect_uri': redirect, 'grant_type': 'authorization_code',
        'code_verifier': verifier,
    }).encode())
    if not token.get('refresh_token') or not token.get('access_token'):
        raise ArchiveError('OAuth did not return a separate refresh and access token.')
    if token.get('scope'):
        require_exact_scopes(token['scope'])
    info = oauth_request(api_url('https://oauth2.googleapis.com', 'tokeninfo',
                                 access_token=token['access_token']))
    require_exact_scopes(info.get('scope', ''))
    audience = info.get('aud') or info.get('audience') or info.get('issued_to')
    if audience and audience != client_id:
        raise ArchiveError('OAuth token belongs to a different client; no credential saved.')
    archive_credentials.parent.mkdir(parents=True, exist_ok=True)
    payload = {'type': 'authorized_user', 'client_id': client_id,
               'client_secret': client_secret, 'refresh_token': token['refresh_token'],
               'scopes': list(SCOPES)}
    atomic_write(archive_credentials, json_bytes(payload))
    archive_credentials.chmod(0o600)
    print(f'Saved narrow archive OAuth credential to {archive_credentials}.')


class GoogleApi:
    def __init__(self, credential_path: Path):
        self.credential_path = credential_path
        try:
            saved = json.loads(credential_path.read_text())
        except (OSError, ValueError) as exc:
            raise ArchiveError(f'Cannot read OAuth credential file {credential_path}: {exc}') from None
        if saved.get('type') != 'authorized_user':
            raise ArchiveError('Use a separate narrow archive OAuth credential, not the broad clasp login.')
        require_exact_scopes(saved.get('scopes', []))
        self.credentials = saved
        if not all(self.credentials.get(key) for key in ('client_id', 'client_secret', 'refresh_token')):
            raise ArchiveError('OAuth credential lacks client ID, client secret, or refresh token.')
        self.token = ''

    def _refresh(self) -> None:
        body = urlencode({
            'client_id': self.credentials['client_id'],
            'client_secret': self.credentials['client_secret'],
            'refresh_token': self.credentials['refresh_token'],
            'grant_type': 'refresh_token',
        }).encode()
        response = self._raw('https://oauth2.googleapis.com/token', method='POST', body=body,
                             content_type='application/x-www-form-urlencoded', authorized=False)
        self.token = json.loads(response)['access_token']
        info = json.loads(self._raw(api_url('https://oauth2.googleapis.com', 'tokeninfo',
                                            access_token=self.token), authorized=False))
        require_exact_scopes(info.get('scope', ''))
        audience = info.get('aud') or info.get('audience') or info.get('issued_to')
        if audience and audience != self.credentials['client_id']:
            raise ArchiveError('Archive OAuth token belongs to a different client.')

    def _raw(self, url: str, *, method='GET', body=None, content_type=None, authorized=True) -> bytes:
        if authorized and not self.token:
            self._refresh()
        headers = {}
        if authorized:
            headers['Authorization'] = 'Bearer ' + self.token
        if content_type:
            headers['Content-Type'] = content_type
        try:
            with urlopen(Request(url, data=body, headers=headers, method=method),
                         timeout=30, context=tls_context()) as response:
                return response.read()
        except HTTPError as exc:
            # Google errors may include tokens/PII; expose only status and request host.
            raise ArchiveError(f'Google API request to {urlparse(url).hostname} failed (HTTP {exc.code}).') from None
        except (URLError, TimeoutError) as exc:
            raise ArchiveError(f'Google API connection to {urlparse(url).hostname} failed: {exc.reason if isinstance(exc, URLError) else "timeout"}.') from None

    def json(self, url: str, *, method='GET', value=None) -> dict:
        body = json.dumps(value).encode() if value is not None else None
        return json.loads(self._raw(url, method=method, body=body,
                                    content_type='application/json' if body is not None else None))

    def bytes(self, url: str) -> bytes:
        return self._raw(url)


class Source:
    def __init__(self, api: GoogleApi):
        self.api = api
        self.drive = 'https://www.googleapis.com/drive/v3'
        self.sheets = 'https://sheets.googleapis.com/v4'
        about = api.json(api_url(self.drive, 'about', fields='user(emailAddress)'))
        self.actor = about.get('user', {}).get('emailAddress', '').lower()
        if not self.actor:
            raise ArchiveError('Could not identify the authorized Google account.')
        roots = self.list_files("name = 'Cosanum Training Prototype' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false")
        self.root = one(roots, 'demo root folder')
        sheets = self.list_files(f"name = 'catalogue-and-skill-matrix' and mimeType = 'application/vnd.google-apps.spreadsheet' and '{self.root['id']}' in parents and trashed = false")
        self.spreadsheet = one(sheets, 'demo spreadsheet')['id']
        owner = one([p for p in self.rows('People') if p['person_key'] == 'MATT' and p['demo_marker'] == '[DEMO]'], 'demo owner')
        if owner['email'].lower() != self.actor:
            raise ArchiveError('Archive OAuth account is not the demo owner.')

    def list_files(self, query: str) -> list[dict]:
        files, page = [], ''
        while True:
            result = self.api.json(api_url(self.drive, 'files', q=query, pageSize='1000',
                                           fields='nextPageToken,files(id,name,mimeType,parents,size,trashed)',
                                           pageToken=page))
            files.extend(result.get('files', []))
            page = result.get('nextPageToken', '')
            if not page:
                return files

    def file(self, file_id: str) -> dict:
        return self.api.json(api_url(self.drive, 'files/' + quote(file_id),
                                     fields='id,name,mimeType,parents,size,trashed'))

    def rows(self, tab: str) -> list[dict]:
        expected = SHEETS[tab]
        result = self.api.json(api_url(self.sheets,
                                       f"spreadsheets/{self.spreadsheet}/values/{quote(tab + '!A1:Z', safe='')}",
                                       valueRenderOption='UNFORMATTED_VALUE'))
        values = result.get('values', [])
        if not values or values[0] != expected:
            raise ArchiveError(f'Sheet {tab} does not match the expected schema; run setupDemo() first.')
        return [dict(zip(expected, row + [''] * (len(expected) - len(row))))
                for row in values[1:] if row and row[0] != '']

    def update_row(self, tab: str, row_number: int, values: list) -> None:
        cell = f'{tab}!A{row_number}:{chr(64 + len(values))}{row_number}'
        self.api.json(api_url(self.sheets,
                              f"spreadsheets/{self.spreadsheet}/values/{quote(cell, safe='')}",
                              valueInputOption='RAW'), method='PUT',
                      value={'range': cell, 'majorDimension': 'ROWS', 'values': [values]})

    def append_row(self, tab: str, values: list) -> None:
        self.api.json(api_url(self.sheets,
                              f"spreadsheets/{self.spreadsheet}/values/{quote(tab + '!A:R', safe='')}:append",
                              valueInputOption='RAW', insertDataOption='INSERT_ROWS'),
                      method='POST', value={'values': [values]})

    def pdf(self, file_id: str) -> bytes:
        return self.api.bytes(api_url(self.drive, 'files/' + quote(file_id), alt='media'))

    def docx(self, file_id: str) -> bytes:
        return self.api.bytes(api_url(self.drive, 'files/' + quote(file_id) + '/export',
                                      mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'))


class BundleSource:
    """Read-only connector capture with in-memory receipt mutations for a reviewable plan."""

    def __init__(self, bundle: dict):
        if bundle.get('schema_version') != 1 or not bundle.get('captured_at_utc'):
            raise ArchiveError('Connector bundle schema or capture time is missing.')
        self.bundle = bundle
        self.root = bundle.get('demo_root', {})
        if self.root.get('name') != 'Cosanum Training Prototype' or not self.root.get('id'):
            raise ArchiveError('Connector bundle does not identify the demo Drive root.')
        self.spreadsheet = safe_id(bundle.get('spreadsheet_id'), 'demo spreadsheet ID')
        self.actor = str(bundle.get('actor_email', '')).strip().lower()
        self.tables = {}
        for tab, expected in SHEETS.items():
            item = bundle.get('tables', {}).get(tab, {})
            if item.get('headers') != expected or not isinstance(item.get('rows'), list):
                raise ArchiveError(f'Connector bundle has missing or mismatched {tab} rows.')
            rows = item['rows']
            if any(not isinstance(row, list) or len(row) > len(expected) for row in rows):
                raise ArchiveError(f'Connector bundle has malformed {tab} rows.')
            self.tables[tab] = [dict(zip(expected, row + [''] * (len(expected) - len(row))))
                                for row in rows if row and row[0] != '']
        owner = one([row for row in self.rows('People')
                     if row['person_key'] == 'MATT' and row['demo_marker'] == '[DEMO]'], 'demo owner')
        if not self.actor or self.actor != str(owner['email']).lower():
            raise ArchiveError('Connector capture account is not the demo owner.')
        self.operations = []

    def rows(self, tab: str) -> list[dict]:
        return copy.deepcopy(self.tables[tab])

    def file(self, file_id: str) -> dict:
        item = self.bundle.get('files', {}).get(file_id)
        if not isinstance(item, dict) or item.get('id') != file_id:
            raise ArchiveError('Connector bundle lacks required Drive folder metadata.')
        return copy.deepcopy(item)

    def list_files(self, query: str) -> list[dict]:
        proof_folder = self.bundle.get('proof_folder_id')
        if not proof_folder or f"'{proof_folder}' in parents" not in query:
            raise ArchiveError('Connector bundle folder listing does not match proof folder.')
        children = self.bundle.get('children')
        if not isinstance(children, list):
            raise ArchiveError('Connector bundle lacks Drive proof folder children.')
        if any(proof_folder not in item.get('parents', []) for item in children):
            raise ArchiveError('Connector bundle child has a different parent.')
        return copy.deepcopy(children)

    def pdf(self, file_id: str) -> bytes:
        if file_id != self.bundle.get('pdf_id'):
            raise ArchiveError('Connector PDF ID differs from the proof register.')
        return self._bytes('pdf_base64')

    def docx(self, file_id: str) -> bytes:
        if file_id != self.bundle.get('doc_id'):
            raise ArchiveError('Connector DOCX source ID differs from the proof register.')
        return self._bytes('docx_base64')

    def _bytes(self, key: str) -> bytes:
        value = self.bundle.get(key)
        if not isinstance(value, str) or len(value) > 20_000_000:
            raise ArchiveError(f'Connector bundle lacks a usable {key} payload.')
        try:
            return base64.b64decode(value, validate=True)
        except (ValueError, base64.binascii.Error):
            raise ArchiveError(f'Connector bundle has invalid {key} encoding.') from None

    def update_row(self, tab: str, row_number: int, values: list) -> None:
        before = self.tables[tab][row_number - 2]
        expected = [before[key] for key in SHEETS[tab]]
        self.operations.append({'action': 'update', 'tab': tab, 'row_number': row_number,
                                'expected': expected, 'values': values})
        self.tables[tab][row_number - 2] = dict(zip(SHEETS[tab], values))

    def append_row(self, tab: str, values: list) -> None:
        self.operations.append({'action': 'append', 'tab': tab, 'expected_row_count': len(self.tables[tab]),
                                'expected_absent_proof_id': values[0], 'values': values})
        self.tables[tab].append(dict(zip(SHEETS[tab], values)))

def proof_record(source: Source, case_id: str) -> tuple[dict, int]:
    rows = source.rows('Proofs')
    matches = [(row, number) for number, row in enumerate(rows, 2) if row['case_id'] == case_id]
    proof, number = one(matches, 'proof row for person case')
    for key in ('proof_id', 'case_id', 'request_id', 'person_key', 'topic_id', 'folder_id', 'doc_id', 'pdf_id'):
        safe_id(proof[key], key)
    if (proof['proof_id'] != 'PRF-' + case_id.removeprefix('CASE-') or
            proof['demo_marker'] != '[DEMO]' or str(proof['proof_version']) != '1' or
            not HEX64.fullmatch(str(proof['source_hash'])) or
            proof['status'] not in ('pending_local_archive', 'archive_error', 'archived_verified')):
        raise ArchiveError('Proof row has conflicting identity, version, fingerprint, or status.')
    datetime.fromisoformat(str(proof['created_at']).replace('Z', '+00:00'))
    if len([p for p in rows if p['proof_id'] == proof['proof_id']]) != 1:
        raise ArchiveError('Duplicate proof ID in the demo register.')
    return proof, number


def folder_and_files(source: Source, proof: dict) -> None:
    # Check each parent and exact file name. File IDs alone could point elsewhere.
    folder = source.file(proof['folder_id'])
    expected = [proof['person_key'], proof['request_id'], proof['topic_id'], 'evidence-archive']
    for name in expected:
        if folder.get('trashed') or folder.get('name') != name or folder.get('mimeType') != 'application/vnd.google-apps.folder':
            raise ArchiveError('Drive evidence folder does not match the proof topic/request/person path.')
        parent_ids = folder.get('parents', [])
        if len(parent_ids) != 1:
            raise ArchiveError('Drive evidence folder has an ambiguous parent.')
        folder = source.file(parent_ids[0])
    if folder.get('id') != source.root['id']:
        raise ArchiveError('Drive evidence folder is outside the demo root.')
    name = f"{proof['proof_id']}-v{proof['proof_version']} [DEMO]"
    expected_files = [(proof['doc_id'], name, 'application/vnd.google-apps.document'),
                      (proof['pdf_id'], name + '.pdf', 'application/pdf')]
    children = source.list_files(f"'{proof['folder_id']}' in parents and trashed = false")
    for file_id, filename, mime in expected_files:
        found = [item for item in children if item['name'] == filename]
        if len(found) != 1 or found[0]['id'] != file_id or found[0]['mimeType'] != mime:
            raise ArchiveError('Drive proof file identity, format, or uniqueness does not match the register.')


def source_ids(source: Source, proof: dict) -> tuple[list[str], dict[str, list[str]]]:
    links = [row for row in source.rows('SessionCases') if row['case_id'] == proof['case_id']]
    if not links or any(row['request_id'] != proof['request_id'] or
                        row['person_key'] != proof['person_key'] or row['demo_marker'] != '[DEMO]'
                        for row in links):
        raise ArchiveError('Session/person source links are incomplete or inconsistent.')
    sessions = [safe_id(row['session_id'], 'session ID') for row in links]
    if len(sessions) != len(set(sessions)):
        raise ArchiveError('Duplicate session link for the proof.')
    trainers, participants = source.rows('TrainerAssessments'), source.rows('ParticipantAcknowledgements')
    trainer_ids, participant_ids = [], []
    for session in sessions:
        t = one([row for row in trainers if row['case_id'] == proof['case_id'] and
                 row['session_id'] == session and row['disposition'] == 'accepted' and
                 row['demo_marker'] == '[DEMO]' and row['attendance'] == 'attended' and
                 row['assessment'] == 'passed' and row['attestation'] == 'yes'], 'accepted trainer source')
        p = one([row for row in participants if row['case_id'] == proof['case_id'] and
                 row['session_id'] == session and row['disposition'] == 'accepted' and
                 row['demo_marker'] == '[DEMO]' and row['affirmative'] == 'yes'], 'accepted participant source')
        trainer_ids.append(str(t['response_id']))
        participant_ids.append(str(p['response_id']))
    return sessions, {'trainer': trainer_ids, 'participant': participant_ids}


def valid_docx(data: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return '[Content_Types].xml' in archive.namelist() and 'word/document.xml' in archive.namelist() and archive.testzip() is None
    except zipfile.BadZipFile:
        return False


def archive_paths(root: Path, proof: dict) -> tuple[Path, Path, Path]:
    folder = root / 'evidence' / proof['topic_id'] / proof['request_id'] / proof['person_key']
    basename = f"{proof['proof_id']}-v{proof['proof_version']}"
    return folder / (basename + '.pdf'), folder / (basename + '.docx'), folder / (basename + '.manifest.json')


def verify_existing(manifest: dict, proof: dict, pdf_path: Path, docx_path: Path,
                    drive_sha: str) -> bool:
    identity = (manifest.get('proof_id') == proof['proof_id'] and
                str(manifest.get('proof_version')) == str(proof['proof_version']) and
                manifest.get('case_id') == proof['case_id'] and
                manifest.get('topic_id') == proof['topic_id'] and
                manifest.get('request_id') == proof['request_id'] and
                manifest.get('person_key') == proof['person_key'] and
                manifest.get('source_hash') == proof['source_hash'] and
                manifest.get('drive', {}).get('doc_id') == proof['doc_id'] and
                manifest.get('drive', {}).get('pdf_id') == proof['pdf_id'])
    if not identity:
        raise ArchiveError('Existing manifest belongs to a different proof, version, or source.')
    if manifest.get('pdf_sha256') != drive_sha:
        raise ArchiveError('Drive PDF changed after local proof was archived; corrected version needed.')
    if not pdf_path.is_file() or not docx_path.is_file():
        return False
    pdf = pdf_path.read_bytes()
    docx = docx_path.read_bytes()
    return (pdf.startswith(b'%PDF-') and sha256(pdf) == drive_sha and
            valid_docx(docx) and sha256(docx) == manifest.get('local', {}).get('docx_sha256'))


def manifest_for(proof: dict, sessions: list[str], responses: dict[str, list[str]],
                 root: Path, pdf_path: Path, docx_path: Path, pdf_sha: str, docx_sha: str,
                 verified_at: str) -> dict:
    def relative(path: Path) -> str:
        return str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)
    return {
        'schema_version': 1, 'demo_marker': '[DEMO]', 'topic_id': proof['topic_id'],
        'request_id': proof['request_id'], 'session_ids': sessions, 'case_id': proof['case_id'],
        'person_key': proof['person_key'], 'proof_id': proof['proof_id'],
        'proof_version': int(proof['proof_version']), 'source_hash': proof['source_hash'],
        'generated_at_utc': proof['created_at'], 'source_response_ids': responses,
        'drive': {'doc_id': proof['doc_id'], 'pdf_id': proof['pdf_id'], 'folder_id': proof['folder_id']},
        'local': {'pdf_path': relative(pdf_path), 'editable_path': relative(docx_path), 'docx_sha256': docx_sha},
        'pdf_sha256': pdf_sha,
        'verification': {'status': 'verified', 'verified_at_utc': verified_at,
                         'drive_pdf_sha256': pdf_sha, 'local_pdf_sha256': pdf_sha},
    }


def build_index(root: Path) -> None:
    records = []
    for path in sorted((root / 'evidence').glob('*/*/*/*.manifest.json')):
        item = json.loads(path.read_text())
        pdf = Path(item['local']['pdf_path'])
        if not pdf.is_absolute():
            pdf = ROOT / pdf
        if not pdf.resolve().is_relative_to(root.resolve()):
            raise ArchiveError('Manifest PDF path is outside the local archive.')
        if not pdf.is_file() or sha256(pdf.read_bytes()) != item['pdf_sha256']:
            raise ArchiveError('Cannot index a missing or corrupt archive PDF.')
        records.append([item['topic_id'], item['request_id'], item['person_key'], item['case_id'],
                        item['proof_id'], item['proof_version'], item['pdf_sha256'],
                        str(path), item['verification']['status']])
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['topic_id', 'request_id', 'person_key', 'case_id', 'proof_id',
                     'proof_version', 'pdf_sha256', 'manifest_path', 'status'])
    writer.writerows(records)
    atomic_write(root / 'index.csv', output.getvalue().encode('utf-8'))


def receipt_values(proof: dict, manifest: dict, manifest_path: Path) -> list:
    local, verification = manifest['local'], manifest['verification']
    return [proof['proof_id'], int(proof['proof_version']), proof['case_id'], proof['request_id'],
            proof['person_key'], proof['topic_id'], proof['source_hash'], proof['doc_id'],
            proof['pdf_id'], verification['drive_pdf_sha256'], verification['local_pdf_sha256'],
            local['docx_sha256'], local['pdf_path'], local['editable_path'], str(manifest_path),
            verification['verified_at_utc'], 'verified', '[DEMO]']


def write_receipt(source: Source, proof: dict, proof_number: int, manifest: dict, manifest_path: Path) -> None:
    current, current_number = proof_record(source, proof['case_id'])
    if current_number != proof_number or current != proof:
        raise ArchiveError('Proof register changed during local archive verification.')
    values = receipt_values(proof, manifest, manifest_path)
    receipts = source.rows('ArchiveReceipts')
    matches = [(row, i) for i, row in enumerate(receipts, 2) if row['proof_id'] == proof['proof_id']]
    if len(matches) > 1:
        raise ArchiveError('Duplicate archive receipts in the demo register.')
    if matches:
        old, number = matches[0]
        if any(str(old[key]) != str(value) for key, value in zip(SHEETS['ArchiveReceipts'], values)
               if key not in ('verified_at', 'status')):
            raise ArchiveError('Registered archive receipt differs from the verified local proof.')
        if old['status'] != 'verified':
            source.update_row('ArchiveReceipts', number, values)
    else:
        source.append_row('ArchiveReceipts', values)
    if proof['status'] != 'archived_verified':
        updated = [proof[key] for key in SHEETS['Proofs']]
        updated[11] = 'archived_verified'
        source.update_row('Proofs', proof_number, updated)


def mark_archive_error(source: Source, proof: dict, number: int) -> None:
    try:
        current, current_number = proof_record(source, proof['case_id'])
        if current_number != number or current['proof_id'] != proof['proof_id']:
            return
        updated = [current[key] for key in SHEETS['Proofs']]
        updated[11] = 'archive_error'
        source.update_row('Proofs', number, updated)
        receipts = source.rows('ArchiveReceipts')
        matches = [(row, i) for i, row in enumerate(receipts, 2) if row['proof_id'] == proof['proof_id']]
        if len(matches) == 1 and matches[0][0]['status'] != 'archive_error':
            receipt = [matches[0][0][key] for key in SHEETS['ArchiveReceipts']]
            receipt[16] = 'archive_error'
            source.update_row('ArchiveReceipts', matches[0][1], receipt)
    except (ArchiveError, OSError, ValueError):
        # A disconnected Google API cannot receive an error receipt.
        pass


def archive_case(source: Source, case_id: str, root: Path, *, repair: bool = False) -> dict:
    proof, number = proof_record(source, case_id)
    try:
        folder_and_files(source, proof)
        sessions, responses = source_ids(source, proof)
        pdf = source.pdf(proof['pdf_id'])
        if not pdf.startswith(b'%PDF-') or len(pdf) < 100:
            raise ArchiveError('Drive PDF is not a readable proof PDF.')
        drive_sha = sha256(pdf)
        pdf_path, docx_path, manifest_path = archive_paths(root, proof)
        existing = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
        reuse = existing is not None and verify_existing(existing, proof, pdf_path, docx_path, drive_sha)
        if existing is not None and not reuse and not repair:
            raise ArchiveError('Local archive is missing or corrupt; rerun with --repair after review.')
        if reuse:
            manifest = existing
            if manifest['source_response_ids'] != responses or manifest['session_ids'] != sessions:
                raise ArchiveError('Source evidence changed after local archiving.')
        else:
            saved_docx = docx_path.read_bytes() if existing is not None and docx_path.is_file() else b''
            if saved_docx and valid_docx(saved_docx) and sha256(saved_docx) == existing['local'].get('docx_sha256'):
                docx = saved_docx
            else:
                docx = source.docx(proof['doc_id'])
            if not valid_docx(docx):
                raise ArchiveError('Google Doc export is not a readable DOCX.')
            if existing is not None and sha256(docx) != existing['local'].get('docx_sha256'):
                raise ArchiveError('Google Doc export differs from the archived snapshot; corrected version needed.')
            atomic_write(pdf_path, pdf)
            atomic_write(docx_path, docx)
            if sha256(pdf_path.read_bytes()) != drive_sha or not valid_docx(docx_path.read_bytes()):
                raise ArchiveError('Local PDF or DOCX failed readback.')
            manifest = manifest_for(proof, sessions, responses, root, pdf_path, docx_path,
                                    drive_sha, sha256(docx), utc_now())
            atomic_write(manifest_path, json_bytes(manifest))
        build_index(root)
        write_receipt(source, proof, number, manifest, manifest_path)
        return {'proof_id': proof['proof_id'], 'status': 'archived_verified', 'reused': reuse,
                'pdf_sha256': drive_sha, 'manifest': str(manifest_path)}
    except (ArchiveError, OSError, ValueError, KeyError) as exc:
        mark_archive_error(source, proof, number)
        if isinstance(exc, ArchiveError):
            raise
        raise ArchiveError(f'Local archive failed: {type(exc).__name__}.') from None


def bundle_case(bundle_path: Path, case_id: str, root: Path, plan_path: Path, *, repair: bool = False) -> dict:
    try:
        bundle_bytes = bundle_path.read_bytes()
        bundle = json.loads(bundle_bytes)
    except (OSError, ValueError):
        raise ArchiveError('Cannot read the ignored connector capture bundle.') from None
    source = BundleSource(bundle)
    proof, _ = proof_record(source, case_id)
    for bundle_key, proof_key in (('proof_folder_id', 'folder_id'), ('doc_id', 'doc_id'), ('pdf_id', 'pdf_id')):
        if bundle.get(bundle_key) != proof[proof_key]:
            raise ArchiveError(f'Connector bundle {bundle_key} differs from the proof register.')
    result = archive_case(source, case_id, root, repair=repair)
    plan = {
        'schema_version': 1, 'demo_marker': '[DEMO]', 'status': 'pending_connector_commit',
        'captured_at_utc': bundle['captured_at_utc'], 'bundle_sha256': sha256(bundle_bytes),
        'spreadsheet_id': source.spreadsheet, 'case_id': case_id, 'proof_id': result['proof_id'],
        'drive_pdf_sha256': result['pdf_sha256'], 'manifest_path': result['manifest'],
        'operations': source.operations,
    }
    atomic_write(plan_path, json_bytes(plan))
    return {'proof_id': result['proof_id'], 'status': 'pending_connector_commit',
            'reused': result['reused'], 'pdf_sha256': result['pdf_sha256'],
            'manifest': result['manifest'], 'receipt_plan': str(plan_path),
            'operations': len(source.operations)}


def verify_bundle_commit(bundle_path: Path, case_id: str, root: Path) -> dict:
    try:
        bundle = json.loads(bundle_path.read_bytes())
    except (OSError, ValueError):
        raise ArchiveError('Cannot read the fresh connector verification bundle.') from None
    source = BundleSource(bundle)
    proof, _ = proof_record(source, case_id)
    if proof['status'] != 'archived_verified':
        raise ArchiveError('Proof register is not archived_verified.')
    folder_and_files(source, proof)
    sessions, responses = source_ids(source, proof)
    pdf = source.pdf(proof['pdf_id'])
    pdf_path, docx_path, manifest_path = archive_paths(root, proof)
    if not manifest_path.is_file():
        raise ArchiveError('Local manifest is missing.')
    manifest = json.loads(manifest_path.read_text())
    if not verify_existing(manifest, proof, pdf_path, docx_path, sha256(pdf)):
        raise ArchiveError('Local PDF or DOCX no longer verifies.')
    if manifest['session_ids'] != sessions or manifest['source_response_ids'] != responses:
        raise ArchiveError('Archived source response IDs differ from the fresh connector capture.')
    receipts = [row for row in source.rows('ArchiveReceipts') if row['proof_id'] == proof['proof_id']]
    receipt = one(receipts, 'verified archive receipt')
    expected = receipt_values(proof, manifest, manifest_path)
    if any(str(receipt[key]) != str(value) for key, value in zip(SHEETS['ArchiveReceipts'], expected)):
        raise ArchiveError('Archive receipt differs from the local manifest or Drive PDF hash.')
    return {'proof_id': proof['proof_id'], 'status': 'archived_verified',
            'pdf_sha256': manifest['pdf_sha256'], 'manifest': str(manifest_path),
            'receipt_count': 1}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['auth', 'archive', 'bundle', 'verify-bundle'])
    parser.add_argument('--clasp-credentials', type=Path, default=ROOT / 'data' / '.clasprc.json')
    parser.add_argument('--credentials', type=Path, default=ROOT / 'data' / 'archive_oauth.json')
    parser.add_argument('--bundle', type=Path, default=ROOT / 'data' / 'archive_bundle.json')
    parser.add_argument('--receipt-plan', type=Path, default=ROOT / 'data' / 'archive_receipt_plan.json')
    parser.add_argument('--archive-root', type=Path, default=ROOT / 'archive')
    parser.add_argument('--case-id')
    parser.add_argument('--repair', action='store_true')
    parser.add_argument('--no-browser', action='store_true', help='Print the auth URL and wait for localhost callback')
    args = parser.parse_args(argv)
    try:
        for private_path, label in ((args.credentials, 'OAuth credentials'),
                                    (args.bundle, 'Connector bundle'), (args.receipt_plan, 'Receipt plan')):
            if not any(private_path.resolve().is_relative_to((ROOT / private).resolve())
                       for private in ('data', 'secrets')):
                raise ArchiveError(f'{label} must stay inside ignored data/ or secrets/.')
            if private_path.resolve().is_relative_to(args.archive_root.resolve()):
                raise ArchiveError(f'{label} cannot be stored in the evidence archive.')
        if args.command == 'auth':
            authorize(args.clasp_credentials, args.credentials, no_browser=args.no_browser)
            return 0
        if not args.case_id:
            parser.error('archive/bundle requires --case-id')
        case_id = safe_id(args.case_id, 'case ID')
        if args.command == 'bundle':
            result = bundle_case(args.bundle, case_id, args.archive_root, args.receipt_plan,
                                 repair=args.repair)
        elif args.command == 'verify-bundle':
            result = verify_bundle_commit(args.bundle, case_id, args.archive_root)
        else:
            source = Source(GoogleApi(args.credentials))
            result = archive_case(source, case_id, args.archive_root, repair=args.repair)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except ArchiveError as exc:
        print(f'Archive error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
