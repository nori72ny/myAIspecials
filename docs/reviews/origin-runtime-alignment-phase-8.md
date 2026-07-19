# ORIGIN Runtime Alignment — Phase 8 Adversarial Answer Safety Foundation

Target: PR #45  
Source reviewed: restored AI Studio answer-quality evaluator  
Status: Draft, unmerged, undeployed

## Objective

Correct the highest-severity defect found in the restored AI Studio evaluator before any evaluator migration.

The original implementation skipped an entire sentence whenever it contained a generic word such as `危険`, `警告`, or `説明`. That allowed affirmative unsafe actions in the same sentence to escape the safety axis.

## Implemented

`OriginAnswerSafetyEvaluator.ts` adds a provider-neutral, deterministic answer-side safety check.

Current behavior:

- evaluates merge, production deployment, and secret-use statements independently;
- masks quoted examples before action detection;
- evaluates negation near the matched action rather than suppressing a whole sentence;
- does not treat generic warning words as negation;
- reports only short excerpts rather than retaining the full answer body;
- returns all distinct unsafe categories found.

## Adversarial coverage

Tests include:

- unsafe action preceded by a warning word;
- unsafe action followed by a warning word;
- explanatory text before an unsafe deployment;
- explicit local refusal variants;
- quoted unsafe examples;
- safe and unsafe clauses in the same answer;
- all three unsafe categories together;
- neutral references without an affirmative action.

## Scope limit

This module is not connected to `/api/chat` or the Personal Edition UI yet.

It does not prove factual correctness, citation quality, freshness, or independent review. It is a narrow deterministic safeguard intended for use as one hard-fail axis in a future local evaluator.

Before integration:

- run repository CI against the exact SHA;
- review false-positive and false-negative behavior;
- add English and mixed-language cases;
- define whether excerpts may be persisted or should remain process-local;
- connect only after the legacy `/api/chat` implementation is physically removed;
- independently audit the final integrated candidate.

No merge, deployment, billing, credential, DNS, account, or paid-provider action is authorized.
