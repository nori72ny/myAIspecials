# ORIGIN AQ V2 Provider Usage Attestation Integration Plan v1

Status: implementation plan / source-level audit. This document does not claim that provider billing has been verified.

## Decision

AQ V2 must not emit, persist, compare, or qualify a `totalCostUsd: 0` value merely because a TypeScript literal, HTTP response, environment proof, or caller-provided field says zero. A zero-cost result is valid only after an independently trusted provider-origin usage statement has been verified and reconciled against an independently maintained host request ledger for the exact run.

Until the complete chain is deployed, AQ V2 zero-cost qualification is **BLOCKED / UNVERIFIED**. No live provider request is authorized by this document.

## Source-level integration map

The current branch was inspected at the following call sites:

1. `src/lib/orchestration/OriginAnswerQualityBenchmarkRunner.ts`
   - `OriginAnswerQualityBenchmarkExecutionEvidence.costUsd` is a caller-provided number.
   - `validExecution` accepts the evidence when `costUsd === 0`.
   - `runOriginAnswerQualityBenchmarkExecutionOnly` constructs `totalCostUsd: 0` after processing cases; no signed provider usage proof is required.
   - `validateFrozenExecution` recomputes the digest with a literal zero.
   - `scoreOriginAnswerQualityBenchmarkExecution` emits another literal zero.

2. `src/lib/orchestration/OriginAnswerQualityBenchmarkTwoPhaseSession.ts`
   - `runOriginAnswerQualityBenchmarkExecutionSession` calls the runner and creates provenance with `totalCostUsd: 0`.
   - `frozenSessionValid` checks a literal zero and recomputes a digest using a literal zero.
   - The frozen execution session has no verified provider usage receipt field.

3. `src/lib/orchestration/OriginAnswerQualityBenchmarkSession.ts`
   - The single-phase session creates provenance with `totalCostUsd: 0` after execution without provider billing reconciliation.

4. `src/lib/orchestration/OriginAnswerQualityBenchmarkRunProvenance.ts`
   - The constructor validates that the caller supplied zero; it does not establish where the cost value came from.

5. `src/lib/orchestration/OriginAnswerQualityBenchmarkHttpRuntimeAdapters.ts`
   - Chat adapter accepts `routing.actualCostUsd === 0` and `usage.costUsd === 0` as response assertions.
   - Research adapter accepts `body.costUsd === 0`, returns `providerRequests: 0`, and sets execution cost to zero.
   - These HTTP response fields are not provider-origin signed billing records.

6. `src/lib/orchestration/OriginAnswerQualityBenchmarkFrozenExecutionArtifact.ts`
   - The frozen artifact schema contains `totalCostUsd: 0`, but no attestation reference, signed provider statement digest, or host-ledger digest.

7. `src/lib/orchestration/OriginAnswerQualityBenchmarkQualification.ts`
   - The hard gate `zeroCost: true` follows from provenance values and comparability checks, not from an independently verified provider statement.

## Existing request-correlation signals (not yet a trusted ledger)

Additional source inspection found partial correlation signals that can reduce future integration work, but none currently satisfies the host-ledger requirement:

- `src/legacy/originChatRouter.ts` creates a host-side `requestId` (default: timestamp + UUID), logs completion/failure with that ID, and exposes it as `routing.traceId`. This is useful correlation metadata, but a console log and client-visible trace field are not an independently controlled, durable, append-only usage ledger.
- `src/lib/plugins/ai/OpenRouterPlugin.ts` reads the provider response `x-request-id` (or response `data.id`) and passes it to an optional `onUsage` callback. The callback is optional and the ID is not shown to be persisted to a trusted run-scoped ledger.
- The AQ HTTP adapter currently consumes `routing.providerAttempts` and provider response fields; it does not retrieve the provider request IDs or verify them against a host-side ledger.

Required next implementation: instrument the trusted provider dispatch boundary so it persists both host correlation ID and provider request ID (when returned), including failures/timeouts and retries. The ledger must be written server-side before the request result is returned to the benchmark adapter. If a provider does not return a stable request ID or authoritative billing API cannot reconcile it, that provider/run must remain ineligible for zero-cost attestation.

## Required end-to-end contract

### A. Host request ledger

