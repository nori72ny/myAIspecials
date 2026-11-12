-- Connector audit log (connector framework Phase 1, PR-1a).
-- One row per connector-management operation (and, in later phases, per
-- connector execution): when it happened, which owner it belonged to,
-- which connector and action it concerned, whether it carried the
-- owner's approval, and how it ended. Identifiers and short summaries
-- only -- credential values and personal-content bodies are never
-- written to this table (design section 2-6 and 6-2); the recording
-- module enforces that contract before any row reaches the table.
--
-- Retention is 90 days from occurred_at, pruned manually for now (the
-- automated pruning job belongs to a later phase). The occurred_at
-- index exists so pruning stays cheap, and the owner index supports
-- owner-scoped review of the log.

create table if not exists public.origin_connector_audit (
  audit_id uuid primary key,
  occurred_at timestamptz not null default now(),
  owner_id text not null,
  connector_id text not null,
  action text not null,
  kind text not null,
  approved boolean not null default false,
  approval_token_hash text,
  outcome text not null,
  error_code text,
  duration_ms integer,
  result_size_bytes integer,
  summary text not null default '',

  constraint origin_connector_audit_owner_format
    check (owner_id ~ '^[A-Za-z0-9:_-]{1,192}$'),
  constraint origin_connector_audit_connector_format
    check (connector_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  constraint origin_connector_audit_action_format
    check (action ~ '^[a-z][a-z0-9._-]{0,63}$'),
  constraint origin_connector_audit_kind_valid
    check (kind in ('read', 'write', 'manage')),
  constraint origin_connector_audit_approval_hash_format
    check (approval_token_hash is null or approval_token_hash ~ '^[0-9a-f]{64}$'),
  constraint origin_connector_audit_outcome_valid
    check (outcome in ('succeeded', 'failed')),
  constraint origin_connector_audit_error_code_format
    check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint origin_connector_audit_duration_range
    check (duration_ms is null or (duration_ms between 0 and 3600000)),
  constraint origin_connector_audit_result_size_range
    check (result_size_bytes is null or (result_size_bytes between 0 and 1073741824)),
  constraint origin_connector_audit_summary_size
    check (octet_length(summary) <= 256)
);

create index if not exists origin_connector_audit_occurred_at_idx
  on public.origin_connector_audit (occurred_at asc);
create index if not exists origin_connector_audit_owner_occurred_idx
  on public.origin_connector_audit (owner_id, occurred_at desc);

alter table public.origin_connector_audit enable row level security;
revoke all on table public.origin_connector_audit from public;
revoke all on table public.origin_connector_audit from anon;
revoke all on table public.origin_connector_audit from authenticated;
-- Append-only for the runtime role: rows are never updated in place.
-- Delete exists solely for the 90-day retention pruning.
grant select, insert, delete on table public.origin_connector_audit to service_role;

comment on table public.origin_connector_audit is
  'Server-only connector audit log. Identifiers and short summaries only; never credential values or content bodies.';
