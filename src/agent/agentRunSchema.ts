import type { QueryResult } from 'pg';
import type { AgentRunSqlExecutor } from './supabaseAgentRunStore.js';

/**
 * The runs schema migrations from `supabase/migrations/`, carried as
 * in-code constants because the production bundle cannot read files at
 * runtime. The constants are byte-identical to the .sql files after
 * whitespace normalization at the edges; `agentRunMigration.test.ts`
 * pins that equality so the two can never drift apart.
 *
 * All four statements are idempotent (IF NOT EXISTS / DROP IF EXISTS),
 * so applying them against a database that already has the schema is a
 * no-op.
 */
export const AGENT_RUN_MIGRATION_SQL_RUNS = `-- Persistent agent run records (multitask Phase 1 foundation).
-- One row per agent run: plan snapshot, per-step progress, hold information
-- and quota accounting, so a run survives the request that started it.
-- Approval itself is never stored here; capability tokens stay short-lived
-- and a held run must be re-approved before it can run again.

create table if not exists public.origin_agent_runs (
  run_id text primary key,
  owner_binding text not null,
  goal text not null,
  status text not null default 'planning',
  plan jsonb,
  plan_digest text,
  steps_state jsonb not null default '[]'::jsonb,
  parent_run_id text,
  priority integer not null default 0,
  hold jsonb,
  quota_ledger jsonb not null default '{}'::jsonb,
  driver_id text,
  lease_expires_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,

  constraint origin_agent_run_id_format
    check (run_id ~ '^run-[A-Za-z0-9-]{8,100}$'),
  constraint origin_agent_run_owner_binding_format
    check (owner_binding ~ '^[0-9a-f]{64}$'),
  constraint origin_agent_run_goal_length
    check (char_length(goal) between 1 and 4000),
  constraint origin_agent_run_status_valid
    check (status in ('planning','awaiting_approval','queued','running','held','completed','failed','cancelled','expired')),
  constraint origin_agent_run_plan_shape
    check (plan is null or (jsonb_typeof(plan) = 'array' and jsonb_array_length(plan) between 1 and 20 and octet_length(plan::text) <= 32768)),
  constraint origin_agent_run_plan_digest_format
    check (plan_digest is null or plan_digest ~ '^[0-9a-f]{64}$'),
  constraint origin_agent_run_plan_lifecycle
    check ((plan is null and plan_digest is null) or (plan is not null and plan_digest is not null)),
  constraint origin_agent_run_awaiting_plan
    check (status not in ('awaiting_approval','queued') or plan is not null),
  constraint origin_agent_run_steps_state_shape
    check (jsonb_typeof(steps_state) = 'array' and jsonb_array_length(steps_state) <= 20 and octet_length(steps_state::text) <= 32768),
  constraint origin_agent_run_parent_format
    check (parent_run_id is null or (parent_run_id ~ '^run-[A-Za-z0-9-]{8,100}$' and parent_run_id <> run_id)),
  constraint origin_agent_run_priority_range
    check (priority between -100 and 100),
  constraint origin_agent_run_hold_shape
    check (hold is null or (jsonb_typeof(hold) = 'object' and octet_length(hold::text) <= 4096)),
  constraint origin_agent_run_hold_lifecycle
    check ((status = 'held' and hold is not null) or (status <> 'held' and hold is null)),
  constraint origin_agent_run_quota_ledger_shape
    check (jsonb_typeof(quota_ledger) = 'object' and octet_length(quota_ledger::text) <= 4096),
  constraint origin_agent_run_driver_id_format
    check (driver_id is null or driver_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  constraint origin_agent_run_lease_lifecycle
    check (
      (status = 'running' and driver_id is not null and lease_expires_at is not null)
      or
      (status <> 'running' and driver_id is null and lease_expires_at is null)
    ),
  constraint origin_agent_run_version_valid
    check (version >= 1),
  constraint origin_agent_run_expiry
    check (expires_at >= created_at + interval '1 minute' and expires_at <= created_at + interval '7 days 1 minute')
);

create index if not exists origin_agent_runs_owner_created_idx
  on public.origin_agent_runs (owner_binding, created_at desc);
create index if not exists origin_agent_runs_owner_priority_idx
  on public.origin_agent_runs (owner_binding, priority desc, created_at desc);
create index if not exists origin_agent_runs_status_lease_idx
  on public.origin_agent_runs (status, lease_expires_at);
create index if not exists origin_agent_runs_expires_at_idx
  on public.origin_agent_runs (expires_at);

alter table public.origin_agent_runs enable row level security;
revoke all on table public.origin_agent_runs from public;
revoke all on table public.origin_agent_runs from anon;
revoke all on table public.origin_agent_runs from authenticated;
grant select, insert, update, delete on table public.origin_agent_runs to service_role;`;

