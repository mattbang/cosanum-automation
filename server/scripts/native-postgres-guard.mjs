const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const CONNECTION_OVERRIDES = new Set(['host', 'hostaddr', 'options', 'search_path']);
const SCHEMA_NAME = /^cosanum_native_[a-z0-9_]{1,48}$/;

export function resolveNativePostgresTarget(connectionString, schemaName) {
  if (typeof connectionString !== 'string' || !connectionString.trim())
    throw new Error('Set TEST_DATABASE_URL to an empty disposable loopback PostgreSQL database');
  let url;
  try { url = new URL(connectionString); }
  catch { throw new Error('TEST_DATABASE_URL must be a PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('TEST_DATABASE_URL must use postgres:// or postgresql://');
  if (!LOOPBACK_HOSTS.has(url.hostname)) throw new Error('Native integration checks only accept a loopback PostgreSQL host');
  for (const key of url.searchParams.keys()) {
    if (CONNECTION_OVERRIDES.has(key.toLowerCase()))
      throw new Error(`TEST_DATABASE_URL must not override ${key}; the script pins its own loopback host and search_path`);
  }
  if (typeof schemaName !== 'string' || !SCHEMA_NAME.test(schemaName))
    throw new Error('Set TEST_DATABASE_SCHEMA to a dedicated empty schema named cosanum_native_<suffix>');
  return { host: url.hostname.replace(/^\[|\]$/g, ''), schemaName, options: `-c search_path=${schemaName}` };
}

/** Confirms that unqualified migrations can see only the requested empty schema. */
export async function assertEmptyNativeSchema(pool, schemaName) {
  const path = await pool.query(
    `SELECT current_schema() AS current_schema, current_schemas(false) AS schemas,
            current_setting('search_path') AS search_path`,
  );
  const target = path.rows[0];
  if (!target || target.current_schema !== schemaName || target.search_path !== schemaName ||
      target.schemas.length !== 1 || target.schemas[0] !== schemaName)
    throw new Error(`Connection search_path must resolve only to ${schemaName}`);

  const objects = await pool.query(
    `SELECT n.oid,
       (SELECT count(*) FROM pg_class WHERE relnamespace = n.oid) +
       (SELECT count(*) FROM pg_proc WHERE pronamespace = n.oid) +
       (SELECT count(*) FROM pg_type WHERE typnamespace = n.oid) +
       (SELECT count(*) FROM pg_operator WHERE oprnamespace = n.oid) +
       (SELECT count(*) FROM pg_opclass WHERE opcnamespace = n.oid) +
       (SELECT count(*) FROM pg_opfamily WHERE opfnamespace = n.oid) +
       (SELECT count(*) FROM pg_collation WHERE collnamespace = n.oid) +
       (SELECT count(*) FROM pg_conversion WHERE connamespace = n.oid) +
       (SELECT count(*) FROM pg_ts_dict WHERE dictnamespace = n.oid) +
       (SELECT count(*) FROM pg_ts_config WHERE cfgnamespace = n.oid) +
       (SELECT count(*) FROM pg_extension WHERE extnamespace = n.oid) AS object_count
       FROM pg_namespace n WHERE n.nspname = $1`, [schemaName],
  );
  if (!objects.rowCount) throw new Error(`Dedicated schema ${schemaName} does not exist`);
  if (Number(objects.rows[0].object_count) !== 0) throw new Error(`Dedicated schema ${schemaName} is not empty`);
}
