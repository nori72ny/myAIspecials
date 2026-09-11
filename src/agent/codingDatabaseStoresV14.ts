import { Pool } from 'pg';
import { resolveCodingDatabaseUrlV14 } from './codingDatabaseUrlV14.js';
import { PostgresCodingJobResultStoreV14 } from './codingJobResultStoreV14.js';
import { PostgresCodingJobStoreV14 } from './supabaseCodingJobStoreV14.js';

export type CodingDatabaseStoresV14 = {
  jobStore: PostgresCodingJobStoreV14 | undefined;
  resultStore: PostgresCodingJobResultStoreV14 | undefined;
  source: string | null;
};

/**
 * Build both V1.4 stores from one validated connection choice. This prevents a
 * malformed higher-priority environment variable from making the two stores
 * disagree or masking a valid fallback URL.
 */
export function createCodingDatabaseStoresFromEnvV14(env: NodeJS.ProcessEnv = process.env): CodingDatabaseStoresV14 {
  const resolution = resolveCodingDatabaseUrlV14(env);
  if (!resolution) return { jobStore: undefined, resultStore: undefined, source: null };

  const pool = new Pool({
    connectionString: resolution.connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    allowExitOnIdle: true,
  });

  return {
    jobStore: new PostgresCodingJobStoreV14(pool),
    resultStore: new PostgresCodingJobResultStoreV14(pool),
    source: resolution.source,
  };
}