export const AGENT_RUN_MIGRATION_SQL_WRITE_LOCKS = `-- Repository writer locks for durable agent runs (multitask Phase 1, PR 1-E).
-- One row per lock target: the current holder (run + driver) and its lease
-- expiry. Acquisition is a single conditional upsert, so two drivers racing
-- for the same target produce exactly one holder; a lock whose lease has
-- lapsed may be taken over, which is how a dead driver's write lock frees
-- itself. Holders are run/driver identifiers only -- never owner bindings,
-- capability tokens or other secrets.

create table if not exists public.origin_agent_write_locks (
  lock_key text primary key,
  holder_run_id text not null,
  holder_driver_id text not null,
  acquired_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now(),

  constraint origin_agent_write_lock_key_format
    check (lock_key ~ '^[a-z][a-z0-9][a-z0-9._:/-]{1,126}$'),
  constraint origin_agent_write_lock_holder_run_format
    check (holder_run_id ~ '^run-[A-Za-z0-9-]{8,100}$'),
  constraint origin_agent_write_lock_holder_driver_format
    check (holder_driver_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  constraint origin_agent_write_lock_lease_after_acquire
    check (lease_expires_at > acquired_at)
);

alter table public.origin_agent_write_locks enable row level security;
revoke all on table public.origin_agent_write_locks from public;
revoke all on table public.origin_agent_write_locks from anon;
revoke all on table public.origin_agent_write_locks from authenticated;
grant select, insert, update, delete on table public.origin_agent_write_locks to service_role;`;

export const AGENT_RUN_MIGRATION_SQL_RESUME_EVALUATION = `-- Resume evaluation material for durable agent runs (multitask Phase 1,
-- PR 1-G). Two additions to the run record:
--
-- * approval_deadline_at: the instant after which a run waiting in
--   \`awaiting_approval\` is considered approval-lapsed. The record
--   deliberately stored no capability expiry before (PR 1-C), so nothing
--   could trigger the design §8.3 approval-timeout conversion; the
--   piggyback evaluator (PR 1-G) converts lapsed runs to \`held\`
--   (reason \`awaiting_approval\`) from this column. It is set when a run
--   enters \`awaiting_approval\` (plan capability TTL + approval TTL from
--   the entry instant) and cleared when it leaves, mirroring the hold
--   lifecycle constraint.
-- * prior_resume_attempts: the resume-attempt count of the most recent
--   hold episode, carried across episodes. \`hold.resumeAttempts\` alone
--   cannot accumulate because the hold is cleared when a run leaves
--   \`held\`; this column is rewritten with the same value whenever a hold
--   is written, so a run that falls back to \`held\` after a resume can
--   seed its new hold with the previous count + 1 (design §8.6). NULL
--   means the run has never been held.
--
-- Idempotent: safe to apply twice (the CI concurrency suite applies
-- migrations repeatedly against a real Postgres).

alter table public.origin_agent_runs
  add column if not exists approval_deadline_at timestamptz;
alter table public.origin_agent_runs
  add column if not exists prior_resume_attempts integer;

-- Backfill rows that predate this migration so the lifecycle constraint
-- below holds for them: a run already waiting for approval gets the
-- latest instant an approval could still have been completed from its
-- last update (plan TTL 10 minutes + approval TTL 2 minutes), and a held
-- run's prior count starts from its current hold.
update public.origin_agent_runs
  set approval_deadline_at = updated_at + interval '12 minutes'
  where status = 'awaiting_approval' and approval_deadline_at is null;
update public.origin_agent_runs
  set prior_resume_attempts = (hold ->> 'resumeAttempts')::integer
  where status = 'held' and prior_resume_attempts is null and hold is not null;

alter table public.origin_agent_runs
  drop constraint if exists origin_agent_run_approval_deadline_lifecycle;
alter table public.origin_agent_runs
  add constraint origin_agent_run_approval_deadline_lifecycle
  check (
    (status = 'awaiting_approval' and approval_deadline_at is not null)
    or
    (status <> 'awaiting_approval' and approval_deadline_at is null)
  );
alter table public.origin_agent_runs
  drop constraint if exists origin_agent_run_prior_resume_attempts_range;
alter table public.origin_agent_runs
  add constraint origin_agent_run_prior_resume_attempts_range
  check (prior_resume_attempts is null or (prior_resume_attempts between 0 and 100000));`;

