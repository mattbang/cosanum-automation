import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleCalendarAdapter, GoogleSheetsAdapter, type GoogleTransport } from '../src/google.ts';
import { GoogleResourceMappings } from '../src/google-resources.ts';

test('Calendar adapter uses its explicit resource mapping and injected mock transport', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport: GoogleTransport = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: 'EV-1', start: { dateTime: '2026-11-02T09:00:00Z' }, end: { dateTime: '2026-11-02T10:00:00Z' } }));
  };
  const calendar = new GoogleCalendarAdapter(async () => 'synthetic-token', { resourceId: 'calendar/test' }, transport);
  const event = await calendar.readEvent('event / 1');
  assert.equal(event.id, 'EV-1');
  assert.equal(calls[0]!.url, 'https://www.googleapis.com/calendar/v3/calendars/calendar%2Ftest/events/event%20%2F%201');
  assert.equal(new Headers(calls[0]!.init?.headers).get('Authorization'), 'Bearer synthetic-token');
});

test('Calendar availability cannot accept resource IDs from a request payload', async () => {
  let body = '';
  const transport: GoogleTransport = async (_url, init) => {
    body = String(init?.body);
    return new Response(JSON.stringify({ calendars: { 'assigned-calendar': { busy: [] } } }));
  };
  const calendar = new GoogleCalendarAdapter(async () => 'synthetic-token', {
    resourceId: 'assigned-calendar', availabilityResourceIds: ['assigned-calendar', 'assigned-participant-calendar'],
  }, transport);
  await calendar.freeBusy('2026-11-02T09:00:00Z', '2026-11-02T10:00:00Z');
  assert.deepEqual(JSON.parse(body).items, [{ id: 'assigned-calendar' }, { id: 'assigned-participant-calendar' }]);
});

test('Sheets adapter pins a mapped range and makes deterministic updates through the mock transport', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport: GoogleTransport = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ updatedRows: 2 }));
  };
  const sheets = new GoogleSheetsAdapter(async () => 'synthetic-token', { resourceId: 'sheet/1', rangeName: 'Cases!A2:C3' }, transport);
  const result = await sheets.updateRows([['C1', 'open', '1'], ['C2', 'open', '1']]);
  assert.equal(result.updatedRows, 2);
  assert.match(calls[0]!.url, /spreadsheets\/sheet%2F1\/values\/Cases!A2%3AC3\?valueInputOption=RAW$/);
  assert.equal(calls[0]!.init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { values: [['C1', 'open', '1'], ['C2', 'open', '1']] });
});

test('resource mappings reject absent and disabled resources', async () => {
  const db = {
    async query(_sql: string, values: unknown[] = []) {
      const key = values[2];
      const rows = key === 'enabled' ? [{ provider: 'calendar', resource_id: 'cal-1', range_name: null, enabled: true }] : [];
      return { rows, rowCount: rows.length };
    },
  } as never;
  const mappings = new GoogleResourceMappings(db, 'synthetic');
  assert.deepEqual(await mappings.calendar('enabled'), { resourceId: 'cal-1' });
  await assert.rejects(mappings.calendar('missing'), /No enabled calendar resource mapping/);
});
