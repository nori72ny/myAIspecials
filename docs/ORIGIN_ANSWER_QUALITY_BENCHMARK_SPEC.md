# ORIGIN — Post-Held-Out Answer Quality Benchmark Specification

## Scope

This benchmark is independent from the official V1.4 final unseen coding qualification.

It must never contain, reconstruct, paraphrase, or derive from the private official held-out corpus.

## Objective

Measure whether the post-held-out answer-quality architecture improves verifiable answer quality while preserving:
- USD 0 production policy;
- fail-closed behavior;
- bounded provider usage;
- privacy and secret safety;
- latency discipline;
- UI clarity.

## Benchmark families

### B1 — Current factual QA
Tasks requiring recent public information.

Expected:
- freshness detection;
- current retrieval;
- primary-source preference where appropriate;
- dated evidence;
- no answer from stale model memory when verification is required.

### B2 — Multi-source research
Tasks requiring 3+ meaningful sources.

Expected:
- query decomposition;
- source diversity;
- relevance/freshness filtering;
- evidence-backed synthesis;
- no citation decoration without claim support.

### B3 — Contradiction handling
Sources intentionally disagree on material structured facts.

Expected:
- detect conflict;
- avoid unconditional assertion;
- state what remains uncertain;
- distinguish source dates/scopes.

### B4 — User-provided document reasoning
All facts come from supplied content.

Expected:
- no invented external facts;
- exact transformation when requested;
- distinguish user-provided facts from inference.

### B5 — Professional decision support
Non-political business/work decisions.

Expected:
- direct conclusion;
- assumptions;
- trade-offs;
- risks;
- actionable next steps;
- no fabricated evidence.

### B6 — Coding generation
Repository-bounded implementation tasks.

Expected:
- inspect before change;
- bounded patch;
- required checks;
- evidence-backed completion status.

### B7 — Coding repair
Initial implementation or repository state contains a failure.

Expected:
- failure observed;
- diagnosis;
- repair;
- re-run checks;
- verified only after final checks.

### B8 — Artifact generation
Document / spreadsheet / presentation / report tasks where supported.

Expected:
- requested artifact exists;
- content matches request;
- artifact status not claimed without actual file evidence.

### B9 — Ambiguity handling
Tasks with one materially missing fact versus tasks where assumptions are safe.

Expected:
- ask only when missing detail materially changes correctness;
- otherwise proceed with minimal labeled assumptions.

### B10 — Fail-closed
Provider/search/tool unavailable or evidence insufficient.

Expected:
- do not fabricate;
- blocked/unverified state;
- useful explanation and next safe action.

## Corpus size

Recommended initial frozen benchmark:
- 40 tasks total;
- 4 tasks per family;
- Japanese-first with at least 25% English tasks;
- at least 30% mobile-length user prompts;
- at least 25% multi-turn tasks.

A larger benchmark may be added later, but the first baseline corpus must be frozen before implementation scoring.

## Measurement model

### 1. Material Claim Support Rate (MCSR)

MCSR = supported material claims / all material factual claims

A claim counts as supported only if:
- evidence exists;
- evidence actually entails/supports the claim;
- evidence is sufficiently fresh for the claim;
- scope/population/time period are compatible.

### 2. Citation Precision (CP)

CP = citations that support their attached claim / all rendered citations

Decorative or unrelated citations are failures.

### 3. Unsupported Claim Rate (UCR)

UCR = unsupported material factual claims / all material factual claims

Lower is better.

### 4. Contradiction Detection Rate (CDR)

CDR = material contradictions surfaced / material contradictions present

### 5. Task Completion Rate (TCR)

TCR = tasks whose explicit required deliverable is actually completed / attempted tasks

A claimed but nonexistent artifact or unverified code change does not count.

### 6. Verification Integrity Rate (VIR)

VIR = outputs whose verification label matches actual evidence state / outputs with a verification label

Examples:
- verified + real evidence = correct;
- verified + no evidence = failure;
- blocked when evidence unavailable = correct.

### 7. Repair Success Rate (RSR)

RSR = repair-required tasks ending in verified success / repair-required tasks attempted

### 8. Fail-Closed Accuracy (FCA)

FCA = unsafe/unverifiable situations correctly blocked or qualified / all designed fail-closed situations

### 9. User Actionability (UA)

Deterministic rubric:
- 0: no usable answer/deliverable;
- 1: partially usable;
- 2: usable with important missing execution detail;
- 3: decision/action ready.

Do not present this as a subjective model-quality score outside benchmark reporting.

### 10. Efficiency

Record:
- wall-clock time;
- provider calls;
- tool calls;
- bytes/tokens when available;
- repair rounds;
- USD cost.

Production acceptance requires USD cost = 0.

## Mandatory raw evidence per task

Store:
- benchmark version;
- task ID;
- runtime SHA;
- model/provider identity where available;
- user prompt;
- final answer/artifact reference;
- evidence ledger;
- verifier result;
- tool/provider call counts;
- latency;
- cost USD;
- failure/block reason;
- benchmark scorer output.

Do not store secrets or raw chain-of-thought.

## Before / after comparison

Baseline:
- run frozen benchmark on pre-answer-quality implementation stack.

Candidate:
- run exactly the same benchmark on the candidate implementation.

Report:
- raw counts;
- metric deltas;
- per-family results;
- regressions;
- cost and latency changes.

Never hide regressions behind an aggregate score.

## Acceptance criteria

No single synthetic total score determines release.

Release candidate must satisfy all:
- no regression in fail-closed accuracy;
- no regression in secret/privacy safety;
- no paid fallback;
- cost USD remains 0;
- unsupported claim rate does not worsen;
- verification integrity does not worsen;
- coding verified semantics do not weaken;
- at least one targeted answer-quality dimension shows measurable improvement;
- no critical family regression;
- full repository release/security gates pass.

## Anti-overfitting rules

- freeze benchmark before implementation scoring;
- no task-specific production prompt branches;
- no benchmark IDs available to production logic;
- no direct copying of expected answers into runtime;
- if benchmark is edited after baseline, increment version and rerun baseline;
- official V1.4 final held-out tasks remain excluded.

## Reporting format

For each version report:
- benchmark version;
- runtime SHA;
- date;
- per-family attempted/passed/blocked;
- MCSR;
- CP;
- UCR;
- CDR;
- TCR;
- VIR;
- RSR;
- FCA;
- average UA;
- median and p95 latency;
- provider/tool calls;
- total cost USD;
- explicit regressions and limitations.
