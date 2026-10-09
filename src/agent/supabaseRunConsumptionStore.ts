import { Pool, type PoolClient, type QueryResult } from 'pg';
import { randomUUID } from 'node:crypto';
import type { AgentRunConsumptionStore } from './agentOrchestratorV3.js';

const RUN_ID_PATTERN = /^run-[A-Za-z0-9-]{8,100}$/;
const MAX_TTL_MS = 15 * 60 * 1000;

export interface AgentReplaySqlExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
  connect?(): Promise<Pick<PoolClient, 'query' | 'release'>>;
}

export class PostgresAgentRunConsumptionStore implements AgentRunConsumptionStore {
  constructor(private readonly database: AgentReplaySqlExecutor) {}

  async consume(runId: string, expiresAt: number): Promise<boolean> {
    const now = Date.now();
    if (!RUN_ID_PATTERN.test(runId)) throw new Error('INVALID_AGENT_RUN_ID');
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + MAX_TTL_MS) {
      throw new Error('INVALID_AGENT_RUN_EXPIRY');
    }

    const result = await this.database.query<{ run_id: string }>(
      `with cleanup as (
         delete from public.origin_agent_consumed_runs
         where expires_at < clock_timestamp()
       )
       insert into public.origin_agent_consumed_runs (run_id, expires_at)
       values ($1, to_timestamp($2 / 1000.0))
       on conflict (run_id) do nothing
       returning run_id`,
      [runId, expiresAt],
    );

    return result.rowCount === 1;
  }
  /**
   * One minute's requests are counted in the existing server-only replay ledger.
   * A transaction-scoped advisory lock serializes all contenders for the same
   * pseudonymous caller across serverless instances and PostgreSQL connections.
   * No new schema, API policy, client data, or per-instance counter is trusted.
   * Missing DB permission/connection/timeout MUST reject the request.
   */
  async claimAgentRateSlot(identityHash: string): Promise<boolean> {
    if (!/^[0-9a-f]{32}$/.test(identityHash)) throw new Error('AGENT_RATE_IDENTITY_INVALID');
    if (typeof this.database.connect !== 'function') throw new Error('AGENT_RATE_SHARED_STORE_UNAVAILABLE');
    const client = await this.database.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query("SET LOCAL statement_timeout = '2500ms'");
      // Use an exclusive per-identity transaction lock, not a SELECT/INSERT
      // count race; lock before taking a fresh READ COMMITTED snapshot.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', ['origin-agent-post-v3:' + identityHash]);
      // Authentication failures alone do not call consume(), the legacy replay
      // cleanup path. Prune at most 64 expired rows per request so repeated
      // attempts from rotating addresses cannot grow the shared ledger forever.
      // This uses the existing expires_at index, skips any live row locks, and
      // never touches an unexpired replay or quota reservation.
      await client.query(`WITH expired AS (
        SELECT ctid FROM public.origin_agent_consumed_runs
        WHERE expires_at < clock_timestamp()
        ORDER BY expires_at
        LIMIT 64 FOR UPDATE SKIP LOCKED
      )
      DELETE FROM public.origin_agent_consumed_runs AS ledger
      USING expired WHERE ledger.ctid = expired.ctid`);
      const time = await client.query<{ minute: string }>(
        'SELECT floor(extract(epoch from clock_timestamp()) / 60)::bigint AS minute',
      );
      const minute = Number(time.rows[0]?.minute);
      if (!Number.isSafeInteger(minute) || minute < 0) throw new Error('AGENT_RATE_DATABASE_CLOCK_INVALID');
      const prefix = `run-ratelimit-${identityHash}-${minute.toString(36)}-`;
      // PostgreSQL collations do not order '~' after alphanumeric text on
      // every cluster. The prefix is server-generated [a-z0-9-] only;
      // a parameterized LIKE expression is exact and locale-independent.
      const count = await client.query<{ total: number }>(
        "SELECT count(*)::integer AS total FROM public.origin_agent_consumed_runs WHERE run_id LIKE ($1 || '%')",
        [prefix],
      );
      const total = Number(count.rows[0]?.total);
      if (!Number.isInteger(total) || total < 0) throw new Error('AGENT_RATE_DATABASE_COUNT_INVALID');
      if (total >= 60) {
        await client.query('ROLLBACK');
        return false;
      }
      const slot = `${prefix}${randomUUID().replace(/-/g, '')}`;
      // Keep last-minute evidence briefly for crash recovery, then the
      // existing consumption-store cleanup reclaims expired replay rows.
      const expiresAt = (minute + 2) * 60_000;
      await client.query(
        'INSERT INTO public.origin_agent_consumed_runs (run_id, expires_at) VALUES ($1, to_timestamp($2 / 1000.0))',
        [slot, expiresAt],
      );
      await client.query('COMMIT');
      return true;
    } catch {
      if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
      throw new Error('AGENT_RATE_SHARED_STORE_UNAVAILABLE');
    } finally {
      client.release();
    }
  }
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  return value;
}

export function createAgentRunConsumptionStoreFromEnv(env: NodeJS.ProcessEnv = process.env): AgentRunConsumptionStore | undefined {
  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) return undefined;

  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    allowExitOnIdle: true,
  });

  return new PostgresAgentRunConsumptionStore(pool);
}
