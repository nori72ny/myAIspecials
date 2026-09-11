import { Client } from 'pg';

const WORKER_ENABLED_ENV = 'ORIGIN_CODING_WORKER_ENABLED';
const PRODUCTION_ENV = 'production';
const MAIN_REF = 'main';
const ADVISORY_LOCK_KEY = 'origin-coding-v14-vercel-bootstrap';

// Keep the one-shot bootstrap self-contained inside the server bundle. Vercel may
// rewrite import.meta during bundling and does not guarantee arbitrary repository
// SQL files are present beside the emitted function at runtime.
const JOBS_MIGRATION_SQL = String.raw`create table if not exists public.origin_coding_jobs_v14 (
  job_id text primary key,
  owner_hash text not null,
  target_key text not null,
  payload_ciphertext text,
  status text not null default 'queued',
  attempt integer not null default 0,
  version integer not null default 1,
  lease_owner text,
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  result_code text,
  changed_paths jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,

  constraint origin_coding_job_id_format
    check (job_id ~ '^coding-[A-Za-z0-9_-]{22}$'),
  constraint origin_coding_job_owner_hash_format
    check (owner_hash ~ '^[0-9a-f]{64}$'),
  constraint origin_coding_job_target_key_format
    check (target_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  constraint origin_coding_job_status_valid
    check (status in ('queued','leased','running','repairing','verified','blocked','failed','cancelled')),
  constraint origin_coding_job_attempt_valid
    check (attempt between 0 and 3),
  constraint origin_coding_job_version_valid
    check (version >= 1),
  constraint origin_coding_job_lease_owner_format
    check (lease_owner is null or lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  constraint origin_coding_job_result_code_format
    check (result_code is null or result_code ~ '^CODING_[A-Z0-9_]{1,120}$'),
  constraint origin_coding_job_changed_paths_array
    check (jsonb_typeof(changed_paths) = 'array' and jsonb_array_length(changed_paths) <= 12 and octet_length(changed_paths::text) <= 4096),
  constraint origin_coding_job_expiry
    check (expires_at >= created_at + interval '1 minute' and expires_at <= created_at + interval '7 days 1 minute'),
  constraint origin_coding_job_payload_lifecycle
    check (
      (status in ('queued','leased','running','repairing') and payload_ciphertext is not null and payload_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$')
      or
      (status in ('verified','blocked','failed','cancelled') and payload_ciphertext is null)
    ),
  constraint origin_coding_job_lease_lifecycle
    check (
      (status = 'queued' and lease_owner is null and lease_expires_at is null)
      or
      (status in ('leased','running','repairing') and lease_owner is not null and lease_expires_at is not null)
      or
      (status in ('verified','blocked','failed','cancelled') and lease_owner is null and lease_expires_at is null)
    ),
  constraint origin_coding_job_result_lifecycle
    check (
      (status in ('queued','leased','running','repairing') and result_code is null)
      or
      (status in ('verified','blocked','failed','cancelled') and result_code is not null)
    )
);

create index if not exists origin_coding_jobs_v14_owner_created_idx
  on public.origin_coding_jobs_v14 (owner_hash, created_at desc);
create index if not exists origin_coding_jobs_v14_status_lease_idx
  on public.origin_coding_jobs_v14 (status, lease_expires_at);
create index if not exists origin_coding_jobs_v14_expires_at_idx
  on public.origin_coding_jobs_v14 (expires_at);

alter table public.origin_coding_jobs_v14 enable row level security;
revoke all on table public.origin_coding_jobs_v14 from public;
revoke all on table public.origin_coding_jobs_v14 from anon;
revoke all on table public.origin_coding_jobs_v14 from authenticated;
grant select, insert, update, delete on table public.origin_coding_jobs_v14 to service_role;`;

const RESULTS_MIGRATION_SQL = String.raw`create table if not exists public.origin_coding_job_results_v14 (
  job_id text primary key references public.origin_coding_jobs_v14(job_id) on delete cascade,
  result_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint origin_coding_job_result_ciphertext_format
    check (result_ciphertext ~ '^r1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$'),
  constraint origin_coding_job_result_ciphertext_size
    check (octet_length(result_ciphertext) <= 98304)
);

alter table public.origin_coding_job_results_v14 enable row level security;
revoke all on table public.origin_coding_job_results_v14 from public;
revoke all on table public.origin_coding_job_results_v14 from anon;
revoke all on table public.origin_coding_job_results_v14 from authenticated;
grant select, insert, update, delete on table public.origin_coding_job_results_v14 to service_role;

create or replace function public.origin_coding_job_result_cancel_cleanup_v14()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.origin_coding_job_results_v14 where job_id = new.job_id;
  return new;
end;
$$;

revoke all on function public.origin_coding_job_result_cancel_cleanup_v14() from public;
revoke all on function public.origin_coding_job_result_cancel_cleanup_v14() from anon;
revoke all on function public.origin_coding_job_result_cancel_cleanup_v14() from authenticated;
grant execute on function public.origin_coding_job_result_cancel_cleanup_v14() to service_role;

drop trigger if exists origin_coding_job_result_cancel_cleanup_v14 on public.origin_coding_jobs_v14;
create trigger origin_coding_job_result_cancel_cleanup_v14
after update of status on public.origin_coding_jobs_v14
for each row
when (new.status = 'cancelled' and old.status is distinct from new.status)
execute function public.origin_coding_job_result_cancel_cleanup_v14();`;

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
  migrations?: { jobs: string; results: string };
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
  const migrations = deps.migrations ?? { jobs: JOBS_MIGRATION_SQL, results: RESULTS_MIGRATION_SQL };
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
      if (!migrations.jobs.trim() || !migrations.results.trim()) fail('CODING_SCHEMA_BOOTSTRAP_MIGRATION_EMPTY');
      await client.query(migrations.jobs);
      await client.query(migrations.results);
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
