-- Repository writer locks for durable agent runs (multitask Phase 1, PR 1-E).
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
grant select, insert, update, delete on table public.origin_agent_write_locks to service_role;
