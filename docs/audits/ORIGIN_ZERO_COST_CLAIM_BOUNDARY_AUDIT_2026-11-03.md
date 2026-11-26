# ORIGIN Zero-Cost Claim Boundary Audit — 2026-11-03

## Status
Source-level audit only. No live provider call, billing API query, secret access, cloud provisioning, merge, or deployment was performed. This document does not certify any real run as USD 0.00.

## Executive finding
The codebase currently mixes three different concepts:
1. **Policy permission** — execution is constrained to free-only routing and no paid fallback.
2. **Observed response metadata** — a provider response or local result object contains a numeric cost field.
3. **Independently verified billing** — a trusted provider-origin billing/usage record is reconciled against a complete host-side request ledger for the exact run.

Only (3) can establish actual zero spend. Neither (1) nor (2) is sufficient.

## Confirmed source findings

| Area | Observed behavior | Required disposition |
|---|---|---|
| `scripts/run-general-agent-private-v2.ts` | `responseCostSafe` currently accepts a missing `costUsd` field as safe (`undefined || 0`). | Missing cost must be UNKNOWN / BLOCKED_UNVERIFIED, never zero. |
| `src/agent/heldOutGeneralAgentBenchmarkV2.ts` | Qualification accepts caller-provided `run.costUsd === 0` and `paidFallbackUsed === false`. | Qualification must consume verifier-owned attestation state, not caller assertions. |
| `src/agent/heldOutCodingFinalQualificationV14.ts` | `zeroCost` is derived from submitted score rows and `totalCostUsd` sums caller-supplied values. | Score rows are not a billing trust boundary; require run-level verified receipt reference. |
| `src/legacy/originProviderClient.ts` | Successful provider response is converted into a local result with literal `actualCostUsd: 0` and `usage.costUsd: 0`. | Treat as policy/response validation only unless independently reconciled to provider billing records. |
| `src/lib/orchestration/OriginSourceVerification.ts` | Executor-supplied record includes `actualCostUsd: 0`; validation checks the value but not a signed provider-origin receipt. | Require explicit cost evidence state and authenticated receipt reference; fail closed without it. |
| `scripts/verify-production-deployment.mjs` | PR #1073 corrects health semantics so health policy does not claim per-request measured cost. | Keep health policy checks separate from request-level billing proof. |

## Required state model
- `POLICY_ALLOWED`: free-only/no-paid-fallback policy and maximum permitted spend are configured. This is permission only.
- `NOT_MEASURED` or `BLOCKED_UNVERIFIED`: billing evidence is absent, incomplete, untrusted, unsupported, or cannot be reconciled. This is the safe default.
- `ZERO_COST_VERIFIED`: a verifier-controlled receipt proves the complete host request ledger matches authenticated provider-origin usage/billing records for the exact run, provider, model, and billing window, and every reconciled charge is exactly zero.

No missing field, TypeScript literal, environment flag, health endpoint, policy ceiling, fixture, or caller-controlled JSON may promote a run from `NOT_MEASURED` to `ZERO_COST_VERIFIED`.

## Required trusted architecture
1. A host-controlled, append-only, run-scoped request ledger records every outbound provider attempt before and after dispatch, including failed attempts and retries.
2. Provider-origin usage/billing records are obtained through a documented authenticated source; request identifiers must reconcile exactly with the host ledger.
3. A separately administered trust registry enrolls and revokes verifier keys. Candidate runtime code cannot self-enroll keys.
4. A durable atomic nonce/replay store is controlled outside the candidate process.
5. A verifier-owned receipt binds repository, immutable candidate SHA, run ID, provider, model, request IDs, billing window, raw evidence digest, and reconciliation result.
6. AQ runner, execution session, provenance, frozen artifact, run binding, evaluation bundle, and final qualification consume the same immutable receipt reference.
7. Missing/partial evidence, provider capability gaps, clock/window mismatch, duplicate IDs, unaccounted retries, or nonzero charges fail closed.

## Acceptance tests
- Missing cost field => `BLOCKED_UNVERIFIED`.
- A policy ceiling of zero without billing records => `POLICY_ALLOWED`, not `ZERO_COST_VERIFIED`.
- A local response object with `costUsd: 0` but no authenticated receipt => `BLOCKED_UNVERIFIED`.
- Missing, extra, duplicate, malformed, or out-of-window provider request IDs => fail closed.
- Any nonzero line item or unaccounted host request => fail closed.
- Replayed or expired receipt => fail closed.
- Candidate-controlled verifier callback, trust registry, or nonce store => rejected as an untrusted boundary.
- Exact immutable run/SHA/provider/model/window binding is required end-to-end.

## Release decision
**NO-GO for any claim that actual provider spend is proven to be USD 0.00.** Policy-only free routing can be evaluated separately, but it must not be described as measured zero cost. PR #1079 is a useful verifier prototype, not a production trust infrastructure or integrated AQ proof.


## Source audit addendum 2 — qualification and user-facing consumers (2026-11-03)

