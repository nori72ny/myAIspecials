-- Ensure expired V1.4 coding jobs cannot remain indefinitely in an active state.
-- The sweep is bounded and only touches already-expired active rows.
create extension if not exists pg_cron;

select cron.schedule(
  'origin-coding-v14-expired-active-sweep',
  '*/5 * * * *',
  $cron$
    with expired_active as (
      select ctid
      from public.origin_coding_jobs_v14
      where expires_at <= clock_timestamp()
        and status in ('leased', 'running', 'repairing')
      order by expires_at asc
      limit 100
    )
    update public.origin_coding_jobs_v14 as jobs
    set status = case
          when cancel_requested_at is not null then 'cancelled'
          else 'failed'
        end,
        result_code = case
          when cancel_requested_at is not null then 'CODING_CANCELLED_BY_USER'
          else 'CODING_JOB_EXPIRED'
        end,
        payload_ciphertext = null,
        lease_owner = null,
        lease_expires_at = null,
        updated_at = clock_timestamp(),
        version = version + 1
    where jobs.ctid in (select ctid from expired_active);
  $cron$
);
