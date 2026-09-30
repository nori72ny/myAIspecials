# ORIGIN V1.4 — Held-out Coding Comparison Gate

Status: executable comparison contract. This does **not** claim that ORIGIN currently outperforms another coding agent.

## Purpose

The original V1.4 held-out scorer validates one private coding task/run. The comparison gate adds the missing round-level contract required by the world-class quality program.

A valid round requires:

- 6–24 held-out tasks;
- one exact candidate/base SHA across every task and participant;
- one uniform wall-clock budget;
- at least 2 recovery-required tasks;
- at least 2 distinct strong reference systems;
- the same evaluator version for ORIGIN and every reference;
- exact typecheck/lint/test/build verification through the existing task scorer;
- zero ORIGIN paid cost;
- zero ORIGIN Git publication or deployment side effects.

ORIGIN passes only when every recovery task is solved, solved count is at least the strongest reference, and regression signals are no worse than the strongest reference.

## CLI

```sh
npm run eval:heldout-coding:comparison -- <comparison-evidence.json>
```

The input contains only public task metadata, ORIGIN run evidence, and aggregate reference summaries. Private prompts, hidden tests, expected patches, solutions, and reference patches remain outside this evaluator.

## Reference binding

Each reference summary must match the exact:

- base SHA;
- evaluator version;
- per-task time budget;
- attempted task count;
- recovery-task count.

A mismatch fails closed.

## What this proves

A passing report is valid only for the exact evidence supplied. The gate itself is infrastructure, not comparative evidence. A fresh private round against real reference systems is still required before any superiority claim.
