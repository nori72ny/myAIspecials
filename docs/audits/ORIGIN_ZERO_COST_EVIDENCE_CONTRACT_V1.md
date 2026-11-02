# ORIGIN Zero-Cost Evidence Contract V1

**Status:** Design contract; not implemented; not a billing attestation  
**Date:** 2026-11-03  
**Scope:** AQ V2, trusted-answer, general-agent, coding qualification, research, and any release gate that reports provider spend.

## 1. Purpose and non-goals

This contract defines the only permitted transition to an actual-spend claim of exactly USD 0.00. It separates policy configuration, absence of measurement, and independently verified billing evidence.

This document does not provision infrastructure, query a provider billing API, authorize live inference, or certify any existing run. A passing CI run validates code and tests only. A configured free tier, model suffix such as `:free`, a zero-valued response field, or a local evaluator event is not proof of actual spend.

## 2. Normative evidence states

Every run must carry exactly one state:

| State | Meaning | Permitted wording |
|---|---|---|
| `POLICY_ALLOWED` | Pre-execution policy permits only approved free routes and forbids paid fallback. No actual-spend conclusion. | “Free-only policy configured.” |
| `NOT_MEASURED` | No complete independent usage/billing evidence exists yet. | “Actual cost not measured.” |
| `BLOCKED_UNVERIFIED` | Evidence is missing, incomplete, malformed, untrusted, contradictory, expired, replayed, or cannot be reconciled. | “Cost verification blocked; do not claim $0.00.” |
| `ZERO_COST_VERIFIED` | The verifier has reconciled the complete host request ledger with authenticated provider-origin usage/billing records for the exact run and found every billable amount to be exactly zero. | “Verified provider spend: USD 0.00” with receipt reference and scope. |

Allowed transitions:

- `POLICY_ALLOWED -> NOT_MEASURED` when execution starts or a run is recorded without a completed receipt.
- `NOT_MEASURED -> ZERO_COST_VERIFIED` only through the trusted verifier.
- `NOT_MEASURED -> BLOCKED_UNVERIFIED` when evidence cannot be completed or reconciled.
- `POLICY_ALLOWED -> BLOCKED_UNVERIFIED` when preflight or execution evidence violates policy.
- `BLOCKED_UNVERIFIED` is terminal for that run. A new verification attempt must create a new audit attempt linked to the original run; it must not overwrite history.
- `ZERO_COST_VERIFIED` is immutable. Any later correction or provider adjustment revokes the receipt and creates a superseding receipt; historical records remain append-only.

No other transition is valid. In particular, callers, benchmark scripts, UI components, and scoring adapters cannot set `ZERO_COST_VERIFIED`.

## 3. Evidence provenance and trust boundaries

The verifier must receive evidence from separately controlled sources:

1. **Host request ledger:** append-only, server-controlled records created before each outbound provider attempt. Each record includes a globally unique host request ID, run ID, provider, model, attempt number, timestamp, route/policy version, and terminal outcome. The candidate executor cannot write, delete, or rewrite this ledger.
2. **Provider-origin usage/billing evidence:** authenticated records obtained from a documented provider usage/billing interface or signed provider receipt. It must identify the provider, account/project scope, model or endpoint where available, provider request/generation IDs, usage window, currency, and charge amount. A response body controlled by the candidate is not provider-origin billing evidence.
3. **Trust registry:** externally administered mapping of verifier roles to public keys, issuer identities, validity windows, and revocation status. It must not be supplied by the candidate run or bundled as a mutable candidate-controlled allowlist.
4. **Replay protection:** durable, atomic, cross-instance nonce/receipt consumption. Process-local memory, IndexedDB, local files, and per-process maps do not satisfy this requirement.
5. **Verifier-owned receipt:** generated only after all checks pass. The candidate may reference a receipt but cannot construct or self-sign a trusted receipt.

A host ledger proves which outbound attempts ORIGIN made; provider billing evidence proves what the provider recorded or charged. Both are required. Neither substitutes for the other.

