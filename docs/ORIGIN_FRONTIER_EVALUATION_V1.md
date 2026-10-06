# ORIGIN Frontier Evaluation V1

Status: executable evidence contract and current-evidence policy. This document does **not** claim that ORIGIN currently exceeds any external AI system.

## Purpose

Measure ORIGIN against strong contemporary AI/agent systems without confusing engineering completion, feature count, ordinary CI, or a single successful example with measured capability.

The canonical cross-domain release evaluator is the trusted raw-evidence V2 gate:

```sh
npm run eval:world-class-quality -- <trusted-raw-evidence.json>
```

Canonical schema: `origin.trusted-world-class-quality-gate.v2`.

The legacy aggregate evaluator is diagnostics-only:

```sh
npm run eval:world-class-quality:legacy -- <aggregate-evidence.json>
```

A legacy aggregate report is never sufficient for a frontier/world-class claim.

## Global comparison rules

- Use the same task, task version, tool allowance, permission profile, time budget, retry budget, and scoring rubric for every comparable system.
- Record exact ORIGIN candidate SHA, external system/model version, evaluator version, evaluation date, corpus identity, and evidence digests.
- Vendor-reported benchmark results are reference-only unless ORIGIN is evaluated under materially equivalent conditions.
- Never turn incomparable public benchmark numbers into a synthetic head-to-head winner.
- Hidden/private cases are one-shot. Public/development cases may guide engineering but are not final proof.
- Preserve all failures in the denominator; do not cherry-pick successful runs.
- Missing evidence is `NOT MEASURED`, never zero and never an estimated score.
- Evidence from a different ORIGIN SHA does not transfer to the current SHA.
- A severe reliability, safety, privacy, approval-boundary, or zero-cost violation cannot be hidden by a high average.
- Comparative claims require controlled external evidence; ordinary unit/E2E/Lighthouse/security success proves engineering health, not external superiority.

## Canonical executable domain gates

### 1. Answer / response quality

Absolute quality:

```sh
npm run eval:trusted-answer-quality-v2 -- <trusted-execution.json> <independent-score-bundle.json> [output.json]
```

Blind comparative quality:

```sh
npm run eval:trusted-answer-blind-v2 -- <trusted-execution.json> <trusted-blind-bundle.json> [output.json]
```

Final evidence must bind all 48 exact answers to the same candidate SHA, corpus digest, round ID, trusted result digest, rubric digest, score bundle, reference answer digests, and blind vote matrix.

Required comparison boundary:
- 48 sealed cases;
- at least 3 controlled external reference systems;
- at least 2 independent source-blind judges;
- exact-answer binding for every comparison;
- visual/readability evidence where required by AQ V2;
- live provider execution with verified USD 0 under the ORIGIN Personal free-only contract.

Research/browsing cases additionally track citation correctness, source authority, unsupported-claim rate, freshness, and answer completeness. Stable reasoning/calculation tasks must not be failed merely because live research is unavailable.

### 2. Coding

Development/diagnostic scorer:

```sh
npm run eval:heldout-coding -- <input>
```

Trusted external comparison:

```sh
npm run eval:heldout-coding:trusted-comparison -- <trusted-candidate-evidence.json> <trusted-reference-evidence.json> [output.json]
```

Use private repository tasks, equal base commits, hidden tests, equal time budgets, fixed evaluator versions, retained failures, regression checks, recovery-designated tasks, and publication/deployment side-effect checks.

### 3. General Agent / long-horizon autonomy

Private candidate execution:

```sh
npm run eval:heldout-agent:private -- <private-task-input>
```

Trusted comparison:

```sh
npm run eval:heldout-agent:trusted-comparison -- <trusted-comparison-input.json> [output.json]
```

The private runner is one-shot per sealed corpus identity. Repeated execution of the same private corpus is not acceptable evidence. Track completion, intervention count, recovery success, unsafe action rate, unnecessary tool use, approval-boundary compliance, and stop/cancel behavior.

### 4. Image

Public benchmark evaluator:

```sh
npm run eval:image-blind-quality -- <comparison-packet.json>
```

Private candidate runners:

```sh
# Zero-cost V1.5 Cloudflare raster path
npm run eval:image-private -- <private-corpus-input>

# V1.6 publication candidate path (OpenRouter Image API)
npm run eval:image-private-world-class -- <private-corpus-input>
```

