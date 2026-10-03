# Frontier Coding Status Audit V1

The status audit is intentionally separate from the private held-out benchmark runner.

It classifies a completed `V1.4 final held-out coding qualification` run as follows:

- `NOT_MEASURED`: the source run succeeded without available final, task, or start-marker evidence;
- `QUALIFIED`: final evidence exists and the source qualification workflow concluded `success`;
- `FAILED`: the source workflow did not succeed, or available start/task evidence exists without final evidence. This includes interrupted evaluation and failed aggregation, even when no final report was uploaded.

This prevents a safe preflight-only skip from being interpreted as a frontier qualification pass while preserving the existing one-shot/private corpus boundary.

Expired artifacts cannot qualify a run. An incomplete artifact inventory fails the audit instead of assigning a potentially false status. This status remains a workflow-level classification, not a competitive superiority claim.

Regression verification: `node scripts/verify-frontier-status-audit.mjs`.
