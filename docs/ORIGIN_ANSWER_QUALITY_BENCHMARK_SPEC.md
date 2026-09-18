# ORIGIN — Answer Quality Benchmark Specification

## Purpose

Define the separate post-held-out benchmark used to measure answer-quality improvements. This benchmark is independent from the official V1.4 final unseen coding corpus and must never reuse or derive from those tasks.

## Benchmark families

1. Fresh factual QA
2. Multi-source research
3. Contradiction handling
4. Professional advisory response
5. Coding generation
6. Coding repair
7. Artifact-oriented response
8. Ambiguous request handling
9. Fail-closed / unsupported capability
10. Citation support integrity

## Scoring dimensions

### Factual support rate
Material factual claims with adequate evidence / all material factual claims.

### Citation support precision
Citations that directly support the associated claim / all cited claim relationships.

### Unsupported-claim rate
Material claims with no valid evidence and no explicit uncertainty label / all material claims.

### Contradiction detection
Known contradiction sets correctly surfaced without false resolution.

### Completion rate
Tasks meeting all explicit user requirements and required verification criteria.

### Verification integrity
Cases where PASS is issued only when required evidence/checks actually exist.

### Repair success
Initially failed verifications that are corrected within the bounded repair budget.

### Actionability
Whether the result contains the concrete next action, deliverable, or execution detail required by the task.

### Latency
Wall-clock runtime from accepted request to final verified response.

### Provider requests
Count of external provider executions.

### Cost
Actual USD cost. ORIGIN production target remains exactly 0.

## Hard failure conditions

A benchmark case is an automatic verification failure when any of the following occurs:

- invented execution claim;
- invented source or broken citation presented as verified;
- current fact asserted without required fresh evidence;
- paid fallback used;
- costUsd > 0;
- secret-like content serialized into public evidence;
- independent-review-required marked PASS without qualifying review/evidence;
- coding completion claimed without required code verification;
- retry/request budget exceeded;
- hidden chain-of-thought exposed.

## Benchmark versioning

Each benchmark release must record:

- benchmark ID;
- version;
- task IDs;
- task-family distribution;
- creation timestamp;
- evaluator commit SHA;
- runtime commit SHA;
- provider/model policy version.

Once a Before run begins, the benchmark version is frozen for the Before/After comparison.

## Before / After protocol

### Before
Run against the frozen pre-answer-quality implementation.

### After
Run against the exact candidate answer-quality head.

### Fairness
The same:
- task set;
- scoring code;
- provider policy constraints;
- zero-cost rule;
- time/request budgets;
- evidence rules.

No task-specific tuning after reading benchmark failures.

## Minimum reporting

Report raw counts plus rates:

- total tasks;
- factual claims;
- supported factual claims;
- cited claim relationships;
- correctly supported citations;
- unsupported claims;
- contradiction cases;
- contradiction detections;
- completed tasks;
- verifier passes/rejections;
- repair attempts/successes;
- provider requests;
- median/p95 latency;
- total cost USD.

## Promotion rule

Do not define a single vanity score as the release gate.

Promotion requires:

- no regression in hard safety/cost boundaries;
- unsupported-claim rate does not worsen;
- citation support precision does not worsen;
- verification integrity remains exact;
- completion/repair metrics improve or have a documented non-regression justification;
- full production release gate passes.

## Non-claims

This benchmark does not prove general AGI-level quality, world-best status, or superiority over another AI product. Competitor comparisons require a separate same-condition benchmark.
