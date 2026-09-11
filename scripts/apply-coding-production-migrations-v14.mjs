import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

const rawUrl = process.env.POSTGRES_URL;
if (!rawUrl || !/^postgres(?:ql)?:\/\//i.test(rawUrl)) {
  throw new Error('CODING_MIGRATION_DATABASE_URL_MISSING');
}
if (process.env.ORIGIN_CODING_MIGRATION_CONFIRM !== 'production-coding-v14') {
  throw new Error('CODING_MIGRATION_CONFIRMATION_MISSING');
}

const jobsMigration = await readFile(new URL('../supabase/migrations/20260911_origin_coding_jobs_v14.sql', import.meta.url), 'utf8');
const resultsMigration = await readFile(new URL('../supabase/migrations/20260912_origin_coding_job_results_v14.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString: rawUrl, connectionTimeoutMillis: 5000, statement_timeout: 15000 });

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

try {
  await client.connect();
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtextextended('origin-coding-v14-production-migration', 0))");

  // Refuse to mutate an unrelated database. The V1.3.1 publication table is an
  // existing ORIGIN production schema marker and is never created by this runner.
  const identity = await client.query(`
    select to_regclass('public.origin_builder_publications') is not null as origin_marker
  `);
  if (identity.rows[0]?.origin_marker !== true) fail('CODING_MIGRATION_TARGET_UNRECOGNIZED');

  await client.query(jobsMigration);
  await client.query(resultsMigration);

  const verification = await client.query(`
    select
      to_regclass('public.origin_coding_jobs_v14') is not null as jobs_table,
      to_regclass('public.origin_coding_job_results_v14') is not null as results_table,
      coalesce((select relrowsecurity from pg_class where oid = 'public.origin_coding_jobs_v14'::regclass), false) as jobs_rls,
      coalesce((select relrowsecurity from pg_class where oid = 'public.origin_coding_job_results_v14'::regclass), false) as results_rls,
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
  if (!row || row.jobs_table !== true || row.results_table !== true || row.jobs_rls !== true || row.results_rls !== true || row.cancel_trigger !== true) {
    fail('CODING_MIGRATION_VERIFICATION_FAILED');
  }

  await client.query('commit');
  console.log('CODING_MIGRATIONS_APPLIED_AND_VERIFIED');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  const code = typeof error?.code === 'string' && /^CODING_MIGRATION_[A-Z_]+$/.test(error.code)
    ? error.code
    : 'CODING_MIGRATION_DATABASE_OPERATION_FAILED';
  console.error(code);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
