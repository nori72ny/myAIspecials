-- Shared replay-protection reservations for agent runs (multitask Phase 1).
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
grant select, insert, update, delete on table public.origin_agent_consumed_runs to service_role;
