import type { McpSqlExecutor } from './mcpPostgresStore.js';
import type { McpOAuthPending, McpOAuthPendingStore } from './mcpOAuthAuthorization.js';

type Database = McpSqlExecutor & { connect(): Promise<McpSqlExecutor & { release(error?: Error | boolean): void }> };
function validate(record: Omit<McpOAuthPending, 'verifierCiphertext'>): void {
  if (!/^[A-Za-z0-9:_-]{1,192}$/.test(record.ownerId) || !/^[A-Za-z0-9-]{1,64}$/.test(record.serverId)
    || [record.stateHash, record.sessionHash, record.configHash].some(value => !/^[a-f0-9]{64}$/.test(value))) throw new Error('MCP_OAUTH_RECORD_INVALID');
}
const columns = `owner_id AS "ownerId", server_id AS "serverId", state_hash AS "stateHash", session_hash AS "sessionHash",
  config_hash AS "configHash", verifier_ciphertext AS "verifierCiphertext"`;

/** Five-minute, single-use PKCE transactions in shared storage. No raw state/session/verifier. */
export class PostgresMcpOAuthPendingStore implements McpOAuthPendingStore {
  constructor(private readonly database: Database) {}
  /** Bounded maintenance hook; production scheduling is a separate activation prerequisite. */
  async deleteExpired(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('MCP_OAUTH_RECORD_INVALID');
    try {
      const result = await this.database.query(`delete from public.origin_mcp_oauth_pending where state_hash in (
        select state_hash from public.origin_mcp_oauth_pending where expires_at <= clock_timestamp()
        order by expires_at limit $1 for update skip locked)`, [limit]);
      return result.rowCount ?? 0;
    } catch { throw new Error('MCP_OAUTH_STORE_UNAVAILABLE'); }
  }
  async put(record: McpOAuthPending): Promise<void> {
    validate(record);
    if (!/^v1\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\.[A-Za-z0-9+/]+={0,2}$/.test(record.verifierCiphertext)
      || record.verifierCiphertext.length > 512) throw new Error('MCP_OAUTH_RECORD_INVALID');
    const client = await this.database.connect(); let discard = false;
    try {
      await client.query('begin isolation level read committed');
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '5s'");
      await client.query("select pg_advisory_xact_lock(hashtextextended('origin_mcp_oauth:' || $1, 0))", [record.ownerId]);
      await client.query('delete from public.origin_mcp_oauth_pending where owner_id = $1 and expires_at <= clock_timestamp()', [record.ownerId]);
      const result = await client.query(`insert into public.origin_mcp_oauth_pending
        (owner_id, server_id, state_hash, session_hash, config_hash, verifier_ciphertext, expires_at)
        select $1, $2, $3, $4, $5, $6, clock_timestamp() + interval '5 minutes'
        where (select count(*) from public.origin_mcp_oauth_pending where owner_id = $1) < 20
          or exists (select 1 from public.origin_mcp_oauth_pending where owner_id = $1 and server_id = $2)
        on conflict (owner_id, server_id) do update set state_hash = excluded.state_hash,
          session_hash = excluded.session_hash, config_hash = excluded.config_hash,
          verifier_ciphertext = excluded.verifier_ciphertext, expires_at = excluded.expires_at
        returning state_hash`, [record.ownerId, record.serverId, record.stateHash, record.sessionHash, record.configHash, record.verifierCiphertext]);
      if (result.rowCount !== 1) throw new Error();
      await client.query('commit');
    } catch {
      try { await client.query('rollback'); } catch { discard = true; }
      throw new Error('MCP_OAUTH_STORE_UNAVAILABLE');
    } finally { client.release(discard); }
  }
  async consume(binding: Omit<McpOAuthPending, 'verifierCiphertext'>): Promise<McpOAuthPending | undefined> {
    validate(binding);
    try {
      const result = await this.database.query<McpOAuthPending & Record<string, unknown>>(`delete from public.origin_mcp_oauth_pending
        where owner_id = $1 and server_id = $2 and state_hash = $3 and session_hash = $4 and config_hash = $5
          and expires_at > clock_timestamp() returning ${columns}`,
      [binding.ownerId, binding.serverId, binding.stateHash, binding.sessionHash, binding.configHash]);
      return result.rows[0];
    } catch { throw new Error('MCP_OAUTH_STORE_UNAVAILABLE'); }
  }
}
