create table if not exists public.origin_execution_traces_v1 (
  trace_id text primary key,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  outcome text not null,
  transmission text not null,
  policy_json jsonb not null,
  execution_json jsonb,
  verification_json jsonb not null,
  context_json jsonb,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '30 days'),

  constraint origin_execution_trace_id_format
    check (trace_id ~ '^origin-[A-Za-z0-9._:-]{1,180}$'),
  constraint origin_execution_trace_time_order
    check (completed_at >= started_at),
  constraint origin_execution_trace_outcome_valid
    check (outcome in ('local-only','sensitive-input-blocked','context-rejected','policy-rejected','provider-failed','accepted')),
  constraint origin_execution_trace_transmission_valid
    check (transmission in ('not-attempted','attempted')),
  constraint origin_execution_trace_policy_object
    check (jsonb_typeof(policy_json) = 'object' and octet_length(policy_json::text) <= 2048),
  constraint origin_execution_trace_execution_object
    check (execution_json is null or (jsonb_typeof(execution_json) = 'object' and octet_length(execution_json::text) <= 4096)),
  constraint origin_execution_trace_verification_object
    check (jsonb_typeof(verification_json) = 'object' and octet_length(verification_json::text) <= 2048),
  constraint origin_execution_trace_context_object
    check (context_json is null or (jsonb_typeof(context_json) = 'object' and octet_length(context_json::text) <= 2048)),
  constraint origin_execution_trace_error_code_format
    check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,120}$'),
  constraint origin_execution_trace_retention
    check (expires_at >= created_at + interval '1 day' and expires_at <= created_at + interval '31 days')
);

create index if not exists origin_execution_traces_v1_expires_at_idx
  on public.origin_execution_traces_v1 (expires_at);

alter table public.origin_execution_traces_v1 enable row level security;
revoke all on table public.origin_execution_traces_v1 from public;
revoke all on table public.origin_execution_traces_v1 from anon;
revoke all on table public.origin_execution_traces_v1 from authenticated;
grant select, insert, delete on table public.origin_execution_traces_v1 to service_role;
