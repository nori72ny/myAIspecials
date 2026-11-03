# ORIGIN downstream zero-cost release-gate audit — 2026-11-03

Status: read-only source audit on PR #1083 head `a5c8a0ca120be061b706b51e14426bb030c6a583`.
Scope: locate release/promotion paths that still accept booleans or synthetic numeric zero values rather than the shared cost-evidence contract.
No production, provider, billing, secret, or account operations were performed.

## Executive finding

PR #1083 correctly makes the AQ benchmark qualification hard gate `zeroCost: false` with `costEvidenceStatus: NOT_MEASURED`, and its release report blocks with `COST_EVIDENCE_NOT_VERIFIED`. However, this is not yet a repository-wide migration. Several other release and quality gates still accept caller-supplied booleans such as `zeroCost: true`, and at least one held-out qualification derives zero cost from a synthetic numeric aggregate.

Do not connect the new shared cost-evidence state to these gates by copying a status string or boolean. The only acceptable future input is a runtime object accepted by `isOriginCostZeroVerifiedV1` after a trusted verifier has authenticated evidence. That verifier does not exist today, so these gates must remain blocked for any claim that requires independently verified $0.00.

## Evidence inventory

### A. AQ benchmark path — corrected by PR #1083

- `src/lib/orchestration/OriginAnswerQualityBenchmarkQualification.ts`
  - `hardGates.zeroCost` is literal `false`.
  - `costEvidenceStatus` is literal `NOT_MEASURED`.
- `src/lib/orchestration/OriginAnswerQualityOfficialShardedComparison.ts`
  - zero-cost hard gate is false and cost status remains `NOT_MEASURED`.
- `src/lib/orchestration/OriginAnswerQualityBenchmarkReleaseReport.ts`
  - Adds `COST_EVIDENCE_NOT_VERIFIED`; promotion cannot pass while the AQ cost hard gate is false.
- `scripts/summarize-aq-live-final.mjs`
  - No longer treats equal synthetic `totalCostUsd === 0` values as verified billing.
- `scripts/write-aq-final-status.mjs`
  - Requires `zeroCost === false`, `costEvidenceStatus === NOT_MEASURED`, `promotionEligible === false`, and the explicit blocker; rejects contradictory promotion.
- `scripts/write-aq-final-status.test.ts`
  - Covers the incomplete-evidence and contradictory-promotion cases.

Assessment: **CODE-PROVEN fail-closed for this AQ path**, subject to exact-head CI and the existing tests. It is not proof of actual zero spend.

### B. Answer world-class gate — boolean trust remains

- `src/release/OriginAnswerWorldClassGateV2.ts`
  - Input still includes `zeroCost: boolean`.
  - `liveEvidencePassed` is calculated from `liveProviderRunCompleted === true && zeroCost === true`.
  - A caller-supplied boolean can satisfy the cost sub-gate; no shared evidence object is consumed here.
- `src/release/OriginTrustedWorldClassQualityGateV2.ts`
  - The trusted wrapper accepts `answer.zeroCost: boolean` and forwards it to the world-class gate.
- `src/release/OriginAnswerWorldClassGateV2.test.ts`
  - The passing fixture sets `zeroCost: true`; the test verifies world-class success without a provider billing receipt.

Assessment: **MIGRATION REQUIRED**. This is a release-quality gate, not an assertion that the current AQ benchmark PR itself is promotable. The test currently encodes boolean acceptance as expected behavior.

### C. Product quality gate — boolean trust remains in two domains

- `src/release/OriginProductQualityGateV1.ts`
  - `OriginAnswerQualityEvidence.zeroCost` and `OriginCodingQualityEvidence.zeroCost` are booleans.
  - Answer promotion and coding qualification both require those booleans to be true.
- `src/release/OriginProductQualityGateV1.test.ts`
  - Passing fixtures use `zeroCost: true`; malformed boolean types are rejected, but a well-formed caller-supplied true is accepted.