## 4. Required receipt shape

The following is a logical schema, not a claim that an implementation currently exists:

```ts
type CostEvidenceStatusV1 =
  | "POLICY_ALLOWED"
  | "NOT_MEASURED"
  | "BLOCKED_UNVERIFIED"
  | "ZERO_COST_VERIFIED";

interface CostEvidenceEnvelopeV1 {
  schemaVersion: 1;
  status: CostEvidenceStatusV1;
  runId: string;
  candidateSha: string;
  provider: string | null;
  model: string | null;
  policy: {
    freeOnly: boolean;
    paidFallbackEnabled: boolean;
    maxPermittedCostUsd: string;
    policyDigest: string;
  };
  measurement: null | {
    currency: "USD";
    totalCost: string;
    hostLedgerDigest: string;
    providerEvidenceDigest: string;
    requestCount: number;
    providerRecordCount: number;
    billingWindowStart: string;
    billingWindowEnd: string;
  };
  receipt: null | {
    receiptId: string;
    verifierKeyId: string;
    issuedAt: string;
    expiresAt: string;
    signature: string;
  };
  reasonCodes: string[];
}
```

Rules:

- Money is represented as a canonical decimal string, never binary floating point. Zero must be exactly `"0.00"`; negative, exponent, NaN, infinity, alternate currency, or non-canonical values are rejected.
- `POLICY_ALLOWED`, `NOT_MEASURED`, and `BLOCKED_UNVERIFIED` must have `measurement: null` and `receipt: null`.
- `ZERO_COST_VERIFIED` requires non-null measurement and receipt, currency USD, exact total `"0.00"`, non-empty digests, positive request counts, a valid time window, and a valid verifier signature.
- The envelope is output-only from the trusted verifier. Input payloads with `status: "ZERO_COST_VERIFIED"` are never accepted as proof.
- `maxPermittedCostUsd` is a policy ceiling, not measured cost.
- Missing data must never be coerced to zero. A missing cost is `NOT_MEASURED` or `BLOCKED_UNVERIFIED`, never a numeric zero.
- A zero-cost receipt is scoped to a run, candidate SHA, provider/account, model/endpoint, request set, and billing window. It is not a universal guarantee for future runs.

## 5. Reconciliation algorithm

The verifier must fail closed unless all of the following hold:

1. The run identity, candidate SHA, provider, model, policy digest, and billing window match the trusted run manifest.
2. The host ledger is complete, append-only, integrity-checked, and contains every outbound attempt, including retries, fallback attempts, timeouts, cancellations, and failed requests that may incur charges.
3. Every host request ID maps to exactly one authenticated provider record, or to a provider-documented non-billable outcome with authoritative evidence.
4. There are no missing, extra, duplicate, malformed, out-of-window, wrong-provider, wrong-model, or wrong-account records.
5. Every billable line item and every adjustment/fee represented by the provider's authoritative evidence is exactly USD 0.00. Unknown fees, delayed billing, taxes, minimum charges, or unfinalized usage prevent a final zero-cost claim.
6. All provider evidence signatures/authentication and trust-key validity/revocation checks pass.
7. The nonce/receipt ID is consumed atomically in durable storage, preventing replay across workers and regions.
8. The verifier signs a receipt binding the exact ledger digest, provider evidence digest, run ID, candidate SHA, policy digest, and billing window.

If the provider's usage interface is delayed or does not expose all charge components, the result remains `NOT_MEASURED` or `BLOCKED_UNVERIFIED`; do not infer zero from absence of records.

## 6. Failure and adversarial test matrix

The implementation is not acceptable until automated tests prove that each case below is rejected or downgraded from `ZERO_COST_VERIFIED`:

