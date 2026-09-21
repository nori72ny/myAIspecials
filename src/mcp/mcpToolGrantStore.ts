import type { ToolGrant } from './mcpClient.js';
import type { McpSqlExecutor } from './mcpPostgresStore.js';

type Database = McpSqlExecutor & { connect(): Promise<McpSqlExecutor & { release(error?: Error | boolean): void }> };
type ConnectionRow = { server_id: string; version: number; status: string };
type GrantRow = { tool_name: string; fingerprint: string };

const OWNER = /^[A-Za-z0-9:_-]{1,192}$/;
const SERVER = /^[A-Za-z0-9-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const MAX_GRANTS = 200;

function validToolName(name: string): boolean {
  return Boolean(name) && Buffer.byteLength(name, 'utf8') <= 512 && !/[\x00-\x1f\x7f]/.test(name);
}
function validate(ownerId: string, serverId: string, connectionId: string, grants: readonly ToolGrant[]): void {
  if (!OWNER.test(ownerId) || !SERVER.test(serverId) || !UUID.test(connectionId) || grants.length > MAX_GRANTS) throw new Error('MCP_TOOL_GRANT_INVALID');
  const names = new Set<string>();
  for (const grant of grants) {
    if (!validToolName(grant.name) || !FINGERPRINT.test(grant.fingerprint) || names.has(grant.name)) throw new Error('MCP_TOOL_GRANT_INVALID');
    names.add(grant.name);
  }
}

export interface McpToolGrantStore {
  list(ownerId: string, connectionId: string): Promise<ToolGrant[]>;
  replace(ownerId: string, serverId: string, connectionId: string, expectedConnectionVersion: number, grants: readonly ToolGrant[]): Promise<void>;
}

/** Exact, owner-scoped grants. Replacement rechecks the connection under row lock to prevent stale approval. */
export class PostgresMcpToolGrantStore implements McpToolGrantStore {
  constructor(private readonly database: Database) {}

  async list(ownerId: string, connectionId: string): Promise<ToolGrant[]> {
    if (!OWNER.test(ownerId) || !UUID.test(connectionId)) return [];
    const result = await this.database.query<GrantRow>(
      `select tool_name, fingerprint
       from public.origin_mcp_tool_grants
       where owner_id = $1 and connection_id = $2::uuid
       order by tool_name asc
       limit ${MAX_GRANTS}`,
      [ownerId, connectionId],
    );
    return result.rows.map(row => {
      if (!validToolName(row.tool_name) || !FINGERPRINT.test(row.fingerprint)) throw new Error('MCP_TOOL_GRANT_STORE_INVALID');
      return { name: row.tool_name, fingerprint: row.fingerprint };
    });
  }

  async replace(ownerId: string, serverId: string, connectionId: string, expectedConnectionVersion: number, grants: readonly ToolGrant[]): Promise<void> {
    validate(ownerId, serverId, connectionId, grants);
    if (!Number.isSafeInteger(expectedConnectionVersion) || expectedConnectionVersion < 1) throw new Error('MCP_TOOL_GRANT_INVALID');
    let client: Awaited<ReturnType<Database['connect']>> | undefined;
    let discard = false;
    try {
      client = await this.database.connect();
      await client.query('begin isolation level read committed');
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '5s'");
      const connection = await client.query<ConnectionRow>(
        `select server_id, version, status
         from public.origin_mcp_connections
         where owner_id = $1 and connection_id = $2::uuid
         for update`,
        [ownerId, connectionId],
      );
      const current = connection.rows[0];
      if (!current || current.server_id !== serverId || current.version !== expectedConnectionVersion || current.status !== 'verified') {
        throw new Error('MCP_TOOL_GRANT_CONNECTION_CHANGED');
      }
      await client.query(
        'delete from public.origin_mcp_tool_grants where owner_id = $1 and connection_id = $2::uuid',
        [ownerId, connectionId],
      );
      if (grants.length > 0) {
        await client.query(
          `insert into public.origin_mcp_tool_grants (connection_id, owner_id, server_id, tool_name, fingerprint)
           select $1::uuid, $2, $3, x.tool_name, x.fingerprint
           from jsonb_to_recordset($4::jsonb) as x(tool_name text, fingerprint text)`,
          [connectionId, ownerId, serverId, JSON.stringify(grants.map(grant => ({ tool_name: grant.name, fingerprint: grant.fingerprint })))],
        );
      }
      await client.query('commit');
    } catch (error) {
      if (client) {
        try { await client.query('rollback'); } catch { discard = true; }
      }
      if (error instanceof Error && error.message === 'MCP_TOOL_GRANT_CONNECTION_CHANGED') throw error;
      throw new Error('MCP_TOOL_GRANT_STORE_UNAVAILABLE');
    } finally {
      client?.release(discard);
    }
  }
}
