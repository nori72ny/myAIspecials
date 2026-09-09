import { Pool, type QueryResult } from 'pg';
import type { AgentRunConsumptionStore } from './agentOrchestratorV3.js';

const RUN_ID_PATTERN = /^run-[A-Za-z0-9-]{8,100}$/;
const MAX_TTL_MS = 15 * 60 * 1000;

export interface AgentReplaySqlExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
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