- Missing cost field; null; empty string; numeric string; malformed decimal; negative amount; non-zero amount; non-USD currency.
- Caller-supplied `costUsd: 0`, `actualCostUsd: 0`, `freeOnly: true`, `paidFallbackUsed: false`, or `zeroCostSafe: true`.
- Candidate-generated event named `cost-attestation` without an independently trusted provider receipt.
- Missing host request ID, missing provider request ID, duplicate ID, extra provider record, unmatched retry, or hidden fallback attempt.
- Provider/model/account/run/SHA/window mismatch.
- Provider response metadata without authenticated billing provenance.
- Invalid signature, unknown/revoked key, expired key, role mismatch, altered payload, stale timestamp, replayed nonce, and concurrent duplicate receipt attempts.
- Incomplete/delayed provider billing export, unfinalized invoice, or unknown fee category.
- Verifier outage, trust-registry outage, nonce-store outage, malformed ledger, or unavailable provider evidence.
- A synthetic/no-network run incorrectly represented as provider-executed zero-cost. Such runs must use a separate execution classification and must not be presented as measured provider spend.

Positive tests must cover a complete multi-attempt run with all retries reconciled, a fully authenticated zero-cost provider ledger, and deterministic receipt verification. At least one independent evaluator must reproduce the reconciliation result from immutable evidence artifacts.

## 7. Integration requirements

Before any AQ score, held-out qualification, research result, coding result, or release dashboard can claim zero spend:

- Introduce a single typed evidence contract shared by all runners and scorers.
- Ensure all provider attempts are recorded by the trusted host boundary, not by the candidate executor.
- Preserve provider generation/request IDs at the adapter boundary and reconcile them with host IDs.
- Remove local literal-zero assignments as evidence. They may remain only as explicitly non-authoritative display defaults, never as qualification inputs.
- Rename or remove evaluator-originated `cost-attestation` events unless they carry a verifier receipt reference and are clearly marked as evaluator metadata.
- Make every scorer consume the verifier-owned receipt and reject caller-supplied cost fields.
- Ensure synthetic, blocked, skipped, and no-network runs are reported as `NOT_MEASURED` or a distinct execution class, never `ZERO_COST_VERIFIED`.
- Make UI labels reflect the evidence state. “Free-only policy” must not be rendered as “actual cost $0.00”.
- Preserve receipt and evidence digests in benchmark artifacts and qualification outputs.

## 8. Infrastructure and approval gates

The required trust registry, durable append-only ledger, provider billing adapter, and durable nonce store may require external infrastructure or account configuration. Do not provision, enable, or connect these services without explicit owner approval and a documented cost/security assessment.

Before enabling any provider evidence adapter, prove in advance that the evidence retrieval itself is available at USD 0.00 or is covered by an explicitly approved existing free allowance. Do not use live inference or billing endpoints as a test. Use documented schemas, fixtures, and offline signature/reconciliation tests until the owner separately approves any live verification procedure.

## 9. Current implementation status

As of 2026-11-03:

- This file is a design contract only.
- PR #1076 contains a verifier primitive, but no external trust registry is provisioned and the AQ runner is not integrated.
- PR #1079 is a draft gate prototype, not an end-to-end billing verifier.
- PR #1080 documents source-level false-zero paths.
- PR #1081 makes missing response cost metadata fail closed in one private runner, but its evaluator event is not independent provider billing evidence.
- No provider billing record has been independently reconciled to an ORIGIN host request ledger in this audit.
- Actual provider spend of USD 0.00 remains **UNVERIFIED**.

## 10. Acceptance gate

This contract can be marked implemented only when:

- The typed schema and transition validator are implemented and unit-tested.
- Host request ledger, provider evidence adapter, external trust registry, and durable nonce store are independently controlled.
- End-to-end reconciliation passes the positive and adversarial matrix.
- Every affected scorer and UI surface consumes verifier-owned evidence.
- Exact-head CI passes, with evidence artifacts attached.
- A read-only security review confirms no candidate-controlled path can mint a verified receipt.
- A separately approved, cost-safe verification procedure produces a real receipt for a bounded run.

Until every condition is met, the release gate must treat actual cost as `NOT_MEASURED` or `BLOCKED_UNVERIFIED`, not USD 0.00.
