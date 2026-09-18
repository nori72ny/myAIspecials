# ORIGIN — Answer Quality Implementation Map

## Purpose

Map the post-held-out answer-quality architecture onto the current ORIGIN codebase so implementation can begin immediately after the official V1.4 final unseen result is frozen.

This document changes no runtime behavior.

## Existing assets to reuse

### Chat orchestration

Current files already provide most of the control-plane primitives:

- `src/lib/orchestration/OriginRequestIntent.ts`
  - request classification.
- `src/lib/orchestration/OriginAgentWorkPlan.ts`
  - work-plan construction and capability availability.
- `src/lib/orchestration/OriginReviewPolicy.ts`
  - decides when independent review is required.
- `src/lib/orchestration/OriginAnswerQualityPolicy.ts`
  - answer mode and verification level.
- `src/lib/orchestration/OriginAnswerEnvelope.ts`
  - conclusion / answer / evidence / verification / limitations / next actions.
- `src/legacy/originChatRouter.ts`
  - current orchestration, zero-cost routing, fail-closed behavior, answer envelope projection.

### Grounded research

- `src/research/groundedResearchV11.ts`
  - bounded source assessments;
  - retrieval-evidence-only scoring;
  - freshness tracking;
  - conservative structured conflict signals;
  - stable citation IDs.

This should become an input to a common claim/evidence verifier rather than inventing a second evidence system.

### Coding

- `src/agent/codingAgentV14.ts`
  - trusted planner / navigator / propose / verify separation.
- `src/agent/codingSessionV14.ts`
  - edit/check/repair lifecycle.
- `src/agent/codingJobWorkerV14.ts`
  - durable hosted worker and repair state.
- `src/agent/codingJobResultV14.ts`
  - strict verified result contract.
- coding tests already prove repair after failed verification.

Coding V1.4 is the strongest existing template for the new general verification contract.

## Primary architectural gap

Chat currently has rich planning metadata, but its final provider output is generally trusted after:
- zero-cost/provider policy validation;
- extraction of any self-presented HTTPS evidence;
- disclosure that ORIGIN has not independently checked that evidence.

When `OriginReviewPolicy` requires independent review, the current release usually returns `verificationStatus: "not-run"` because there is no independent free review path.

The post-held-out work should close this gap without weakening fail-closed or zero-cost rules.

## Proposed module additions

### 1. `src/lib/orchestration/OriginEvidenceLedger.ts`

Responsibilities:
- immutable append-only evidence records;
- source kind: user / retrieved-public / connected-private / deterministic-tool / code-check / provider-output;
- observed timestamp;
- source identifier;
- support relationship to one or more material claims;
- cost USD;
- verification state;
- no secrets;
- no raw chain-of-thought.

### 2. `src/lib/orchestration/OriginClaimModel.ts`

Responsibilities:
- bounded list of material claims extracted for verification;
- claim type: factual / recommendation / inference / assumption / execution-claim;
- freshness requirement;
- evidence requirement;
- consequence/risk level.

This is not a hidden-reasoning log. It is an auditable verification object.

### 3. `src/lib/orchestration/OriginVerifier.ts`

Input:
- request intent;
- answer candidate;
- material claims;
- evidence ledger;
- required verification level.

Output:
- `PASS`
- `REPAIR_REQUIRED`
- `BLOCKED_UNVERIFIED`

Checks:
- missing support;
- source/claim mismatch;
- stale evidence;
- conflicting evidence;
- unsupported execution claims;
- required independent review not performed;
- zero-cost / policy violations.

### 4. `src/lib/orchestration/OriginRepairPlan.ts`

Converts verifier failures into bounded actions:
- retrieve missing evidence;
- run an allowed deterministic tool;
- rerun a relevant code check;
- remove or weaken unsupported wording;
- mark unresolved uncertainty.

No unbounded retry loop.

### 5. `src/lib/orchestration/OriginAnswerPresenter.ts`

Produces the final envelope from verified state:
- verified facts;
- user-provided facts;
- inferences;
- assumptions;
- limitations;
- citations;
- next actions.

It must not turn a failed verification into a confident statement.

## Existing files to modify after held-out

### `src/legacy/originChatRouter.ts`

Refactor from:
`classify → plan → provider → extract self-presented evidence → envelope`

to:
`classify → plan → execute → build ledger → verify → bounded repair if allowed → present`

Preserve:
- `MAX_RETRIES = 0`;
- free-only model routing;
- current sensitive-input block;
- context minimization;
- fail-closed provider errors;
- no secret logging.

### `src/research/groundedResearchV11.ts`

Keep its source scoring semantics narrow:
- retrieval evidence only;
- no factual truth claim;
- conservative conflict detection.

Add adapters that emit common evidence-ledger records.

### Coding V1.4

Do not replace coding's existing verification contract.

Instead add an adapter:
- coding verification checks → common evidence ledger;
- `verified` remains controlled by existing Coding V1.4 rules.

General answer verification must never downgrade coding's stricter verification semantics.

## UI integration

Reuse validated UI/UX v3.1 surfaces:

- Agent action status:
  - Plan
  - Search / Read / Inspect
  - Execute
  - Verify
  - Repair
  - Deliver

- Project Sources:
  - only real evidence.
- Project Tasks:
  - real job/verifier state.
- Answer envelope:
  - verified / not verified / blocked state;
  - source links;
  - limitations.

Do not display hidden chain-of-thought.

## First implementation PR sequence after held-out

### AQ-1 — Evidence ledger foundation
Files:
- add `OriginEvidenceLedger.ts`
- add tests
- adapters from current answer evidence and research evidence.

No model behavior change yet.

### AQ-2 — Material claim contract
Files:
- add `OriginClaimModel.ts`
- claim validation tests.

Keep extraction deterministic/bounded where possible.

### AQ-3 — Independent verifier
Files:
- add `OriginVerifier.ts`
- failure matrix tests.

Initially support deterministic policy/evidence checks before adding any provider-assisted review.

### AQ-4 — Chat integration
Files:
- update `originChatRouter.ts`
- update answer envelope/routing metadata tests.

Fail closed where verification is mandatory.

### AQ-5 — Research integration
Files:
- adapter from `groundedResearchV11.ts`
- citation support tests;
- conflict-to-verifier tests.

### AQ-6 — Repair loop
Files:
- add `OriginRepairPlan.ts`
- bounded round tests;
- zero-cost exhaustion tests.

### AQ-7 — Presenter/UI state
Files:
- add presenter;
- connect verified/blocked/repair states to validated v3.1 UI.

### AQ-8 — Benchmark harness
Separate corpus and runner.
Never use the official V1.4 held-out corpus.

## Required regression tests

- self-presented citation is not treated as verified merely because it is HTTPS;
- current/fresh claims cannot pass using stale evidence;
- contradictory material evidence prevents unconditional PASS;
- execution claim cannot pass without deterministic evidence;
- independent-review-required cannot silently become PASS;
- cost must stay exactly 0;
- paid fallback remains impossible;
- retry budget remains bounded;
- secret-like data is never serialized into evidence;
- coding `verified` cannot be synthesized from general verifier output;
- repair exhaustion returns blocked/unverified rather than fabricated success.

## Definition of done

The answer-quality phase is not complete when the architecture exists.

It is complete only when:
- all new contracts have unit tests;
- separate benchmark Before/After is frozen;
- unsupported-claim rate does not regress;
- citation support improves or remains correct;
- verified task completion improves on the separate benchmark;
- latency/provider-request growth stays within defined free limits;
- full release/security gates pass;
- production remains USD 0 with no paid fallback.
