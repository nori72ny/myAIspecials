# ORIGIN Frontier Evaluation V1

## Purpose
Measure ORIGIN against external AI/agent practice without confusing engineering progress with capability.

## Rules
- Same task, task version, tool allowance, time budget, retry budget, and scoring rubric for every comparable system.
- Record model/system version and evaluation date.
- Vendor-reported benchmark results are reference-only unless ORIGIN is evaluated under materially equivalent conditions.
- Never convert incomparable public benchmark numbers into a synthetic head-to-head winner.
- Hidden/private cases are one-shot. Public cases may be used for development but are not final proof.
- Report confidence and sample size with every aggregate.
- A severe reliability, safety, or zero-cost violation cannot be hidden by a high average.

## Evaluation families
### General / reasoning
Use hard, contamination-aware reasoning and instruction-following sets where licensing and reproducibility allow. Track exact/graded correctness separately from style.

### Research / browsing
Use BrowseComp-style multi-hop retrieval tasks plus citation correctness, source authority, unsupported-claim rate, freshness, and answer completeness.

### Coding
Use SWE-bench-style repository issue resolution, Terminal-Bench-style terminal work, project build/test success, regression rate, and production-equivalent smoke tests.

### Agent / long-horizon autonomy
Use METR time-horizon concepts: task difficulty expressed by competent-human completion time and success probability. Also track intervention count, recovery success, unsafe action rate, and unnecessary tool calls.

### Computer use
Use OSWorld-style desktop/web interaction tasks when an equivalent computer-use environment is available. Separate perception, planning, action execution, and recovery failures.

### Image
Track instruction adherence, composition, text rendering, edit preservation, identity/object consistency, artifact rate, and blinded human preference. Do not claim comparability from vendor showcase images.

### Artifacts
Measure whether requested documents/apps/spreadsheets/slides/code artifacts are complete, usable, editable, and faithful to requirements, not merely generated.

### Product quality
Track task success, latency, error/failure rate, recovery, accessibility, responsive UI, visual coherence, privacy/security, and $0/free-only invariants.

## ORIGIN Frontier Index
The public headline index is emitted only after sufficient measured evidence exists.

Suggested reporting dimensions:
- General / Reasoning
- Research
- Coding
- Agent
- Long-horizon autonomy
- Computer Use
- Image
- Artifacts
- Reliability
- UI/UX
- Visual Design
- Safety / Privacy
- Speed
- Cost efficiency

Each dimension stores raw metrics before normalization. Missing evidence remains NOT MEASURED, never zero and never an estimated score.

## Minimum gates
A release cannot be described as frontier-complete if any of these are unresolved:
- production-critical task failure
- unsafe or unauthorized action
- paid fallback or non-zero-cost path under the ORIGIN Personal free-only contract
- secret exposure
- material mobile/accessibility blocker
- benchmark harness that permits retries or leakage contrary to its declared protocol

## Comparison output
For each tested peer system report:
1. exact comparable tasks completed
2. raw score and denominator
3. tool/retry/time conditions
4. statistically meaningful uncertainty where applicable
5. ORIGIN wins, losses and ties by task, without inventing scores for untested domains
6. root causes for losses
7. improvement candidate
8. sealed re-test result

## Evidence storage
Every evaluation run should preserve: corpus/version hash, candidate SHA, production SHA when relevant, configuration, timestamps, raw outcomes, grader version, and failure taxonomy.