The trusted execution boundary must create one immutable record per outbound provider request, before or at dispatch, with at least:
- unique provider request ID (or a host-generated correlation ID that the provider statement can map exactly);
- run ID, candidate SHA, provider ID, model ID, lane/case ID;
- UTC dispatch and completion timestamps;
- retry/attempt identity and terminal outcome.

The ledger must be outside candidate-controlled application data. It must be append-only or tamper-evident, and its run-scoped request ID set must be independently retrievable. A count alone is insufficient.

### B. Provider-origin usage statement

A billing/usage adapter must retrieve a complete statement from an authenticated provider billing/usage source. The statement must:
- cover the exact run and exact billing window;
- identify provider and model;
- declare completeness explicitly;
- include every billable request and exact request/correlation ID;
- include currency and exact cost per request, with unambiguous USD normalization;
- be signed by an identity enrolled out-of-band as `provider-cost-verifier`.

A response from ORIGIN's own application endpoint is not an independent provider-origin statement.

### C. Verification

Call `verifyOriginProviderUsageAttestationV1` only in a trusted verification service with:
- externally controlled trust-key registry;
- signer identity and role enrollment verified out-of-band;
- durable atomic nonce claim store;
- exact expected binding to repository, candidate SHA, corpus/rubric digests, round, artifact digest, run, provider, model, and billing window;
- exact set equality between host request IDs and provider statement request IDs.

Missing trust registry, unavailable nonce service, incomplete provider statement, unsupported provider billing API, missing request IDs, mismatched IDs, non-zero cost, or ambiguous currency must fail closed. Do not coerce missing data to zero.

### D. Runner and immutable artifacts

After verification, produce a verifier-owned receipt that includes the verified attestation digest, host-ledger digest, provider statement digest, request count, currency, billing window, and `totalCostUsd: 0`. The receipt must not be constructible from arbitrary caller JSON.

Pass this receipt through:
- single-phase and two-phase runner inputs;
- frozen execution session;
- provenance;
- frozen execution artifact and parser;
- run binding and evaluation bundle;
- qualification and release report.

All digests must bind the exact receipt bytes and exact frozen artifact bytes. Re-parsing a different object after hashing is prohibited. Qualification must require a valid receipt for both baseline and candidate runs.

### E. Request counting

The host ledger, not a response field, is the source of provider request counts. Retries count as separate provider requests. Research must not report `providerRequests: 0` for a successful provider-backed operation unless the trusted host ledger independently proves there were no provider requests (which would also require explaining how the operation was performed).

## Integration sequence and acceptance gates

1. Define a versioned host request ledger schema and trusted writer interface.
2. Add per-request IDs to execution evidence and ensure all lane adapters propagate IDs from the trusted host boundary; never infer request count from a successful HTTP response.
3. Implement the provider usage adapter only for providers that expose authoritative request-level usage records. Unsupported providers remain ineligible for zero-cost certification.
4. Deploy/enroll trust keys and a durable atomic nonce service outside the candidate application.
5. Add a verifier-owned, opaque zero-cost receipt; prevent public constructors or untrusted adapters from fabricating it.
6. Thread the receipt through both session paths, provenance, frozen artifacts, bindings, evaluation bundles, and qualification.
7. Remove literal-zero fallback paths and make absent receipts produce explicit `BLOCKED_UNVERIFIED` / qualification failure.
8. Add adversarial tests: fabricated HTTP `costUsd: 0`, fabricated `freeOnly: true`, omitted provider usage rows, extra rows, duplicate IDs, retry mismatch, non-USD currency, stale/incomplete billing windows, revoked key, role mismatch, nonce replay/race, unavailable trust store, unavailable ledger, and post-hash artifact mutation.
9. Verify the exact candidate SHA with Node 22/24, full unit tests, E2E, CodeQL, dependency review, secret scanning, browser artifact isolation, and ACOS quality gate.
10. Conduct a no-network test proving the verifier rejects missing evidence without invoking any provider.

## Safety boundaries

- No live inference, provider request, or billing API call as part of implementation tests.
- No paid API, paid fallback, new cloud resource, account/billing setting, secret, DNS, production deployment, or main merge without explicit approval.
- Never claim actual `$0.00` until provider-origin billing records and the host request ledger have been reconciled for a real run.
- Unit tests can prove rejection behavior; they cannot prove provider billing reality or deployed trust infrastructure.

## Current disposition

