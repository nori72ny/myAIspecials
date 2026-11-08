-- Resume evaluation material for durable agent runs (multitask Phase 1,
-- PR 1-G). Two additions to the run record:
--
-- * approval_deadline_at: the instant after which a run waiting in
--   `awaiting_approval` is considered approval-lapsed. The record
--   deliberately stored no capability expiry before (PR 1-C), so nothing
--   could trigger the design §8.3 approval-timeout conversion; the
--   piggyback evaluator (PR 1-G) converts lapsed runs to `held`
--   (reason `awaiting_approval`) from this column. It is set when a run
--   enters `awaiting_approval` (plan capability TTL + approval TTL from
--   the entry instant) and cleared when it leaves, mirroring the hold
--   lifecycle constraint.
-- * prior_resume_attempts: the resume-attempt count of the most recent
--   hold episode, carried across episodes. `hold.resumeAttempts` alone
--   cannot accumulate because the hold is cleared when a run leaves
--   `held`; this column is rewritten with the same value whenever a hold
--   is written, so a run that falls back to `held` after a resume can
--   seed its new hold with the previous count + 1 (design §8.6). NULL
--   means the run has never been held.
--
-- Idempotent: safe to apply twice (the CI concurrency suite applies
-- migrations repeatedly against a real Postgres).

alter table public.origin_agent_runs
  add column if not exists approval_deadline_at timestamptz;
alter table public.origin_agent_runs
  add column if not exists prior_resume_attempts integer;

-- Backfill rows that predate this migration so the lifecycle constraint
-- below holds for them: a run already waiting for approval gets the
-- latest instant an approval could still have been completed from its
-- last update (plan TTL 10 minutes + approval TTL 2 minutes), and a held
-- run's prior count starts from its current hold.
update public.origin_agent_runs
  set approval_deadline_at = updated_at + interval '12 minutes'
  where status = 'awaiting_approval' and approval_deadline_at is null;
update public.origin_agent_runs
  set prior_resume_attempts = (hold ->> 'resumeAttempts')::integer
  where status = 'held' and prior_resume_attempts is null and hold is not null;

alter table public.origin_agent_runs
  drop constraint if exists origin_agent_run_approval_deadline_lifecycle;
alter table public.origin_agent_runs
  add constraint origin_agent_run_approval_deadline_lifecycle
  check (
    (status = 'awaiting_approval' and approval_deadline_at is not null)
    or
    (status <> 'awaiting_approval' and approval_deadline_at is null)
  );
alter table public.origin_agent_runs
  drop constraint if exists origin_agent_run_prior_resume_attempts_range;
alter table public.origin_agent_runs
  add constraint origin_agent_run_prior_resume_attempts_range
  check (prior_resume_attempts is null or (prior_resume_attempts between 0 and 100000));
