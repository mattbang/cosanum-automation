/** Server-only Google transport adapters. No credentials or live target are bundled with the app. */
export type TokenProvider = () => Promise<string>;
export type GoogleTransport = (input: string, init?: RequestInit) => Promise<Response>;
export type CalendarResourceMapping = { resourceId: string; availabilityResourceIds?: string[] };
export type SheetsResourceMapping = { resourceId: string; rangeName: string };

async function googleJson<T>(transport: GoogleTransport, token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await transport(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error(`Google API ${response.status}`);
  return response.json() as Promise<T>;
}

export class GoogleCalendarAdapter {
  constructor(private readonly token: TokenProvider, private readonly mapping: CalendarResourceMapping, private readonly transport: GoogleTransport = fetch) {}
  async freeBusy(start: string, end: string) {
    const calendarIds = this.mapping.availabilityResourceIds ?? [this.mapping.resourceId];
    return googleJson<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>(this.transport, await this.token(), 'https://www.googleapis.com/calendar/v3/freeBusy',
      { method: 'POST', body: JSON.stringify({ timeMin: start, timeMax: end, items: calendarIds.map(id => ({ id })) }) });
  }
  async readEvent(eventId: string) {
    return googleJson<{ id: string; start: { dateTime: string }; end: { dateTime: string }; attendees?: { email: string; responseStatus: string }[] }>(this.transport,
      await this.token(), `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.mapping.resourceId)}/events/${encodeURIComponent(eventId)}`);
  }
  async insertEvent(event: Record<string, unknown>) {
    return googleJson<{ id: string }>(this.transport, await this.token(), `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.mapping.resourceId)}/events`,
      { method: 'POST', body: JSON.stringify(event) });
  }
}

export class GoogleSheetsAdapter {
  constructor(private readonly token: TokenProvider, private readonly mapping: SheetsResourceMapping, private readonly transport: GoogleTransport = fetch) {}
  private url() { return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.mapping.resourceId)}/values/${encodeURIComponent(this.mapping.rangeName)}`; }
  async readRows() { return googleJson<{ values?: string[][] }>(this.transport, await this.token(), this.url()); }
  async updateRows(rows: string[][]) {
    return googleJson<{ updatedRows: number }>(this.transport, await this.token(), `${this.url()}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: rows }) });
  }
}
