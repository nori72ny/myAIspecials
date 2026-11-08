import { Pool, type QueryResult } from 'pg';
import {
  validateAgentRunWriteLockHolder,
  validateAgentRunWriteLockKey,
  validateAgentRunWriteLockRequest,
  type AgentRunWriteLockRecord,
  type AgentRunWriteLockStore,
} from './agentRunWriteLock.js';

type DbRow = Record<string, unknown>;
export interface AgentRunWriteLockSqlExecutor {
  query<T extends DbRow = DbRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

const LOCK_RETURNING = `lock_key, holder_run_id, holder_driver_id,
  floor(extract(epoch from acquired_at) * 1000)::text as acquired_ms,
  floor(extract(epoch from lease_expires_at) * 1000)::text as lease_ms`;

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  return value;
}

function milliseconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('AGENT_RUN_WRITE_LOCK_DB_ROW_INVALID');
  return parsed;
}

function parseLockRecord(row: DbRow): AgentRunWriteLockRecord {
  const { lock_key: lockKey, holder_run_id: holderRunId, holder_driver_id: holderDriverId } = row;
  if (typeof lockKey !== 'string' || typeof holderRunId !== 'string' || typeof holderDriverId !== 'string') {
    throw new Error('AGENT_RUN_WRITE_LOCK_DB_ROW_INVALID');
  }
  try {
    validateAgentRunWriteLockHolder(lockKey, holderRunId, holderDriverId);
  } catch {
    throw new Error('AGENT_RUN_WRITE_LOCK_DB_ROW_INVALID');
  }
  return {
    lockKey,
    holderRunId,
    holderDriverId,
    acquiredAt: milliseconds(row.acquired_ms),
    leaseExpiresAt: milliseconds(row.lease_ms),
  };
}

/**
 * Postgres-backed writer lock store (design §2.5's lock-row option).
 * Acquisition is one conditional upsert against the lock table: the row
 * is taken when it does not exist, when its lease has lapsed, or when
 * the exact same holder re-acquires (a refresh, which keeps the original
 * acquisition instant). Parameterized SQL only, in the same style as the
 * run record store.
 */
export class PostgresAgentRunWriteLockStore implements AgentRunWriteLockStore {
  constructor(private readonly database: AgentRunWriteLockSqlExecutor) {}

  async acquire(lockKey: string, holderRunId: string, holderDriverId: string, leaseSeconds: number): Promise<AgentRunWriteLockRecord | null> {
    validateAgentRunWriteLockRequest(lockKey, holderRunId, holderDriverId, leaseSeconds);
    const result = await this.database.query(
      `insert into public.origin_agent_write_locks as locks
         (lock_key, holder_run_id, holder_driver_id, lease_expires_at)
       values ($1, $2, $3, clock_timestamp() + ($4 * interval '1 second'))
       on conflict (lock_key) do update
         set holder_run_id = excluded.holder_run_id,
             holder_driver_id = excluded.holder_driver_id,
             lease_expires_at = excluded.lease_expires_at,
             acquired_at = case
               when locks.holder_run_id = excluded.holder_run_id
                and locks.holder_driver_id = excluded.holder_driver_id
               then locks.acquired_at
               else clock_timestamp()
             end,
             updated_at = clock_timestamp()
         where locks.lease_expires_at <= clock_timestamp()
            or (locks.holder_run_id = excluded.holder_run_id
                and locks.holder_driver_id = excluded.holder_driver_id)
       returning ${LOCK_RETURNING}`,
      [lockKey, holderRunId, holderDriverId, leaseSeconds],
    );
    return result.rows[0] ? parseLockRecord(result.rows[0]) : null;
  }

  async renew(lockKey: string, holderRunId: string, holderDriverId: string, leaseSeconds: number): Promise<boolean> {
    validateAgentRunWriteLockRequest(lockKey, holderRunId, holderDriverId, leaseSeconds);
    const result = await this.database.query(
      `update public.origin_agent_write_locks
       set lease_expires_at = clock_timestamp() + ($4 * interval '1 second'),
           updated_at = clock_timestamp()
       where lock_key = $1 and holder_run_id = $2 and holder_driver_id = $3
         and lease_expires_at > clock_timestamp()
       returning lock_key`,
      [lockKey, holderRunId, holderDriverId, leaseSeconds],
    );
    return result.rowCount === 1;
  }

  async release(lockKey: string, holderRunId: string, holderDriverId: string): Promise<boolean> {
    validateAgentRunWriteLockHolder(lockKey, holderRunId, holderDriverId);
    const result = await this.database.query(
      `delete from public.origin_agent_write_locks
       where lock_key = $1 and holder_run_id = $2 and holder_driver_id = $3
       returning lock_key`,
      [lockKey, holderRunId, holderDriverId],
    );
    return result.rowCount === 1;
  }

  async inspect(lockKey: string): Promise<AgentRunWriteLockRecord | null> {
    validateAgentRunWriteLockKey(lockKey);
    const result = await this.database.query(
      `select ${LOCK_RETURNING}
       from public.origin_agent_write_locks
       where lock_key = $1
       limit 1`,
      [lockKey],
    );
    return result.rows[0] ? parseLockRecord(result.rows[0]) : null;
  }
}

export function createAgentRunWriteLockStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PostgresAgentRunWriteLockStore | undefined {
  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) return undefined;
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    allowExitOnIdle: true,
  });
  return new PostgresAgentRunWriteLockStore(pool);
}
