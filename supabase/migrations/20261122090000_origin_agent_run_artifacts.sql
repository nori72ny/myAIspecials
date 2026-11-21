-- Step artifacts for durable agent runs (step-artifact persistence,
-- PR-1). One row per (run, plan step): the intermediate output a
-- completed step produced that a later step of the same plan consumes
-- through the deterministic data-flow markers (contentFromStep /
-- contentFromPreviousArtifact). Until now those outputs lived only in
-- one advance's memory, so a producing step and its consumer had to
-- fit inside a single advance (bounded by the function time limit);
-- persisting them lets the next advance rehydrate the data flow and
-- continue from the first unfinished step.
--
-- Only artifacts a later step actually consumes are stored (the set
-- is determined statically by the plan), and a write lands only
-- inside the same fenced progress statement that records the step's
-- completion, so an advance that lost its claim writes nothing.
-- Retention follows the run itself: expires_at copies the run's own
-- expires_at, rows are swept after it passes, and deleting a run row
-- cascades. Caps mirror the store contract (the verification
-- engine's 120,000-char artifact limit, a 512KiB byte backstop and a
-- 2,000,000-char per-run total enforced by the store): oversize
-- artifacts are never truncated into compliance, they are simply not
-- saved, and the consuming step then fails exactly as it does today.

create table if not exists public.origin_agent_run_artifacts (
  run_id text not null references public.origin_agent_runs (run_id) on delete cascade,
  step_index integer not null,
  step_fingerprint text not null,
  attempt integer not null,
  artifact text not null,
  artifact_bytes integer not null,
  artifact_sha256 text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  primary key (run_id, step_index),

  constraint origin_agent_run_artifact_run_id_format
    check (run_id ~ '^run-[A-Za-z0-9-]{8,100}$'),
  constraint origin_agent_run_artifact_step_index_range
    check (step_index between 0 and 19),
  constraint origin_agent_run_artifact_fingerprint_format
    check (step_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint origin_agent_run_artifact_attempt_range
    check (attempt between 0 and 10),
  constraint origin_agent_run_artifact_size_range
    check (char_length(artifact) <= 120000 and artifact_bytes between 0 and 524288),
  constraint origin_agent_run_artifact_bytes_match
    check (artifact_bytes = octet_length(artifact)),
  constraint origin_agent_run_artifact_sha256_format
    check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint origin_agent_run_artifact_expiry
    check (expires_at >= created_at)
);

create index if not exists origin_agent_run_artifacts_expires_at_idx
  on public.origin_agent_run_artifacts (expires_at);

alter table public.origin_agent_run_artifacts enable row level security;
revoke all on table public.origin_agent_run_artifacts from public;
revoke all on table public.origin_agent_run_artifacts from anon;
revoke all on table public.origin_agent_run_artifacts from authenticated;
grant select, insert, update, delete on table public.origin_agent_run_artifacts to service_role;
