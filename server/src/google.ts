/** Server-only Google transport adapters. No credentials or live target are bundled with the app. */
export type TokenProvider = () => Promise<string>;

async function googleJson<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error(`Google API ${response.status}`);
  return response.json() as Promise<T>;
}

export class GoogleCalendarAdapter {
  constructor(private readonly token: TokenProvider, private readonly calendarId: string) {}
  async freeBusy(start: string, end: string, calendarIds: string[]) {
    return googleJson<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>(await this.token(), 'https://www.googleapis.com/calendar/v3/freeBusy',
      { method: 'POST', body: JSON.stringify({ timeMin: start, timeMax: end, items: calendarIds.map(id => ({ id })) }) });
  }
  async readEvent(eventId: string) {
    return googleJson<{ id: string; start: { dateTime: string }; end: { dateTime: string }; attendees?: { email: string; responseStatus: string }[] }>(
      await this.token(), `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(eventId)}`);
  }
  async insertEvent(event: Record<string, unknown>) {
    return googleJson<{ id: string }>(await this.token(), `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`,
      { method: 'POST', body: JSON.stringify(event) });
  }
}

export class GoogleSheetsAdapter {
  constructor(private readonly token: TokenProvider, private readonly spreadsheetId: string) {}
  private url(range: string) { return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(range)}`; }
  async readRows(range: string) { return googleJson<{ values?: string[][] }>(await this.token(), this.url(range)); }
  async appendRows(range: string, rows: string[][]) {
    return googleJson<{ updates?: { updatedRows: number } }>(await this.token(), `${this.url(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: rows }) });
  }
  async updateRows(range: string, rows: string[][]) {
    return googleJson<{ updatedRows: number }>(await this.token(), `${this.url(range)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: rows }) });
  }
}
