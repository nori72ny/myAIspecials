import { Pool, type QueryResult } from 'pg';

/**
 * Internal V3.1 reservation ledger: unlike legacy Agent V3 consumption,
 * a reservation is not released after 15 minutes or after an uncertain tool
 * outcome. Never connect to this class until the service-only table has been
 * migrated and verified. No end-user route is registered here.
 */
export interface AgentMultiToolLedgerSqlV31 {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

const RUN_ID = /^run-[A-Za-z0-9-]{8,80}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class PostgresAgentMultiToolRunLedgerV31 {
  constructor(private readonly database: AgentMultiToolLedgerSqlV31) {}

  async reserveRunOnce(runId: string, goalDigest: string): Promise<boolean> {
    if (typeof runId !== 'string' || !RUN_ID.test(runId))
      throw new Error('AGENT_MULTITOOL_RUN_ID_INVALID');
    if (typeof goalDigest !== 'string' || !SHA256.test(goalDigest))
      throw new Error('AGENT_MULTITOOL_GOAL_DIGEST_INVALID');

    // No expiry/delete/retry here. An unknown outcome must remain reserved
    // until a separate trusted recovery process reconciles durable evidence.
    // A unique primary key protects against parallel workers/replicas.
    const result = await this.database.query<{ run_id: string }>(
      `insert into public.origin_agent_multitool_runs_v31
         (run_id, goal_digest, status)
       values ($1, $2, 'reserved')
       on conflict (run_id) do nothing
       returning run_id`,
      [runId, goalDigest],
    );
    if (result.rowCount === 0 && result.rows.length === 0) return false;
    if (result.rowCount === 1 && result.rows.length === 1 && result.rows[0]?.run_id === runId)
      return true;
    throw new Error('AGENT_MULTITOOL_RUN_RESERVATION_RECEIPT_INVALID');
  }
}

/**
 * Dormant opt-in factory. This must NOT activate the Agent V3.1 supervisor.
 * Missing configuration, migration or privileges fail closed; the caller
 * must not substitute the legacy TTL-based store or an in-memory Set.
 */
export function createAgentMultiToolRunLedgerFromEnvV31(
  env: NodeJS.ProcessEnv = process.env,
): PostgresAgentMultiToolRunLedgerV31 | undefined {
  if (env.ORIGIN_AGENT_MULTITOOL_LEDGER_V31_ENABLED !== 'true') return undefined;
  const url = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!url || !/^postgres(?:ql)?:\/\//i.test(url)) return undefined;
  return new PostgresAgentMultiToolRunLedgerV31(new Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    allowExitOnIdle: true,
  }));
}
