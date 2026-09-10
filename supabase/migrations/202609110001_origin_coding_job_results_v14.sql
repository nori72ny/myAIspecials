create table if not exists public.origin_coding_job_results_v14 (
  job_id text primary key references public.origin_coding_jobs_v14(job_id) on delete cascade,
  result_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint origin_coding_job_result_ciphertext_format
    check (result_ciphertext ~ '^r1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$'),
  constraint origin_coding_job_result_ciphertext_size
    check (octet_length(result_ciphertext) <= 98304)
);

alter table public.origin_coding_job_results_v14 enable row level security;
revoke all on table public.origin_coding_job_results_v14 from public;
revoke all on table public.origin_coding_job_results_v14 from anon;
revoke all on table public.origin_coding_job_results_v14 from authenticated;
grant select, insert, update, delete on table public.origin_coding_job_results_v14 to service_role;