The verifier and provider-usage gate prototype exist, but the AQ execution path is not wired to them. The host request ledger, authoritative provider billing adapter, external trust-key enrollment, and durable nonce service are not provisioned. The release and zero-cost qualification decision therefore remains **NO-GO / UNVERIFIED**.


## Source audit addendum (2026-11-03, main baseline a43e91c)

A repository-wide symbol search expanded the call-site inventory beyond the initial seven files. The following additional paths must be included in the integration review:

- `src/lib/orchestration/OriginAnswerQualityBenchmarkExecutionRouter.ts`: creates fallback execution evidence with `providerRequests: 0` and `costUsd: 0` for blocked/error states. These values must remain explicitly non-measurement placeholders and must never be aggregated as verified usage.
- `src/lib/orchestration/OriginAnswerQualityBenchmarkScoring.ts`: copies provider request count from execution evidence but writes `costUsd: 0` into scoring observations. Scoring output must consume a verified receipt, not reassert zero.
- `src/lib/orchestration/OriginAnswerQualityBenchmarkCodingCheckoutAdapter.ts`: another producer of `OriginAnswerQualityBenchmarkExecutionEvidence`; it must report exact outbound request attempts from the trusted ledger or mark usage unavailable.
- `src/lib/orchestration/OriginAnswerQualityBenchmarkScoring.test.ts`, `OriginAnswerQualityBenchmarkRunner.test.ts`, `OriginAnswerQualityBenchmarkTwoPhaseSession.test.ts`, `OriginAnswerQualityBenchmarkOfficialScoringCollector.test.ts`: fixture producers and assertions will need coordinated updates when evidence becomes mandatory.
- `src/lib/orchestration/OriginAnswerQualityBenchmarkRunBinding.ts` and `OriginAnswerQualityBenchmarkEvaluationBundle.ts`: currently serialize `freeOnly: true` and `totalCostUsd: 0` without a provider-usage receipt digest. Both must bind the same verifier-owned receipt digest as the frozen artifact and provenance.
- `scripts/run-general-agent-research-live-v1.ts`: emits `providerRequests: 0` and `zeroCostSafe: true` in a live-research result artifact. This is a separate high-risk reporting path; it must not label a run zero-cost or claim zero requests without an independently reconciled ledger.
- `scripts/run-trusted-answer-case-v2.ts`, `src/release/OriginTrustedAnswerRunV2.ts`, `src/release/OriginAnswerTrustedCaseLeaseV2.ts`, and `scripts/preflight-trusted-answer-runtime-v2.ts`: contain typed zero-cost / request-count assertions in the trusted-answer workflow. These require their own provenance review; AQ V2 integration alone does not validate them.

### Safe integration boundary decision

Do not retrofit a caller-supplied callback or a plain `verified: true` / receipt-shaped JSON field into the runner and treat it as trusted. That would only move the self-assertion one layer deeper. The runner executes in candidate-controlled application code, while the required ledger, provider billing source, trust-key registry, and atomic nonce store are not currently provisioned. A cryptographic verifier called with caller-controlled keys or a caller-controlled nonce callback is not an independent trust boundary.

Therefore the first safe code integration must be a server-side trust boundary with credentials and storage unavailable to candidate-controlled execution, plus a narrowly scoped API that returns a signed, run-bound receipt. Until that exists, the AQ runner should report usage as unavailable / `BLOCKED_UNVERIFIED`, and qualification must not treat policy flags or local numeric zero as evidence. This is a deliberate fail-closed design decision, not a reason to invent a local mock ledger and call it production evidence.

### Evidence classification

- CODE-PROVEN: the symbol search identified the additional local zero/request-count paths above on main baseline `a43e91cbe96f07b8743735534c0d76ebd63f76df`.
- UNVERIFIED: whether any live provider request was actually billed zero; no provider billing records or host ledger were queried.
- NOT IMPLEMENTED: trusted host ledger, provider billing adapter, external trust registry, durable nonce store, verifier-owned receipt transport, and end-to-end AQ qualification integration.
- NOT EXECUTED: no live inference, billing query, deployment, merge, or external provider request was made.


## Adjacent zero-cost assertion audit addendum (2026-11-03)

A second repository-wide search on the current main baseline found additional consumers and producers outside the AQ V2 call graph. These are not covered by the AQ V2 provider-usage gate and must not inherit a zero-cost certification from it.

