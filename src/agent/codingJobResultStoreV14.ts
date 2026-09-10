import { Pool, type QueryResult } from 'pg';
import { CODING_JOB_ID_PATTERN } from './codingJobCryptoV14.js';
import { CODING_JOB_RESULT_CIPHERTEXT_PATTERN } from './codingJobResultV14.js';

type DbRow = Record<string, unknown>;
export interface CodingJobResultSqlExecutorV14 {
  query<T extends DbRow = DbRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  return value;
}

export class PostgresCodingJobResultStoreV14 {
  constructor(private readonly database: CodingJobResultSqlExecutorV14) {}

  async put(jobId: string, resultCiphertext: string): Promise<boolean> {
    if (!CODING_JOB_ID_PATTERN.test(jobId) || !CODING_JOB_RESULT_CIPHERTEXT_PATTERN.test(resultCiphertext) || Buffer.byteLength(resultCiphertext, 'utf8') > 96 * 1024) {
      throw new Error('CODING_JOB_RESULT_STORE_INPUT_INVALID');
    }
    const result = await this.database.query(
      `insert into public.origin_coding_job_results_v14 (job_id, result_ciphertext)
       values ($1, $2)
       on conflict (job_id) do update
         set result_ciphertext = excluded.result_ciphertext,
             updated_at = clock_timestamp()
       returning job_id`,
      [jobId, resultCiphertext],
    );
    return result.rowCount === 1;
  }

  async get(jobId: string): Promise<string | null> {
    if (!CODING_JOB_ID_PATTERN.test(jobId)) return null;
    const result = await this.database.query<{ result_ciphertext: string }>(
      `select result_ciphertext
       from public.origin_coding_job_results_v14
       where job_id = $1
       limit 1`,
      [jobId],
    );
    const value = result.rows[0]?.result_ciphertext;
    if (value === undefined) return null;
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 96 * 1024 || !CODING_JOB_RESULT_CIPHERTEXT_PATTERN.test(value)) {
      throw new Error('CODING_JOB_RESULT_STORE_ROW_INVALID');
    }
    return value;
  }

  /** Remove terminal evidence when a cancellation wins after result projection. */
  async delete(jobId: string): Promise<boolean> {
    if (!CODING_JOB_ID_PATTERN.test(jobId)) return false;
    const result = await this.database.query(
      `delete from public.origin_coding_job_results_v14
       where job_id = $1
       returning job_id`,
      [jobId],
    );
    return result.rowCount === 1;
  }
}

export function createCodingJobResultStoreFromEnvV14(env: NodeJS.ProcessEnv = process.env): PostgresCodingJobResultStoreV14 | undefined {
  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) return undefined;
  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000, allowExitOnIdle: true });
  return new PostgresCodingJobResultStoreV14(pool);
}
