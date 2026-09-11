import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

const WORKER_ENABLED_ENV = 'ORIGIN_CODING_WORKER_ENABLED';
const PRODUCTION_ENV = 'production';
const MAIN_REF = 'main';
const ADVISORY_LOCK_KEY = 'origin-coding-v14-vercel-bootstrap';

const JOBS_MIGRATION_URL = new URL('../../supabase/migrations/20260911_origin_coding_jobs_v14.sql', import.meta.url);
const RESULTS_MIGRATION_URL = new URL('../../supabase/migrations/20260912_origin_coding_job_results_v14.sql', import.meta.url);

export type CodingSchemaBootstrapStatusV14 = 'skipped' | 'already_ready' | 'applied' | 'failed';
export type CodingSchemaBootstrapResultV14 = {
  status: CodingSchemaBootstrapStatusV14;
  code: string;
};

type DbRow = Record<string, unknown>;
export interface CodingSchemaBootstrapClientV14 {
  connect(): Promise<void>;
  query<T extends DbRow = DbRow>(text: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
  end(): Promise<void>;
}

export type CodingSchemaBootstrapDepsV14 = {
  createClient?: (connectionString: string) => CodingSchemaBootstrapClientV14;
  readMigration?: (url: URL) => Promise<string>;
};

class PgCodingSchemaBootstrapClientV14 implements CodingSchemaBootstrapClientV14 {
  private readonly client: Client;

  constructor(connectionString: string) {
    this.client = new Client({
      connectionString,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async query<T extends DbRow = DbRow>(text: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> {
    const result = values
      ? await this.client.query(text, [...values])
      : await this.client.query(text);
    return { rows: result.rows as T[], rowCount: result.rowCount };
  }

  async end(): Promise<void> {
    await this.client.end();
  }
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) return undefined;
  return value;
}

function shouldBootstrap(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL_ENV === PRODUCTION_ENV
    && env.VERCEL_GIT_COMMIT_REF === MAIN_REF
    && env[WORKER_ENABLED_ENV] !== 'true';
}

function failureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^CODING_SCHEMA_BOOTSTRAP_[A-Z_]+$/.test(error.code)) {
    return error.code;
  }
  return 'CODING_SCHEMA_BOOTSTRAP_DATABASE_OPERATION_FAILED';
}

function fail(code: string): never {
  const error = new Error(code) as Error & { code?: string };
  error.code = code;
  throw error;
}

async function verifySchema(client: CodingSchemaBootstrapClientV14): Promise<boolean> {
  const verification = await client.query<{
    jobs_table: boolean;
    results_table: boolean;
    jobs_rls: boolean;
    results_rls: boolean;
    cancel_trigger: boolean;
  }>(`
    select
      to_regclass('public.origin_coding_jobs_v14') is not null as jobs_table,
      to_regclass('public.origin_coding_job_results_v14') is not null as results_table,
      coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.origin_coding_jobs_v14')), false) as jobs_rls,
      coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.origin_coding_job_results_v14')), false) as results_rls,
      exists (
        select 1
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'origin_coding_jobs_v14'
          and t.tgname = 'origin_coding_job_result_cancel_cleanup_v14'
          and not t.tgisinternal
      ) as cancel_trigger
  `);
  const row = verification.rows[0];
  return row?.jobs_table === true
    && row.results_table === true
    && row.jobs_rls === true
    && row.results_rls === true
    && row.cancel_trigger === true;
}

async function schemaTablesExist(client: CodingSchemaBootstrapClientV14): Promise<boolean> {
  const result = await client.query<{ jobs_table: boolean; results_table: boolean }>(`
    select
      to_regclass('public.origin_coding_jobs_v14') is not null as jobs_table,
      to_regclass('public.origin_coding_job_results_v14') is not null as results_table
  `);
  return result.rows[0]?.jobs_table === true && result.rows[0]?.results_table === true;
}

export async function bootstrapCodingSchemaV14(
  env: NodeJS.ProcessEnv = process.env,
  deps: CodingSchemaBootstrapDepsV14 = {},
): Promise<CodingSchemaBootstrapResultV14> {
  if (!shouldBootstrap(env)) return { status: 'skipped', code: 'CODING_SCHEMA_BOOTSTRAP_NOT_APPLICABLE' };

  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) return { status: 'skipped', code: 'CODING_SCHEMA_BOOTSTRAP_DATABASE_NOT_CONFIGURED' };

  const createClient: (value: string) => CodingSchemaBootstrapClientV14 = deps.createClient
    ?? ((value: string) => new PgCodingSchemaBootstrapClientV14(value));
  const readMigration = deps.readMigration ?? (async (url: URL) => readFile(url, 'utf8'));
  const client = createClient(connectionString);
  let transactionStarted = false;

  try {
    await client.connect();
    await client.query('begin');
    transactionStarted = true;
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [ADVISORY_LOCK_KEY]);

    const identity = await client.query<{ origin_marker: boolean }>(`
      select to_regclass('public.origin_builder_publications') is not null as origin_marker
    `);
    if (identity.rows[0]?.origin_marker !== true) fail('CODING_SCHEMA_BOOTSTRAP_TARGET_UNRECOGNIZED');

    const existedBefore = await schemaTablesExist(client);
    if (!existedBefore) {
      const [jobsMigration, resultsMigration] = await Promise.all([
        readMigration(JOBS_MIGRATION_URL),
        readMigration(RESULTS_MIGRATION_URL),
      ]);
      if (!jobsMigration.trim() || !resultsMigration.trim()) fail('CODING_SCHEMA_BOOTSTRAP_MIGRATION_EMPTY');
      await client.query(jobsMigration);
      await client.query(resultsMigration);
    }

    if (!(await verifySchema(client))) fail('CODING_SCHEMA_BOOTSTRAP_VERIFICATION_FAILED');
    await client.query('commit');
    transactionStarted = false;
    return {
      status: existedBefore ? 'already_ready' : 'applied',
      code: existedBefore ? 'CODING_SCHEMA_BOOTSTRAP_ALREADY_READY' : 'CODING_SCHEMA_BOOTSTRAP_APPLIED',
    };
  } catch (error) {
    if (transactionStarted) await client.query('rollback').catch(() => undefined);
    return { status: 'failed', code: failureCode(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}