Assessment: **MIGRATION REQUIRED**. Type validation prevents malformed input but does not authenticate the truth of the boolean.

### D. Held-out coding qualification — numeric sentinel remains

- `src/release/OriginHeldOutCandidateQualificationV15.ts`
  - Sets `zeroCost: evidence.totalCostUsd === 0`.
  - Includes `evidence.totalCostUsd === 0` in `qualificationPassed`.
- `src/agent/heldOutCodingFinalQualificationV14.ts`
  - Derives a local zero-cost condition from all row `costUsd === 0` values (confirmed by repository search; requires a dedicated follow-up source review before migration).

Assessment: **MIGRATION REQUIRED**. Numeric zero in a generated evaluation artifact is not an independently reconciled provider billing record.

### E. Other capability and subsystem flags

Repository search also found boolean or policy-style zero-cost flags in:
- `src/creative/rasterProviderRegistryV15.ts`
- `src/creative/rasterLiveQualificationV15.ts`
- `src/creative/cloudflareRasterSemanticCriticV15.ts`
- `src/mcp/mcpConnections.ts`
- `src/mcp/mcpProductionRuntime.ts`
- `src/legacy/originProviderClient.ts`
- `src/legacy/originProviderStreamClient.ts`
- `src/utils/zeroCostValidator.ts`

These are not all equivalent. Some are provider admission checks, local deterministic capability declarations, runtime policy checks, or status contracts rather than release-promotion evidence. They must not be bulk-rewritten based on search matches alone. Each needs classification by evidence origin and trust boundary before modification.

## Storage findings

- `src/lib/orchestration/OriginEvidenceLedger.ts` is a pure immutable in-process value builder. `appendOriginEvidence` returns a new object; it does not persist events, provide atomic durable append, or protect against rewriting the full history.
- `src/lib/local/OriginIndexedDb.ts` persists browser-local snapshots and is client-side user data storage, not a server-authoritative provider billing ledger.
- Repository search found no `@vercel/kv`, `@vercel/blob`, or `@upstash/redis` dependency/reference.
- No existing approved server-side append-only sink with durable acknowledgement, sequence allocation, access controls, and retention guarantees was established by this audit.

Assessment: **NO APPROVED DURABLE BILLING LEDGER FOUND**. This is a source-repository finding, not proof that no external account resource exists. Do not provision or enable one without explicit owner approval and independently proven $0.00 operating terms.

## Safe migration sequence

1. Keep the AQ benchmark release blocker as-is.
2. Define a repository-wide contract: release gates accept `OriginCostEvidenceV1` only through `isOriginCostZeroVerifiedV1`; booleans and serialized status strings are insufficient.
3. Migrate `OriginAnswerWorldClassGateV2` and its trusted wrapper, preserving an explicit blocker when evidence is absent/untrusted.
4. Migrate `OriginProductQualityGateV1` with separately bound evidence for answer and coding executions; do not reuse one proof across unrelated executions.
5. Migrate held-out coding qualification away from `totalCostUsd === 0` sentinel logic.
6. Audit each creative/MCP/provider policy flag individually; preserve policy admission checks while preventing them from being mistaken for billing receipts.
7. Only after an approved durable sink exists, implement attempt-level host ledger at actual HTTP egress.
8. Only after an authoritative Free-plan-compatible provider evidence source is established, implement a verifier and reconciliation tests.
9. Run the full exact-head CI suite and independent review. Until then, all release gates requiring actual $0.00 remain NO-GO.

## Explicit non-decisions

- No new database, Vercel product, Cloudflare resource, provider plan, API key, or paid service is authorized.
- No provider live request or billing query was made.
- No gate was changed in this audit; this document records the concrete migration backlog to avoid a risky repository-wide boolean replacement.
- `ZERO_COST_VERIFIED` remains without an issuer.
- AQ billing state remains `NOT_MEASURED`.
