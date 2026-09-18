create table if not exists public.origin_execution_traces_v1 (
  trace_id text primary key,
  route text not null,
  task_type text not null,
  verification_status text not null,
  review_required boolean not null,
  independent_review_performed boolean not null,
  provider_id text,
  model_id text,
  free_only boolean not null,
  actual_cost_usd numeric(12,6) not null,
  outcome text not null,
  failure_code text,
  included_message_count integer not null,
  included_character_count integer not null,
  omitted_message_count integer not null,
  omitted_character_count integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  constraint origin_execution_trace_id_format
    check (trace_id ~ '^origin-[A-Za-z0-9._:-]{8,180}$'),
  constraint origin_execution_trace_route_format
    check (route ~ '^/[A-Za-z0-9._/-]{1,120}$'),
  constraint origin_execution_trace_task_type_format
    check (task_type ~ '^[a-z][a-z0-9-]{1,63}$'),
  constraint origin_execution_trace_verification_status_valid
    check (verification_status in ('not-required','not-run','passed','failed','blocked')),
  constraint origin_execution_trace_provider_id_format
    check (provider_id is null or provider_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  constraint origin_execution_trace_model_id_format
    check (model_id is null or model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$'),
  constraint origin_execution_trace_free_only
    check (free_only is true),
  constraint origin_execution_trace_zero_cost
    check (actual_cost_usd = 0),
  constraint origin_execution_trace_outcome_valid
    check (outcome in ('success','blocked','provider-failure','policy-rejected','invalid-response')),
  constraint origin_execution_trace_failure_code_format
    check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{1,120}$'),
  constraint origin_execution_trace_context_counts
    check (
      included_message_count between 0 and 256
      and included_character_count between 0 and 200000
      and omitted_message_count between 0 and 100000
      and omitted_character_count between 0 and 100000000
    ),
  constraint origin_execution_trace_review_consistency
    check (
      (verification_status = 'passed' and independent_review_performed is true)
      or
      (verification_status <> 'passed')
    ),
  constraint origin_execution_trace_expiry
    check (expires_at >= created_at + interval '1 hour' and expires_at <= created_at + interval '31 days')
);

create index if not exists origin_execution_traces_v1_created_idx
  on public.origin_execution_traces_v1 (created_at desc);
create index if not exists origin_execution_traces_v1_expires_idx
  on public.origin_execution_traces_v1 (expires_at);
create index if not exists origin_execution_traces_v1_outcome_idx
  on public.origin_execution_traces_v1 (outcome, created_at desc);

alter table public.origin_execution_traces_v1 enable row level security;
revoke all on table public.origin_execution_traces_v1 from public;
revoke all on table public.origin_execution_traces_v1 from anon;
revoke all on table public.origin_execution_traces_v1 from authenticated;
grant select, insert, delete on table public.origin_execution_traces_v1 to service_role;
