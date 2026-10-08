-- REVIEW-ONLY DRAFT. NOT A SUPABASE MIGRATION. DO NOT APPLY TO PRODUCTION.
-- When approved, use `supabase migration new <name>` to generate a real
-- timestamped migration in the repository. Review existing grants and run the
-- PostgreSQL 16/18 integration tests before applying. This table deliberately
-- does NOT reuse origin_agent_consumed_runs (the legacy 15-minute TTL store).
--
-- Contract: a run reservation cannot expire while any external side effect is
-- uncertain; no automatic cleanup, retry or ID recycling is authorized here.
create table if not exists public.origin_agent_multitool_runs_v31 (
  run_id text primary key,
  goal_digest text not null,
  status text not null default 'reserved',
  created_at timestamptz not null default now(),
  constraint origin_multitool_run_id_v31_format
    check (run_id ~ '^run-[A-Za-z0-9-]{8,80}$'),
  constraint origin_multitool_goal_digest_v31_format
    check (goal_digest ~ '^[0-9a-f]{64}$'),
  constraint origin_multitool_status_v31_valid
    check (status in ('reserved', 'reconciliation_required', 'completed', 'cancelled'))
);

-- Explicit deny-by-default on the exposed public schema. A dedicated service
-- credential is required; never grant owner/user/browser roles direct access.
alter table public.origin_agent_multitool_runs_v31 enable row level security;
revoke all on table public.origin_agent_multitool_runs_v31 from public;
revoke all on table public.origin_agent_multitool_runs_v31 from anon;
revoke all on table public.origin_agent_multitool_runs_v31 from authenticated;
grant select, insert on table public.origin_agent_multitool_runs_v31 to service_role;

-- No DELETE, expiration index, update privilege or implicit cleanup function.
-- The future trusted reconciliation/retention worker must be separately scoped
-- and audited; until then rows remain reserved indefinitely (fail closed).
