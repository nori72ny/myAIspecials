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
