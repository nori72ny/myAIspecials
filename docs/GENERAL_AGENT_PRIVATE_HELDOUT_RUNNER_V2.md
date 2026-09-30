# ORIGIN General Agent — Private Held-Out Runner V2

Status: official candidate-side private execution runner for the independent General Agent round.

## Purpose

This runner executes private evaluator-owned tasks against the real Agent V3 HTTP contract without exposing task goals, tool parameters, or hidden expectations to the repository, workflow metadata, or public artifacts.

## Private corpus boundary

The evaluator supplies a gzip+base64 corpus through the GitHub Actions secret `ORIGIN_GENERAL_AGENT_PRIVATE_CORPUS_GZIP_B64`.

The corpus contains 12–24 tasks. Each task is bound to:

- exact candidate SHA;
- opaque task ID and SHA-256 private task digest;
- wall-clock budget;
- required benchmark capabilities;
- expected terminal state;
- recovery / approval / stop-cancel requirements;
- private goal;
- expected Agent V3 tool;
- private tool parameters;
- action (`execute`, `cancel-before-approval`, or `cancel-after-approval`);
- exact allowed changed paths and regression check where repository writes are expected.

The digest covers the private goal, tool, params, action and public scoring metadata. Modifying the private task after sealing invalidates its digest.

## Fixed permission profile

The runner publishes one stable permission-profile digest for all participants. The profile fixes:

- external network disabled inside the zero-cost Agent kernel;
- repository read allowed;
- repository writes only after exact authenticated approval;
- allowlisted test/typecheck/lint/build verification;
- external writes forbidden;
- paid fallback forbidden;
- max cost USD 0;
- the exact Agent V3 tool set.

Reference agents must be evaluated under an equivalent permission envelope and use this same digest in the trusted comparison packet.

## Real execution path

For each task, the runner starts the actual `createAgentOrchestratorV3Router` in the disposable CI checkout and calls:

1. `/api/agent/v3/plan`;
2. approval-boundary probe when required;
3. `/api/agent/v3/approval`;
4. `/api/agent/v3/execute` or `/api/agent/v3/cancel` according to the sealed task;
5. a post-cancel execution probe for stop/cancel tasks.

Positive benchmark events are emitted only from observed evaluator results. Candidate self-reported booleans are not accepted.

Recovery credit is emitted only when the Agent V3 checkpoint reports `self_fixed`; a recovery-required task that does not actually self-fix remains unsolved.

Repository mutations are checked against the sealed allowlist. Unexpected paths become `unapproved-external-write`. Write tasks must also specify an allowlisted regression check.

## Sanitized outputs

The workflow uploads only:

- `public-tasks.json` — public scoring metadata and task digests;
- `candidate-trusted-evidence.json` — evaluator-owned event ledgers, without private goals/params;
- `candidate-score-summary.json` — solved count and blockers by opaque task ID.

The private corpus is never uploaded.

## Official workflow

Workflow: `.github/workflows/general-agent-private-heldout-v2.yml`

It is manual-only and main-only. `candidate_sha` must equal `github.sha` and the checked-out HEAD exactly.

## Next comparison step

The independent evaluator gives the same public task identities, time budgets and permission-profile digest to at least two strong reference agents, captures their trusted task evidence, and runs:

```sh
npm run eval:heldout-agent:trusted-comparison -- <trusted-comparison-evidence.json>
```

A candidate-side runner pass alone is not a superiority result.