The V1.6 runner is the required candidate-side evidence path for any claim about the V1.6 world-class route. It must execute the same `/api/creative/v1.6/world-class/generate` route intended for publication, bind to exact current-main SHA, run the sealed 24-case corpus once, require explicit paid-evaluation approval, and enforce both per-image and total-round cost caps. The V1.5 zero-cost runner cannot qualify the V1.6 route.

Measure instruction adherence, composition, realism/style execution when applicable, text rendering, edit preservation, identity/object consistency, anatomy/object integrity, artifact rate, usefulness, delivery integrity, and source-blind preference. Bytes returned alone are not success.

### 5. Artifacts

Public benchmark evaluator:

```sh
npm run eval:artifact-blind-quality -- <comparison-packet.json>
```

Private candidate runner:

```sh
npm run eval:artifact-private -- <private-corpus-input>
```

Measure format validity, requirement fidelity, correctness, completeness, information design, aesthetics, editability, responsive behavior where relevant, delivery integrity, and whether the result is immediately usable rather than merely generated.

### 6. Product / release quality

Normal CI, security, browser isolation, responsive checks, Lighthouse, Production SHA verification, runtime smoke tests, privacy/security checks, and USD 0 invariants are mandatory release evidence.

They are hard gates but are not substitutes for the comparative domain evidence above.

## Frontier evidence state model

Every domain is one of:

- `QUALIFIED`: exact-current-SHA absolute and comparative evidence satisfies the domain contract;
- `FAILED`: exact-current-SHA measured evidence exists and misses a required threshold or hard blocker;
- `NOT MEASURED`: exact-current-SHA evidence is missing, stale, incomplete, consumed, or belongs to another SHA.

There is no inferred `PASS` from historical candidates.

## Current-main interpretation

The repository contains mature trusted-evaluator infrastructure for Answer, Coding, General Agent, Image, and Artifact domains, including exact-SHA binding, one-shot/private boundaries, and a canonical raw-evidence V2 cross-domain gate.

However, after any new main commit, including correctness/security/artifact-only changes, prior frontier qualification does not automatically carry forward. Until a fresh exact-current-main evidence packet exists, the public Frontier status for that domain remains `NOT MEASURED`.

Historical failed or partial AQ rounds remain useful engineering evidence, but they are not current-SHA qualification. In particular, an older run that exposed truth/evidence-usability weaknesses may guide regression work without being reused as final evidence after subsequent fixes.

## Minimum hard blockers

A release/domain cannot be described as frontier-complete if any of these are unresolved:

- production-critical task failure;
- unsafe or unauthorized action;
- paid fallback or non-zero-cost path under the ORIGIN Personal free-only contract;
- secret exposure or candidate access to sealed evaluator material beyond the current case;
- material mobile/accessibility blocker for a user-visible domain;
- benchmark harness that permits retries, corpus reuse, leakage, answer substitution, or cherry-picking contrary to its declared protocol;
- missing exact-current-SHA binding;
- missing controlled external reference evidence where the domain requires comparison.

## Comparison report contract

For every tested external system preserve and report:

1. exact comparable tasks completed;
2. raw score and denominator;
3. tool, permission, retry, and time conditions;
4. statistically meaningful uncertainty where applicable;
5. task-level wins/losses/ties without inventing scores for untested domains;
6. root causes for ORIGIN losses;
7. non-held-out development fix candidate;
8. fresh sealed/private retest result;
9. all hard-gate violations independently of average score.

## Evidence storage

Every evaluation run must preserve, directly or through digest-bound trusted storage:

- corpus/version identity and SHA-256 digest;
- exact candidate SHA;
- production SHA when relevant;
- permission/tool profile;
- timestamps and expiry;
- evaluator/grader version;
- raw task outcomes;
- exact answer/result digests;
- external participant identities or stable anonymized IDs;
- failure taxonomy;
- cost/free-only attestation;
- final packet digest.

Private prompts, evaluator notes, credentials, and sealed corpus payloads must remain outside public artifacts.

## Improvement loop

When ORIGIN loses or fails a threshold:

1. classify the failure from trusted evidence;
2. reproduce the defect using non-held-out development cases;
3. repair routing, prompting, planner/tool workflow, critic, renderer, or UX as appropriate;
4. add deterministic regression coverage;
5. complete normal exact-head CI/security/browser gates;
6. freeze or ingest a fresh independent private comparison round;
7. rerun once under the declared protocol;
8. bind the resulting evidence to the new exact SHA.

The goal is measured product improvement, not leaderboard gaming.