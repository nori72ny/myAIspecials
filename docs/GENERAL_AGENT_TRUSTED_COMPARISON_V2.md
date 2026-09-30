# ORIGIN General Agent — Trusted Multi-Reference Comparison

Status: evaluator-integrity infrastructure. This does **not** claim that ORIGIN currently outperforms another general-purpose agent.

## Purpose

The existing held-out General Agent benchmark already scores ORIGIN from evaluator-owned events, but reference-agent results were accepted as aggregate summaries. This layer makes both sides use the same evidence standard.

## Required round evidence

A qualifying comparison binds all participants to:

- the same exact candidate/base SHA;
- the same private held-out task packets and task digests;
- the same per-task time budgets;
- one evaluator-controlled permission-profile digest;
- the same planning, tool-choice, execution, verification, recovery, approval and stop/cancel expectations.

The round evidence itself has a bounded lifetime, evaluator ID, evidence ID and SHA-256 artifact digest.

## Candidate and reference evidence

ORIGIN and every reference agent supply one `origin.general-agent-trusted-evidence.v1` evaluator event ledger for every private task.

Positive planning/tool/execution/verification/recovery/approval/stop evidence is accepted only from evaluator-owned events. Cost attestations and terminal outcomes are validated by the existing trusted evidence builder.

Each reference system additionally requires:

- `source=controlled-external`;
- `independentFromCandidate=true`;
- the exact same permission-profile digest;
- bounded evidence validity timestamps;
- evidence ID and SHA-256 artifact digest.

The evaluator rebuilds every run and recomputes solved, regression, unsafe-action and recovery totals before invoking the existing strongest-reference comparison.

## CLI

```sh
npm run eval:heldout-agent:trusted-comparison -- <trusted-comparison-evidence.json>
```

## Remaining real-world requirement

A passing software gate is not comparative proof by itself. An independent evaluator still has to execute at least 12 private multi-step tasks against ORIGIN and at least two strong reference agent systems under identical task packets, permissions and time budgets.
