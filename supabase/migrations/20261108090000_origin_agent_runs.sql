-- Persistent agent run records (multitask Phase 1 foundation).
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
grant select, insert, update, delete on table public.origin_agent_runs to service_role;
