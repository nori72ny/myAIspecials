import { Pool, type QueryResult } from 'pg';
import type { McpConnectionRecord, McpConnectionStore } from './mcpConnections.js';

type SqlRow = Record<string, unknown>;
export interface McpSqlExecutor {
  query<T extends SqlRow = SqlRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

type ConnectionRow = {
  connection_id: string;
  owner_id: string;
  server_id: string;
  endpoint: string;
  credential_ciphertext: string;
  version: number;
  status: string;
  checked_at: Date | string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER = /^[A-Za-z0-9:_-]{1,192}$/;
const SERVER = /^[A-Za-z0-9-]{1,64}$/;
const CREDENTIAL = /^v1\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\.[A-Za-z0-9+/]+={0,2}$/;
const STATUSES = new Set<McpConnectionRecord['status']>(['registered', 'verified', 'failed']);

function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port && value.length <= 2048;
  } catch { return false; }
}

function validateRecord(record: McpConnectionRecord): void {
  if (!UUID.test(record.id) || !OWNER.test(record.ownerId) || !SERVER.test(record.serverId) || !validEndpoint(record.endpoint)
    || !CREDENTIAL.test(record.credential) || Buffer.byteLength(record.credential) > 12_000
    || !Number.isSafeInteger(record.version) || record.version < 1 || !STATUSES.has(record.status)
    || (record.checkedAt !== null && !Number.isFinite(Date.parse(record.checkedAt)))) throw new Error('MCP_STORE_RECORD_INVALID');
}

function fromRow(row: ConnectionRow): McpConnectionRecord {
  const checkedAt = row.checked_at === null ? null : new Date(row.checked_at).toISOString();
  const record: McpConnectionRecord = {
    id: row.connection_id,
    ownerId: row.owner_id,
    serverId: row.server_id,
    endpoint: row.endpoint,
    credential: row.credential_ciphertext,
    version: row.version,
    status: row.status as McpConnectionRecord['status'],
    checkedAt,
  };
  validateRecord(record);
  return record;
}

const COLUMNS = `connection_id, owner_id, server_id, endpoint, credential_ciphertext,
                  version, status, checked_at`;

/** Shared durable store. Every read and mutation includes the authenticated owner. */
export class PostgresMcpConnectionStore implements McpConnectionStore {
  constructor(private readonly database: McpSqlExecutor & { connect(): Promise<McpSqlExecutor & { release(error?: Error | boolean): void }> }) {}

  async list(ownerId: string): Promise<McpConnectionRecord[]> {
    if (!OWNER.test(ownerId)) throw new Error('MCP_STORE_OWNER_INVALID');
    const result = await this.database.query<ConnectionRow>(
      `select ${COLUMNS}
       from public.origin_mcp_connections
       where owner_id = $1
       order by created_at asc, connection_id asc
       limit 20`,
      [ownerId],
    );
    return result.rows.map(fromRow);
  }

  async get(ownerId: string, id: string): Promise<McpConnectionRecord | undefined> {
    if (!OWNER.test(ownerId) || !UUID.test(id)) return undefined;
    const result = await this.database.query<ConnectionRow>(
      `select ${COLUMNS}
       from public.origin_mcp_connections
       where owner_id = $1 and connection_id = $2
       limit 1`,
      [ownerId, id],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async insert(record: McpConnectionRecord, ownerLimit: number): Promise<boolean> {
    validateRecord(record);
    if (!Number.isSafeInteger(ownerLimit) || ownerLimit < 1 || ownerLimit > 20) throw new Error('MCP_STORE_LIMIT_INVALID');
    const client = await this.database.connect();
    let discard = false;
    try {
      await client.query('begin isolation level read committed');
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '5s'");
      // A separate statement is essential: READ COMMITTED takes a fresh snapshot
      // after the preceding lock wait, including the prior owner's insertion.
      await client.query("select pg_advisory_xact_lock(hashtextextended('origin_mcp:' || $1, 0))", [record.ownerId]);
      const result = await client.query<{ connection_id: string }>(
        `insert into public.origin_mcp_connections
           (connection_id, owner_id, server_id, endpoint, credential_ciphertext, version, status, checked_at)
         select $1::uuid, $2, $3, $4, $5, $6, $7, $8::timestamptz
         where (select count(*) from public.origin_mcp_connections where owner_id = $2) < $9
         on conflict do nothing
         returning connection_id::text`,
        [record.id, record.ownerId, record.serverId, record.endpoint, record.credential, record.version, record.status, record.checkedAt, ownerLimit],
      );
      await client.query('commit');
      return result.rowCount === 1;
    } catch {
      try { await client.query('rollback'); } catch { discard = true; }
      throw new Error('MCP_STORE_UNAVAILABLE');
    } finally { client.release(discard); }
  }

  async replace(record: McpConnectionRecord, expectedVersion: number): Promise<boolean> {
    validateRecord(record);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || record.version !== expectedVersion + 1) return false;
    const result = await this.database.query<{ connection_id: string }>(
      `update public.origin_mcp_connections
       set credential_ciphertext = $4,
           version = $5,
           status = $6,
           checked_at = $7::timestamptz,
           updated_at = clock_timestamp()
       where owner_id = $1
         and connection_id = $2::uuid
         and server_id = $3
         and endpoint = $8
         and version = $9
       returning connection_id::text`,
      [record.ownerId, record.id, record.serverId, record.credential, record.version, record.status, record.checkedAt, record.endpoint, expectedVersion],
    );
    return result.rowCount === 1;
  }

  async remove(ownerId: string, id: string, expectedVersion: number): Promise<boolean> {
    if (!OWNER.test(ownerId) || !UUID.test(id) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return false;
    const result = await this.database.query<{ connection_id: string }>(
      `delete from public.origin_mcp_connections
       where owner_id = $1 and connection_id = $2::uuid and version = $3
       returning connection_id::text`,
      [ownerId, id, expectedVersion],
    );
    return result.rowCount === 1;
  }
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  for (const name of ['POSTGRES_URL', 'DATABASE_URL', 'SUPABASE_DB_URL'] as const) {
    const value = env[name]?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if ((url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname) return value;
    } catch { /* Try the next server-only reference. */ }
  }
  return undefined;
}

export function createPostgresMcpConnectionStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PostgresMcpConnectionStore | undefined {
  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) return undefined;
  const pool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000, allowExitOnIdle: true });
  return new PostgresMcpConnectionStore(pool);
}
