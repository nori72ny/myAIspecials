// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_MIGRATION_SQL_CONSUMED_RUNS,
  AGENT_RUN_MIGRATION_SQL_RESUME_EVALUATION,
  AGENT_RUN_MIGRATION_SQL_RUNS,
  AGENT_RUN_MIGRATION_SQL_WRITE_LOCKS,
  AGENT_RUN_SCHEMA_MIGRATIONS,
} from './agentRunSchema.js';

describe('agent runs migration contract', () => {
  it('keeps run records service-role-only with lifecycle constraints mirroring the store', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/20261108090000_origin_agent_runs.sql', import.meta.url), 'utf8');
    expect(sql).toContain('create table if not exists public.origin_agent_runs');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke all on table public.origin_agent_runs from anon');
    expect(sql).toContain('revoke all on table public.origin_agent_runs from authenticated');
    expect(sql).toContain('grant select, insert, update, delete on table public.origin_agent_runs to service_role');
    // The full status vocabulary of the run state machine.
    for (const status of ['planning', 'awaiting_approval', 'queued', 'running', 'held', 'completed', 'failed', 'cancelled', 'expired']) {
      expect(sql).toContain(`'${status}'`);
    }
    // Hold information exists exactly while a run is held.
    expect(sql).toContain("origin_agent_run_hold_lifecycle");
    expect(sql).toContain("(status = 'held' and hold is not null) or (status <> 'held' and hold is null)");
    // A driver lease exists exactly while a run is running.
    expect(sql).toContain('origin_agent_run_lease_lifecycle');
    expect(sql).toContain("(status = 'running' and driver_id is not null and lease_expires_at is not null)");
    // Plan snapshot and digest are stored as a bound pair, and approval-bound
    // statuses always carry a plan.
    expect(sql).toContain('origin_agent_run_plan_lifecycle');
    expect(sql).toContain("status not in ('awaiting_approval','queued') or plan is not null");
    // Owner binding is a hash, never a raw identifier.
    expect(sql).toContain("owner_binding ~ '^[0-9a-f]{64}$'");
    // Retention is bounded: at least a minute, at most seven days.
    expect(sql).toContain("expires_at >= created_at + interval '1 minute'");
    expect(sql).toContain("expires_at <= created_at + interval '7 days 1 minute'");
  });
});

describe('agent run resume evaluation migration contract', () => {
  it('adds the approval deadline and carried resume-attempt count with lifecycle constraints mirroring the store', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/20261108110000_origin_agent_run_resume_evaluation.sql', import.meta.url), 'utf8');
    // Both additions are idempotent so the concurrency suite can re-apply.
    expect(sql).toContain('add column if not exists approval_deadline_at timestamptz');
    expect(sql).toContain('add column if not exists prior_resume_attempts integer');
    // The approval deadline exists exactly while a run awaits approval.
    expect(sql).toContain('origin_agent_run_approval_deadline_lifecycle');
    expect(sql).toContain("(status = 'awaiting_approval' and approval_deadline_at is not null)");
    expect(sql).toContain("(status <> 'awaiting_approval' and approval_deadline_at is null)");
    // The carried count is bounded like the record contract.
    expect(sql).toContain('origin_agent_run_prior_resume_attempts_range');
    expect(sql).toContain('prior_resume_attempts between 0 and 100000');
    // Pre-existing rows are backfilled before the constraint is added:
    // lapsed-approval material from the last update (plan 10m + approval 2m),
    // and the carried count from the current hold.
    expect(sql).toContain("approval_deadline_at = updated_at + interval '12 minutes'");
    expect(sql).toContain("prior_resume_attempts = (hold ->> 'resumeAttempts')::integer");
  });
});

