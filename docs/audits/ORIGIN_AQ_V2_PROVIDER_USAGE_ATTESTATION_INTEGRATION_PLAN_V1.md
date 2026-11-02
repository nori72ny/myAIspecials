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
