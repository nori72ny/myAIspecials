// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