### Runtime readiness and UI interpretation

- `src/components/AgentWorkspaceView.tsx` treats a capability response with `freeOnly === true`, `costUsd === 0`, and `paidFallbackEnabled === false` as ready. This is a configuration/readiness predicate, not request-level billing evidence. Keep it explicitly labelled as policy readiness; do not use it as a historical spend claim.
- `scripts/run-general-agent-private-v2.ts` accepts a missing `costUsd` field or numeric zero as `responseCostSafe`, then emits a synthetic `costUsd: 0` when its local `costSafe` accumulator remains true. Missing cost must be UNKNOWN, not zero. A policy health response must not seed a measured-cost accumulator.
- `scripts/verify-production-deployment.mjs` currently expects `health.costUsd === 0`. This expectation conflicts with PR #1073's corrected health contract, where health exposes a maximum permitted cost policy and intentionally does not claim actual `costUsd`. Deployment verification must validate `maxPermittedCostUsd === 0`, `freeOnly === true`, and `paidFallbackEnabled === false` as policy only, while checking request-level cost separately from trusted evidence.

### Benchmark and research reporting

- `src/agent/heldOutGeneralAgentBenchmarkV2.ts` qualifies safety from caller-provided `run.costUsd === 0` and `paidFallbackUsed === false`. Require a trusted run receipt or report cost as UNVERIFIED; do not treat these fields as authoritative.
- `src/agent/heldOutCodingFinalQualificationV14.ts` derives `zeroCost` from submitted score rows and sums caller-provided `score.costUsd`. This is a separate qualification path requiring independent provenance and exact run-to-request reconciliation.
- `src/components/personal/ResearchWorkspaceV31.tsx` accepts a grounded result when its payload asserts `freeOnly`, `costUsd: 0`, and no paid fallback. These are response assertions unless backed by a verifier-owned receipt.
- `scripts/run-general-agent-synthetic-live-v2.ts` emits `zeroCostSafe: true`. Synthetic internal runs must distinguish “no external provider execution performed” from “provider execution independently verified at $0”; the latter must not be inferred from the former.
- `scripts/run-general-agent-research-live-v1.ts` continues to emit `zeroCostSafe: true` and `providerRequests: 0` for a live research workflow. This is not a valid measurement without the trusted host ledger; successful live research cannot default its provider request count to zero.

### Provider client and source-verification boundaries

- `src/legacy/originProviderClient.ts` and `src/legacy/originProviderStreamClient.ts` construct result objects with literal `actualCostUsd: 0` and `usage.costUsd: 0` after successful provider responses. Their strict model/provider policy checks are useful pre-execution controls, but those literals are not authenticated billing evidence.
- `src/lib/orchestration/OriginSourceVerification.ts` accepts a candidate source record with `actualCostUsd === 0`. The source-verification record needs an explicit cost-evidence state and receipt reference; source-grounding success must not imply provider billing verification.
- `scripts/run-artifact-private-heldout-v1.ts` and `scripts/preflight-trusted-answer-runtime-v2.ts` validate response-level `actualCostUsd === 0` / request-count claims. Those are test/runtime assertions, not independent provider billing reconciliation.

### Required migration rule

For every path above, separate three states instead of collapsing them into a numeric zero:

1. `POLICY_ALLOWED`: the selected execution plan is constrained to free-only, no paid fallback, and a zero maximum permitted cost.
2. `NOT_MEASURED` / `BLOCKED_UNVERIFIED`: no independently authenticated request-level billing receipt exists. Missing cost, missing IDs, or unsupported provider evidence must land here.
3. `ZERO_COST_VERIFIED`: only a verifier-owned receipt reconciles the complete trusted host request ledger with authenticated provider-origin usage/billing records for the exact run and billing window.

No TypeScript literal, response JSON field, environment flag, health endpoint, unit fixture, or policy ceiling may transition state 2 to state 3. Existing client contracts should be migrated deliberately with compatibility tests; do not make a broad mechanical replacement that could break execution semantics or hide nonzero costs.

### Exact source evidence

The audit fetched the current main versions of the files listed above and inspected the relevant cost/request-count predicates. The source findings are CODE-PROVEN as local implementation behavior only. They do not establish actual provider charges, provider billing completeness, or production deployment state. No live provider request or billing API was used.