describe('agent write locks migration contract', () => {
  it('keeps writer locks service-role-only with holder and lease constraints mirroring the store', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/20261108100000_origin_agent_write_locks.sql', import.meta.url), 'utf8');
    expect(sql).toContain('create table if not exists public.origin_agent_write_locks');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke all on table public.origin_agent_write_locks from anon');
    expect(sql).toContain('revoke all on table public.origin_agent_write_locks from authenticated');
    expect(sql).toContain('grant select, insert, update, delete on table public.origin_agent_write_locks to service_role');
    // One row per lock target.
    expect(sql).toContain('lock_key text primary key');
    // Holders are run/driver identifiers in the established formats.
    expect(sql).toContain("holder_run_id ~ '^run-[A-Za-z0-9-]{8,100}$'");
    expect(sql).toContain("holder_driver_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'");
    // A lease always outlives its acquisition instant.
    expect(sql).toContain('lease_expires_at > acquired_at');
  });
});

describe('agent consumed runs migration contract', () => {
  it('keeps replay-protection reservations service-role-only with the columns the store writes', async () => {
    const sql = await readFile(new URL('../../supabase/migrations/20261108120000_origin_agent_consumed_runs.sql', import.meta.url), 'utf8');
    expect(sql).toContain('create table if not exists public.origin_agent_consumed_runs');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke all on table public.origin_agent_consumed_runs from anon');
    expect(sql).toContain('revoke all on table public.origin_agent_consumed_runs from authenticated');
    expect(sql).toContain('grant select, insert, update, delete on table public.origin_agent_consumed_runs to service_role');
    // One row per run id: the primary key is the ON CONFLICT target of
    // the store's atomic reservation insert.
    expect(sql).toContain('run_id text primary key');
    // Exactly the columns the store's INSERT writes, in the formats the
    // store validates before database access.
    expect(sql).toContain('expires_at timestamptz not null');
    expect(sql).toContain("run_id ~ '^run-[A-Za-z0-9-]{8,100}$'");
    // The store's consume() deletes lapsed reservations inside the same
    // statement, so expiry needs an index.
    expect(sql).toContain('origin_agent_consumed_runs_expires_at_idx');
  });
});

describe('agent run schema constants mirror the migration files', () => {
  // The production bundle cannot read files at runtime, so the runs
  // schema is ensured lazily from in-code constants (agentRunSchema.ts).
  // Those constants must never drift from the migration files they
  // mirror: after edge-whitespace normalization they are identical.
  const normalize = (sql: string): string => sql.replace(/\r\n/g, '\n').trim();
  const cases: Array<{ constant: string; file: string }> = [
    { constant: AGENT_RUN_MIGRATION_SQL_RUNS, file: '../../supabase/migrations/20261108090000_origin_agent_runs.sql' },
    { constant: AGENT_RUN_MIGRATION_SQL_WRITE_LOCKS, file: '../../supabase/migrations/20261108100000_origin_agent_write_locks.sql' },
    { constant: AGENT_RUN_MIGRATION_SQL_RESUME_EVALUATION, file: '../../supabase/migrations/20261108110000_origin_agent_run_resume_evaluation.sql' },
    { constant: AGENT_RUN_MIGRATION_SQL_CONSUMED_RUNS, file: '../../supabase/migrations/20261108120000_origin_agent_consumed_runs.sql' },
  ];

  it('keeps every schema constant identical to its migration file', async () => {
    for (const { constant, file } of cases) {
      const sql = await readFile(new URL(file, import.meta.url), 'utf8');
      expect(normalize(constant)).toBe(normalize(sql));
    }
  });

  it('applies the migrations in file order', () => {
    expect(AGENT_RUN_SCHEMA_MIGRATIONS).toEqual([
      AGENT_RUN_MIGRATION_SQL_RUNS,
      AGENT_RUN_MIGRATION_SQL_WRITE_LOCKS,
      AGENT_RUN_MIGRATION_SQL_RESUME_EVALUATION,
      AGENT_RUN_MIGRATION_SQL_CONSUMED_RUNS,
    ]);
  });
});