A second pass inspected the current `main` source at baseline `a43e91cbe96f07b8743735534c0d76ebd63f76df`. These are distinct from the missing-field defect fixed on PR #1081 and remain open until trusted receipt integration is available.

| Path | Confirmed behavior | Why it is not proof | Required correction |
|---|---|---|---|
| `src/agent/heldOutGeneralAgentBenchmarkV2.ts` | `scoreGeneralAgentHeldOutRunV2` marks safety as passed when caller-provided `run.costUsd === 0` and `paidFallbackUsed === false`. | The scorer receives ordinary run JSON; no verifier-owned receipt or authenticated billing source is required. | Keep qualification blocked unless the exact run has a trusted verifier receipt. |
| `src/agent/heldOutCodingComparisonV14.ts` | `totalCostUsd` sums caller-supplied `run.costUsd`, while absent or malformed values contribute zero. | Missing evidence is silently converted to a zero contribution. | Represent cost evidence separately from amounts; unknown must block qualification and aggregation. |
| `src/agent/heldOutCodingFinalQualificationV14.ts` | `summarizeHeldOutFinalEvidenceV14` derives zero-cost status from submitted score-row `costUsd` values. | A score row is evaluator input, not an independent provider billing record. | Require one verifier receipt per run and bind the receipt digest into final evidence. |
| `src/components/personal/ResearchWorkspaceV31.tsx` | Research success validation accepts response fields `freeOnly: true`, `costUsd: 0`, and `paidFallbackUsed: false`. | These are claims in the same application response being validated. | Label this as policy/response metadata only; do not present it as measured spend. |
| `src/legacy/originProviderClient.ts` | Provider response billing metadata is checked, then the local result type is populated with literal `actualCostUsd: 0` and `usage.costUsd: 0`. | Provider-reported response metadata is not the same as a complete billing ledger; retries/segments and later adjustments may be absent. | Preserve raw provider request IDs and raw usage metadata; independently reconcile before any zero-cost certification. |
| `src/lib/orchestration/OriginAnswerQualityBenchmark.ts` | Observation schema requires numeric `costUsd === 0` and aggregates it into `totalCostUsd`. | The schema validates a number, not its provenance. | Add an evidence state/receipt reference; aggregation must reject unverified cost. |

### General-agent evaluator event is not an independent attestation

The PR #1081 branch was inspected beyond the helper itself. In `scripts/run-general-agent-private-v2.ts`, the evaluator computes `costSafe` from a policy readiness flag and explicit numeric `costUsd: 0` response metadata, then emits an evaluator-originated event named `cost-attestation`. `src/agent/trustedGeneralAgentEvidenceV2.ts` accepts that event and copies its numeric value into `GeneralAgentHeldOutRunV2.costUsd`. Therefore:

- PR #1081 correctly fixes the narrow missing-field-as-zero defect.
- It does not transform response metadata into independently verified billing evidence.
- The event name `cost-attestation` is semantically stronger than its evidence source warrants.
- Until the host request ledger and provider-origin usage verifier are integrated, this path must remain labelled policy/response metadata and must not be used for a final zero-cost claim.

Do not treat the local `LocalAtomicConsumptionStore` in the private evaluator as the required durable billing nonce ledger. It only provides process-local run-consumption behavior and does not authenticate provider billing or protect a separate verification trust boundary.

### Important distinction for provider response checks

The existing OpenRouter adapter performs useful preventive checks (free model allowlist, free-tier signals when present, upstream inference cost when present, BYOK state, and strict zero response cost). These are **CODE-PROVEN policy/response checks**, not independent post-run billing reconciliation. A missing optional provider metadata field is not evidence of zero; the adapter already fails closed for required cost and BYOK fields in the inspected path. Do not weaken these preventive checks while adding independent verification.

### Required behavior until infrastructure exists

- Policy/readiness surfaces may report `POLICY_ALLOWED`, but must not imply historical spend was measured.
- Any held-out scorer, AQ aggregator, or research result that lacks a verifier-owned receipt must report `BLOCKED_UNVERIFIED` (or remain ineligible); a caller-provided numeric zero is insufficient.
- A numeric sum must not replace missing cost evidence with zero. Unknown is not a zero-valued line item.
- The signed verifier prototype in PR #1079 must not be wired through caller-controlled trusted keys, host IDs, or nonce callbacks. The production trust boundary must be provisioned independently before integration.
- No live provider call, billing query, merge, deployment, secret, paid service, or cloud resource is authorized by this source audit.

### Evidence classification for this addendum

- **CODE-PROVEN:** the listed field checks, zero defaults/aggregations, and local provider result construction exist in the inspected source baseline.
- **TEST-COVERED:** not claimed by this source audit; existing unit tests may validate the current behavior but do not establish billing provenance.
- **UNVERIFIED:** whether any real ORIGIN run incurred exactly USD 0.00.
- **NOT IMPLEMENTED:** verifier-owned receipt propagation through general-agent, coding qualification, research workspace, and AQ observation aggregation.
- **NOT EXECUTED:** no live provider inference, provider billing API query, or production operation was performed.
