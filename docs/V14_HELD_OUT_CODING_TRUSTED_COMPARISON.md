# ORIGIN V1.4 — Trusted Coding Reference Evidence

Status: evaluator-integrity infrastructure. This document does **not** claim that ORIGIN currently outperforms another coding agent.

## Why this layer exists

The round-level Coding comparison gate can compare ORIGIN against two or more reference systems, but aggregate reference counts alone are not strong enough evidence for a quality claim. A reference summary such as "5 of 6 solved" must be derived from the exact same private tasks rather than entered as an unbound number.

The trusted comparison layer therefore derives every reference summary from task-level external evaluator evidence.

## Required reference evidence

Each reference system must provide:

- `source=controlled-external`;
- `independentFromCandidate=true`;
- participant identity;
- exact base SHA;
- exact evaluator version;
- exact per-task time budget;
- bounded evidence validity timestamps;
- an evidence ID and SHA-256 artifact digest;
- one task-level result for every private task.

Each task-level result is bound to:

- exact `taskId`;
- exact private `taskDigest`;
- duration within the same budget;
- held-out identity;
- multi-file editing;
- verification;
- recovery;
- regression codes;
- unintended side-effect count.

The evaluator recomputes `attempted`, `solved`, `regressions`, recovery counts and unsafe-side-effect counts from these rows before invoking the existing comparison gate.

## CLI

```sh
npm run eval:heldout-coding:trusted-comparison -- <trusted-comparison-evidence.json>
```

The CLI is intentionally fail-closed. Missing tasks, task-digest substitution, expired external evidence, duplicate participants, hidden failed axes, or malformed side-effect evidence prevents qualification.

## Remaining real-world requirement

A passing software gate is not comparative proof by itself. The private corpus must still be authored and held by an independent evaluator, and the same task/base/hidden-tests/evaluator/time budget must be executed against ORIGIN and at least two strong reference coding systems.
