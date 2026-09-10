create table if not exists public.origin_coding_jobs_v14 (
  job_id text primary key,
  owner_hash text not null,
  target_key text not null,
  payload_ciphertext text,
  status text not null default 'queued',
  attempt integer not null default 0,
  version integer not null default 1,
  lease_owner text,
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  result_code text,
  changed_paths jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,

  constraint origin_coding_job_id_format
    check (job_id ~ '^coding-[A-Za-z0-9_-]{22}$'),
  constraint origin_coding_job_owner_hash_format
    check (owner_hash ~ '^[0-9a-f]{64}$'),
  constraint origin_coding_job_target_key_format
    check (target_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  constraint origin_coding_job_status_valid
    check (status in ('queued','leased','running','repairing','verified','blocked','failed','cancelled')),
  constraint origin_coding_job_attempt_valid
    check (attempt between 0 and 3),
  constraint origin_coding_job_version_valid
    check (version >= 1),
  constraint origin_coding_job_lease_owner_format
    check (lease_owner is null or lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  constraint origin_coding_job_result_code_format
    check (result_code is null or result_code ~ '^CODING_[A-Z0-9_]{1,120}$'),
  constraint origin_coding_job_changed_paths_array
    check (jsonb_typeof(changed_paths) = 'array' and jsonb_array_length(changed_paths) <= 12 and octet_length(changed_paths::text) <= 4096),
  constraint origin_coding_job_expiry
    check (expires_at >= created_at + interval '1 minute' and expires_at <= created_at + interval '7 days 1 minute'),
  constraint origin_coding_job_payload_lifecycle
    check (
      (status in ('queued','leased','running','repairing') and payload_ciphertext is not null and payload_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$')
      or
      (status in ('verified','blocked','failed','cancelled') and payload_ciphertext is null)
    ),
  constraint origin_coding_job_lease_lifecycle
    check (
      (status = 'queued' and lease_owner is null and lease_expires_at is null)
      or
      (status in ('leased','running','repairing') and lease_owner is not null and lease_expires_at is not null)
      or
      (status in ('verified','blocked','failed','cancelled') and lease_owner is null and lease_expires_at is null)
    ),
  constraint origin_coding_job_result_lifecycle
    check (
      (status in ('queued','leased','running','repairing') and result_code is null)
      or
      (status in ('verified','blocked','failed','cancelled') and result_code is not null)
    )
);

create index if not exists origin_coding_jobs_v14_owner_created_idx
  on public.origin_coding_jobs_v14 (owner_hash, created_at desc);
create index if not exists origin_coding_jobs_v14_status_lease_idx
  on public.origin_coding_jobs_v14 (status, lease_expires_at);
create index if not exists origin_coding_jobs_v14_expires_at_idx
  on public.origin_coding_jobs_v14 (expires_at);

alter table public.origin_coding_jobs_v14 enable row level security;
revoke all on table public.origin_coding_jobs_v14 from public;
revoke all on table public.origin_coding_jobs_v14 from anon;
revoke all on table public.origin_coding_jobs_v14 from authenticated;
grant select, insert, update, delete on table public.origin_coding_jobs_v14 to service_role;
