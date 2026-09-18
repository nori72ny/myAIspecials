import { Pool, type QueryResult } from "pg";
import { validateOriginExecutionTrace, type OriginExecutionTraceRecord } from "./OriginExecutionTrace.js";

type DbRow = Record<string, unknown>;

export interface OriginTraceSqlExecutor {
  query<T extends DbRow = DbRow>(text:string, values?:readonly unknown[]): Promise<QueryResult<T>>;
}

function resolveDatabaseUrl(env:NodeJS.ProcessEnv):string|undefined {
  const value=env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if(!value || !/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  return value;
}

export class PostgresOriginExecutionTraceStore {
  constructor(private readonly database:OriginTraceSqlExecutor) {}

  async append(input:OriginExecutionTraceRecord):Promise<boolean> {
    const checked=validateOriginExecutionTrace(input);
    if(!checked.ok) throw new Error(checked.code);
    const record=checked.value;
    const result=await this.database.query(
      `insert into public.origin_execution_traces_v1
        (trace_id, started_at, completed_at, outcome, transmission, policy_json,
         execution_json, verification_json, context_json, error_code)
       values ($1,$2::timestamptz,$3::timestamptz,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10)
       on conflict (trace_id) do nothing
       returning trace_id`,
      [
        record.traceId,
        record.startedAt,
        record.completedAt,
        record.outcome,
        record.transmission,
        JSON.stringify(record.policy),
        record.execution ? JSON.stringify(record.execution) : null,
        JSON.stringify(record.verification),
        record.context ? JSON.stringify(record.context) : null,
        record.errorCode ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  async deleteExpired(limit=500):Promise<number> {
    if(!Number.isInteger(limit) || limit<1 || limit>1000) throw new Error("TRACE_CLEANUP_LIMIT_INVALID");
    const result=await this.database.query(
      `with expired as (
         select ctid from public.origin_execution_traces_v1
         where expires_at <= clock_timestamp()
         order by expires_at asc
         limit $1
       )
       delete from public.origin_execution_traces_v1
       where ctid in (select ctid from expired)
       returning trace_id`,
      [limit],
    );
    return result.rowCount ?? result.rows.length;
  }
}

export function createOriginExecutionTraceStoreFromEnv(
  env:NodeJS.ProcessEnv=process.env,
):PostgresOriginExecutionTraceStore|undefined {
  const connectionString=resolveDatabaseUrl(env);
  if(!connectionString) return undefined;
  const pool=new Pool({
    connectionString,
    max:1,
    idleTimeoutMillis:10_000,
    connectionTimeoutMillis:3_000,
    allowExitOnIdle:true,
  });
  return new PostgresOriginExecutionTraceStore(pool);
}
