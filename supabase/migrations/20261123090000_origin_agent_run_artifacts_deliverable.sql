-- Binary deliverables for durable agent runs (artifact retrieval
-- R-2, design AGENT_ARTIFACT_RETRIEVAL_2026-11-23 §3.2-3). A
-- deliverable envelope carries its entity as base64, so the stored
-- string is larger than the entity it holds: a 512KiB entity
-- expands to 699,052 base64 characters, plus the envelope's own
-- JSON fields. The size backstop therefore gains a deliverable
-- branch sized for the stored envelope string (703,148 = the
-- base64 cap plus the store contract's envelope allowance), while
-- ordinary rows keep the original caps. The entity itself stays
-- capped by the store contract, which verifies the declared byte
-- count and digest against the decoded payload at write time;
-- artifact_bytes keeps its meaning (the stored string's byte
-- count, pinned by origin_agent_run_artifact_bytes_match).

alter table public.origin_agent_run_artifacts
  drop constraint if exists origin_agent_run_artifact_size_range;
alter table public.origin_agent_run_artifacts
  add constraint origin_agent_run_artifact_size_range
    check (
      (char_length(artifact) <= 120000 and artifact_bytes between 0 and 524288)
      or (char_length(artifact) <= 703148 and artifact_bytes between 0 and 703148 and artifact like '%"contentBase64":"%')
    );
