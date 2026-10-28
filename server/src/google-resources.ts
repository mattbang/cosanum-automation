import type { QueryResultRow } from 'pg';
import type { SqlExecutor } from './database.ts';
import type { CalendarResourceMapping, SheetsResourceMapping } from './google.ts';

type MappingRow = QueryResultRow & { provider: 'calendar' | 'sheets'; resource_id: string; range_name: string | null; enabled: boolean };

/** Resolves stable logical names to explicitly enabled, environment-scoped resource IDs. */
export class GoogleResourceMappings {
  constructor(private readonly db: SqlExecutor, private readonly environment: string) {
    if (!environment.trim()) throw new Error('Google resource mapping environment is required');
  }

  private async get(provider: MappingRow['provider'], logicalKey: string): Promise<MappingRow> {
    const result = await this.db.query<MappingRow>(
      `SELECT provider, resource_id, range_name, enabled FROM google_resource_mappings
        WHERE provider = $1 AND environment = $2 AND logical_key = $3`,
      [provider, this.environment, logicalKey],
    );
    const mapping = result.rows[0];
    if (!mapping?.enabled || !mapping.resource_id) throw new Error(`No enabled ${provider} resource mapping for ${logicalKey}`);
    return mapping;
  }

  async calendar(logicalKey: string): Promise<CalendarResourceMapping> {
    const mapping = await this.get('calendar', logicalKey);
    return { resourceId: mapping.resource_id };
  }

  async sheets(logicalKey: string): Promise<SheetsResourceMapping> {
    const mapping = await this.get('sheets', logicalKey);
    if (!mapping.range_name) throw new Error(`Sheets mapping ${logicalKey} has no range`);
    return { resourceId: mapping.resource_id, rangeName: mapping.range_name };
  }
}
