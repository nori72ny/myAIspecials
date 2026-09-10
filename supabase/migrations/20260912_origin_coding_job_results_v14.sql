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

-- Cancellation is a privacy boundary, not merely a UI state. If a result was
-- persisted just before cancellation became terminal, remove it in the same DB
-- transaction as the job status transition. Worker/API deletion remains defense
-- in depth and covers deployments where this migration has not yet been applied.
create or replace function public.origin_coding_job_result_cancel_cleanup_v14()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.origin_coding_job_results_v14 where job_id = new.job_id;
  return new;
end;
$$;

revoke all on function public.origin_coding_job_result_cancel_cleanup_v14() from public;
revoke all on function public.origin_coding_job_result_cancel_cleanup_v14() from anon;
revoke all on function public.origin_coding_job_result_cancel_cleanup_v14() from authenticated;
grant execute on function public.origin_coding_job_result_cancel_cleanup_v14() to service_role;

drop trigger if exists origin_coding_job_result_cancel_cleanup_v14 on public.origin_coding_jobs_v14;
create trigger origin_coding_job_result_cancel_cleanup_v14
after update of status on public.origin_coding_jobs_v14
for each row
when (new.status = 'cancelled' and old.status is distinct from new.status)
execute function public.origin_coding_job_result_cancel_cleanup_v14();
