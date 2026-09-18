# ORIGIN — Final Unseen Completion Acceptance Checklist

## Purpose

Use this checklist immediately after the official V1.4 final unseen qualification run appears. It is a post-run acceptance checklist only; it must not be used to alter the official corpus or tune the frozen participant before the result is recorded.

## A. Provenance

- [ ] Workflow name is `V1.4 final held-out coding qualification`.
- [ ] Run branch/ref is `main`.
- [ ] Run attempt is the first official attempt.
- [ ] Base SHA is exactly `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`.
- [ ] Main did not move before the official run.
- [ ] Corpus was authored independently after the runner was frozen.
- [ ] Engineering assistant did not observe private goals, hidden tests, expected patches, or solutions before the run.

## B. Corpus shape

- [ ] Exactly 6 official tasks.
- [ ] At least 2 recovery-required tasks.
- [ ] Required coverage families are present.
- [ ] Unique task IDs/digests.
- [ ] Uniform base SHA.
- [ ] Uniform time budget where required.
- [ ] No pilot/test corpus reuse.

## C. Execution integrity

- [ ] Participant is ORIGIN only.
- [ ] Free-only path is enforced.
- [ ] No paid fallback.
- [ ] MAX_RETRIES / request-budget constraints remain intact.
- [ ] Per-task provider execution cap is respected.
- [ ] Overall provider execution cap is respected.
- [ ] No secret exposure in logs/artifacts.
- [ ] No engineering intervention during the official run.

## D. Evidence

- [ ] Public evidence artifact exists.
- [ ] Artifact name matches the documented held-out final evidence pattern.
- [ ] `held-out-final-evidence.json` is present.
- [ ] Workflow run ID is recorded in the evaluator handoff issue.
- [ ] Corpus digest is recorded.
- [ ] Attempted count is recorded.
- [ ] Solved count and solve rate are recorded.
- [ ] Recovery outcomes are recorded.
- [ ] Verification axes are recorded.
- [ ] Provider request count is recorded.
- [ ] Total cost USD is recorded.

## E. Result handling

- [ ] Raw evidence is frozen before any tuning.
- [ ] No thresholds/parity claims are invented beyond the recorded evidence.
- [ ] Failures are preserved, not rewritten.
- [ ] Any rerun is labeled audit evidence, not unseen evidence.
- [ ] Result is separated from later competitor benchmarking.

## F. Release trigger

Only after A–E are satisfied:

- [ ] Inform owner that final unseen evaluation is complete.
- [ ] Ask owner for answer-accuracy reference data.
- [ ] Open the post-held-out answer-quality implementation phase.
- [ ] Do not tune against the official held-out corpus.
- [ ] Use the separate answer-quality benchmark for before/after measurement.
- [ ] Integrate the already validated UI/UX stack only after the new answer-quality slices are validated.
- [ ] Run full release gate before merging to main.

## G. Production trigger

Production promotion is allowed only when:

- [ ] post-held-out answer-quality benchmark is frozen;
- [ ] answer-quality implementation has passed its dedicated tests;
- [ ] UI/UX stack integration is complete;
- [ ] full CI/security/browser/release gates pass;
- [ ] cost remains USD 0;
- [ ] no paid fallback exists;
- [ ] no secret leakage is detected;
- [ ] production SHA can be matched exactly to main.
