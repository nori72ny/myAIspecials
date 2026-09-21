import type { McpSqlExecutor } from './mcpPostgresStore.js';
import { oauthFailure, validateOAuthOwner, type McpOAuthGrant, type McpOAuthGrantStore } from './mcpOAuthTokens.js';

type Database = McpSqlExecutor & { connect(): Promise<McpSqlExecutor & { release(error?: Error | boolean): void }> };
const columns = `owner_id AS "ownerId", server_id AS "serverId", grant_id AS "grantId",
  config_hash AS "configHash", version, status, token_ciphertext AS ciphertext`;
const transitions: Record<McpOAuthGrant['status'], readonly McpOAuthGrant['status'][]> = {
  authorizing: ['exchanging', 'reauthorization_required'], exchanging: ['active', 'reauthorization_required'],
  active: ['active', 'refreshing', 'reauthorization_required'], refreshing: ['active', 'reauthorization_required'],
  revoked: [], reauthorization_required: [],
};
function validate(record: McpOAuthGrant): void {
  validateOAuthOwner(record.ownerId, record.serverId);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(record.grantId)
    || !/^[a-f0-9]{64}$/.test(record.configHash) || !Number.isInteger(record.version) || record.version < 1 || record.version > 2147483647
    || !Object.hasOwn(transitions, record.status)) oauthFailure('MCP_OAUTH_RECORD_INVALID');
  if (record.status === 'active' || record.status === 'refreshing') {
    if (typeof record.ciphertext !== 'string' || record.ciphertext.length > 32768
      || !/^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(record.ciphertext)) oauthFailure('MCP_OAUTH_RECORD_INVALID');
  } else if (record.ciphertext !== null) oauthFailure('MCP_OAUTH_RECORD_INVALID');
}

/** Durable claim-before-network state machine. No transaction is held across remote calls. */
export class PostgresMcpOAuthGrantStore implements McpOAuthGrantStore {
  constructor(private readonly database: Database) {}
  private async transaction<T>(operation: (client: McpSqlExecutor) => Promise<T>): Promise<T> {
    let client: Awaited<ReturnType<Database['connect']>> | undefined; let discard = false;
    try {
      client = await this.database.connect();
      await client.query('begin isolation level read committed');
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '5s'");
      await client.query("set local idle_in_transaction_session_timeout = '10s'");
      const result = await operation(client);
      await client.query('commit'); return result;
    } catch {
      if (client) { try { await client.query('rollback'); } catch { discard = true; } }
      return oauthFailure('MCP_OAUTH_STORE_UNAVAILABLE');
    } finally { client?.release(discard); }
  }
  async begin(record: McpOAuthGrant): Promise<void> {
    validate(record);
    if (record.version !== 1 || record.status !== 'authorizing') oauthFailure('MCP_OAUTH_RECORD_INVALID');
    await this.transaction(async client => {
      await client.query("select pg_advisory_xact_lock(hashtextextended('origin_mcp_grants:' || $1, 0))", [record.ownerId]);
      const result = await client.query(`insert into public.origin_mcp_oauth_grants (owner_id, server_id, grant_id, config_hash, version, status)
        select $1, $2, $3::uuid, $4, 1, 'authorizing'
        where (select count(*) from public.origin_mcp_oauth_grants where owner_id = $1) < 20
          or exists (select 1 from public.origin_mcp_oauth_grants where owner_id = $1 and server_id = $2)
        on conflict (owner_id, server_id) do update set grant_id = excluded.grant_id, config_hash = excluded.config_hash,
          version = 1, status = 'authorizing', token_ciphertext = null
        where origin_mcp_oauth_grants.status in ('authorizing', 'revoked', 'reauthorization_required')
          and origin_mcp_oauth_grants.grant_id <> excluded.grant_id
        returning grant_id`, [record.ownerId, record.serverId, record.grantId, record.configHash]);
      if (result.rowCount !== 1) throw new Error();
    });
  }
  async get(ownerId: string, serverId: string): Promise<McpOAuthGrant | undefined> {
    validateOAuthOwner(ownerId, serverId);
    return this.transaction(async client => {
      const result = await client.query<McpOAuthGrant & Record<string, unknown>>(`select ${columns} from public.origin_mcp_oauth_grants where owner_id = $1 and server_id = $2`, [ownerId, serverId]);
      const record = result.rows[0]; if (record) validate(record); return record;
    });
  }
  async replace(next: McpOAuthGrant, previous: McpOAuthGrant): Promise<boolean> {
    validate(next); validate(previous);
    if (next.ownerId !== previous.ownerId || next.serverId !== previous.serverId || next.grantId !== previous.grantId || next.configHash !== previous.configHash
      || next.version !== previous.version + 1 || !transitions[previous.status].includes(next.status)) return false;
    return this.transaction(async client => {
      const result = await client.query(`update public.origin_mcp_oauth_grants set version = $6, status = $7, token_ciphertext = $8
        where owner_id = $1 and server_id = $2 and grant_id = $3::uuid and config_hash = $4 and version = $5 and status = $9 returning grant_id`,
      [next.ownerId, next.serverId, next.grantId, next.configHash, previous.version, next.version, next.status, next.ciphertext, previous.status]);
      return result.rowCount === 1;
    });
  }
  async revoke(ownerId: string, serverId: string): Promise<McpOAuthGrant | undefined> {
    validateOAuthOwner(ownerId, serverId);
    return this.transaction(async client => {
      const result = await client.query<McpOAuthGrant & Record<string, unknown>>(`select ${columns} from public.origin_mcp_oauth_grants where owner_id = $1 and server_id = $2 for update`, [ownerId, serverId]);
      const previous = result.rows[0]; if (previous) validate(previous);
      await client.query("update public.origin_mcp_oauth_grants set status = 'revoked', token_ciphertext = null, version = version + 1 where owner_id = $1 and server_id = $2", [ownerId, serverId]);
      await client.query('delete from public.origin_mcp_oauth_pending where owner_id = $1 and server_id = $2', [ownerId, serverId]);
      return previous;
    });
  }
}
