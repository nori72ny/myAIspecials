import type { McpSqlExecutor } from './mcpPostgresStore.js';
import type {
  McpGithubAppRegistration,
  McpGithubAppRegistrationStore,
  McpGithubManifestPending,
  McpGithubManifestPendingStore,
} from './mcpGithubAppBootstrap.js';

type Database = McpSqlExecutor & {
  connect(): Promise<McpSqlExecutor & { release(error?: Error | boolean): void }>;
};

const OWNER = /^[A-Za-z0-9:_-]{1,192}$/;
const HASH = /^[a-f0-9]{64}$/;
const SLUG = /^[A-Za-z0-9-]{1,100}$/;
const CLIENT_ID = /^[A-Za-z0-9._-]{1,256}$/;
const CIPHERTEXT = /^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;

function validPending(record: McpGithubManifestPending) {
  return OWNER.test(record.ownerId)
    && HASH.test(record.stateHash)
    && HASH.test(record.sessionHash)
    && HASH.test(record.manifestHash);
}

function validRegistration(record: McpGithubAppRegistration) {
  return OWNER.test(record.ownerId)
    && Number.isSafeInteger(record.appId)
    && record.appId > 0
    && SLUG.test(record.appSlug)
    && CLIENT_ID.test(record.clientId)
    && CIPHERTEXT.test(record.clientSecretCiphertext)
    && HASH.test(record.registrationFingerprint)
    && Number.isSafeInteger(record.version)
    && record.version >= 1
    && (record.status === 'registered' || record.status === 'revoked');
}

export class PostgresMcpGithubManifestPendingStore implements McpGithubManifestPendingStore {
  constructor(private readonly database: Database) {}

  async put(record: McpGithubManifestPending): Promise<void> {
    if (!validPending(record)) throw new Error('MCP_GITHUB_STORE_RECORD_INVALID');
    const client = await this.database.connect();
    let discard = false;
    try {
      await client.query('begin isolation level read committed');
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '5s'");
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended('origin_mcp_github_manifest:' || $1, 0))",
        [record.ownerId],
      );
      await client.query(
        `delete from public.origin_mcp_github_manifest_pending
         where owner_id = $1 and expires_at <= clock_timestamp()`,
        [record.ownerId],
      );
      const result = await client.query(
        `insert into public.origin_mcp_github_manifest_pending
           (owner_id, state_hash, session_hash, manifest_hash, expires_at)
         values ($1, $2, $3, $4, clock_timestamp() + interval '10 minutes')
         on conflict (owner_id) do update
           set state_hash = excluded.state_hash,
               session_hash = excluded.session_hash,
               manifest_hash = excluded.manifest_hash,
               expires_at = excluded.expires_at,
               created_at = clock_timestamp()
         returning owner_id`,
        [record.ownerId, record.stateHash, record.sessionHash, record.manifestHash],
      );
      if (result.rowCount !== 1) throw new Error();
      await client.query('commit');
    } catch {
      try { await client.query('rollback'); } catch { discard = true; }
      throw new Error('MCP_GITHUB_STORE_UNAVAILABLE');
    } finally {
      client.release(discard);
    }
  }

  async consume(record: McpGithubManifestPending): Promise<boolean> {
    if (!validPending(record)) return false;
    try {
      const result = await this.database.query(
        `delete from public.origin_mcp_github_manifest_pending
         where owner_id = $1
           and state_hash = $2
           and session_hash = $3
           and manifest_hash = $4
           and expires_at > clock_timestamp()
         returning owner_id`,
        [record.ownerId, record.stateHash, record.sessionHash, record.manifestHash],
      );
      return result.rowCount === 1;
    } catch {
      throw new Error('MCP_GITHUB_STORE_UNAVAILABLE');
    }
  }
}

type RegistrationRow = {
  owner_id: string;
  app_id: string | number;
  app_slug: string;
  client_id: string;
  client_secret_ciphertext: string;
  registration_fingerprint: string;
  version: number;
  status: string;
};

function fromRegistrationRow(row: RegistrationRow): McpGithubAppRegistration {
  const record: McpGithubAppRegistration = {
    ownerId: row.owner_id,
    appId: Number(row.app_id),
    appSlug: row.app_slug,
    clientId: row.client_id,
    clientSecretCiphertext: row.client_secret_ciphertext,
    registrationFingerprint: row.registration_fingerprint,
    version: row.version,
    status: row.status as McpGithubAppRegistration['status'],
  };
  if (!validRegistration(record)) throw new Error('MCP_GITHUB_STORE_RECORD_INVALID');
  return record;
}

const REG_COLUMNS = `owner_id, app_id, app_slug, client_id, client_secret_ciphertext,
  registration_fingerprint, version, status`;

export class PostgresMcpGithubAppRegistrationStore implements McpGithubAppRegistrationStore {
  constructor(private readonly database: Database) {}

  async get(ownerId: string): Promise<McpGithubAppRegistration | undefined> {
    if (!OWNER.test(ownerId)) return undefined;
    try {
      const result = await this.database.query<RegistrationRow>(
        `select ${REG_COLUMNS}
         from public.origin_mcp_github_app_registrations
         where owner_id = $1
         limit 1`,
        [ownerId],
      );
      return result.rows[0] ? fromRegistrationRow(result.rows[0]) : undefined;
    } catch {
      throw new Error('MCP_GITHUB_STORE_UNAVAILABLE');
    }
  }

  async insert(record: McpGithubAppRegistration): Promise<boolean> {
    if (!validRegistration(record) || record.version !== 1 || record.status !== 'registered') {
      throw new Error('MCP_GITHUB_STORE_RECORD_INVALID');
    }
    try {
      const result = await this.database.query(
        `insert into public.origin_mcp_github_app_registrations
           (owner_id, app_id, app_slug, client_id, client_secret_ciphertext,
            registration_fingerprint, version, status)
         values ($1, $2, $3, $4, $5, $6, 1, 'registered')
         on conflict (owner_id) do nothing
         returning owner_id`,
        [
          record.ownerId,
          record.appId,
          record.appSlug,
          record.clientId,
          record.clientSecretCiphertext,
          record.registrationFingerprint,
        ],
      );
      return result.rowCount === 1;
    } catch {
      throw new Error('MCP_GITHUB_STORE_UNAVAILABLE');
    }
  }
}