export const AGENT_RUN_MIGRATION_SQL_CONSUMED_RUNS = `-- Shared replay-protection reservations for agent runs (multitask Phase 1).
-- One row per run id ever reserved for execution, written before the
-- first tool executes and never released, so a run can execute at most
-- once across the legacy execute path and the durable runs path. The
-- reservation expiry is short-lived by contract (the consumption store
-- accepts at most 15 minutes from the reservation instant): expired
-- rows are deleted lazily by the store's consume() statement itself.
-- A short horizon is sufficient because the capability tokens that
-- could re-enter execution are themselves short-lived (plan TTL
-- 10 minutes + approval TTL 2 minutes), so no valid approval can
-- outlive a reservation and execute the run a second time.

create table if not exists public.origin_agent_consumed_runs (
  run_id text primary key,
  expires_at timestamptz not null,

  constraint origin_agent_consumed_run_id_format
    check (run_id ~ '^run-[A-Za-z0-9-]{8,100}$')
);

create index if not exists origin_agent_consumed_runs_expires_at_idx
  on public.origin_agent_consumed_runs (expires_at);

alter table public.origin_agent_consumed_runs enable row level security;
revoke all on table public.origin_agent_consumed_runs from public;
revoke all on table public.origin_agent_consumed_runs from anon;
revoke all on table public.origin_agent_consumed_runs from authenticated;
grant select, insert, update, delete on table public.origin_agent_consumed_runs to service_role;`;

/** The runs schema migrations in application order. */
export const AGENT_RUN_SCHEMA_MIGRATIONS: readonly string[] = [
  AGENT_RUN_MIGRATION_SQL_RUNS,
  AGENT_RUN_MIGRATION_SQL_WRITE_LOCKS,
  AGENT_RUN_MIGRATION_SQL_RESUME_EVALUATION,
  AGENT_RUN_MIGRATION_SQL_CONSUMED_RUNS,
];

const SAFE_SCHEMA_ENSURE_ERROR_FIELD = /^[A-Za-z0-9_.:-]{1,80}$/;

function safeSchemaEnsureErrorField(error: unknown, field: 'name' | 'code'): string {
  if (error && typeof error === 'object' && field in error) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === 'string' && SAFE_SCHEMA_ENSURE_ERROR_FIELD.test(value)) return value;
  }
  return 'UNKNOWN';
}

/**
 * Records a schema-ensure failure for production triage. Only the
 * error's name and code are logged — never the message: driver error
 * messages can be composed from host names or connection details (the
 * same policy as ORIGIN_AGENT_RUN_STORE_FAILED). The code carries the
 * diagnostic value: for Postgres it is the SQLSTATE (for example 42501
 * when the production database user lacks DDL privileges).
 */
export function logAgentRunSchemaEnsureFailure(error: unknown): void {
  console.error('ORIGIN_AGENT_RUN_SCHEMA_ENSURE_FAILED', {
    name: safeSchemaEnsureErrorField(error, 'name'),
    code: safeSchemaEnsureErrorField(error, 'code'),
  });
}

/**
 * Wraps an executor so the runs schema is ensured, idempotently and in
 * migration order, before the first store operation of the process.
 *
 * Production never had the runs migrations applied (the Supabase
 * project owner account is unknown, so the dashboard route is closed);
 * the only database connection available is the application's own, so
 * the schema is ensured lazily through it instead. Semantics:
 *
 * - A successful ensure runs at most once per process.
 * - A failed ensure is logged (name/code only), is NOT cached — the
 *   next operation retries — and never blocks the operation that
 *   triggered it: the operation executes exactly as before, so the
 *   existing fail-closed behavior (and its ORIGIN_AGENT_RUN_STORE_FAILED
 *   logging) is preserved while the schema is missing.
 * - Concurrent first operations share a single in-flight ensure.
 */
export function createAgentRunSchemaEnsuringExecutor(inner: AgentRunSqlExecutor): AgentRunSqlExecutor {
  let ensured = false;
  let inFlight: Promise<void> | null = null;

  const ensureSchema = async (): Promise<void> => {
    if (ensured) return;
    if (!inFlight) {
      inFlight = (async () => {
        for (const sql of AGENT_RUN_SCHEMA_MIGRATIONS) {
          await inner.query(sql);
        }
      })();
    }
    const attempt = inFlight;
    try {
      await attempt;
      ensured = true;
    } catch (error) {
      logAgentRunSchemaEnsureFailure(error);
    } finally {
      if (inFlight === attempt) inFlight = null;
    }
  };

  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> {
      await ensureSchema();
      return inner.query<T>(text, values);
    },
  };
}
