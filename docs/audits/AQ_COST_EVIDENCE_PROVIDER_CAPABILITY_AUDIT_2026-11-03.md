# ORIGIN AQ cost-evidence provider capability audit — 2026-11-03

Status: source/documentation audit only. No provider API calls, account access, billing queries, credential reads, or paid operations were performed.

## Decision

**Do not implement a ZERO_COST_VERIFIED issuer for OpenRouter from the evidence currently available to the application.**

The existing ORIGIN cost-evidence contract correctly has no public constructor for `ZERO_COST_VERIFIED`. Keep that state unreachable until a trusted verifier can authenticate provider-origin usage/billing evidence and reconcile it against a complete host-side request ledger.

A successful model response, a catalog row with zero prices, `freeOnly: true`, `providerPolicy.max_price = 0`, or an application API response containing `actualCostUsd: 0` is not by itself an independently verified billing record.

## Provider capability findings

Reviewed official OpenRouter pages on 2026-11-03:

1. Support / usage accounting: https://openrouter.ai/support/
   - OpenRouter documents per-response usage reporting when `usage: { include: true }` is requested.
   - Its support documentation describes usage accounting and Activity/credits surfaces.
   - This is useful provider-reported telemetry, but the page does not document a cryptographically signed per-request billing receipt or a public-key signature-verification scheme.
2. Pricing / plan capabilities: https://openrouter.ai/pricing
   - The Free plan advertises Activity logs and export.
   - The same plan matrix marks Management API key as unavailable on Free.
   - Therefore, do not assume the Analytics/management API can be called from an ORIGIN Free-plan environment.
3. Activity / Analytics API: https://openrouter.ai/blog/announcements/activity-dashboard/
   - OpenRouter describes an Analytics API for aggregate metrics and request-level generation data.
   - The announcement states that the API requires a management key; ordinary inference keys receive 403.
   - The public article is not evidence that this management capability is available to the Free plan.
4. Usage telemetry example: https://openrouter.ai/blog/announcements/smarter-charts-inline-svgs-and-live-usage-accounting/
   - The documented response `usage.cost` is provider-reported response telemetry, not a signed invoice or independently authenticated receipt.

## Current ORIGIN implementation observations

- `OriginCostEvidenceV1.ts` has no exported ZERO_COST_VERIFIED constructor. This is correct and must remain so.
- `OriginFreeModelLiveCalibrationV1.ts` explicitly reports `billingReceiptIndependentlyVerified: false` and `liveProofSelfReported: true`.
- `OriginFreeModelCatalogLivePreflightV1.ts` explicitly says catalog eligibility is not billing evidence.
- `OriginAnswerQualityBenchmarkSession.ts` binds every AQ case to `NOT_MEASURED/BILLING_NOT_AVAILABLE`.
- `OriginAnswerQualityBenchmarkHttpRuntimeAdapters.ts` checks application response fields such as `routing.actualCostUsd` and `routing.usage.costUsd`; these are application/provider-reported telemetry fields, not authenticated receipts.
- Existing runner fields `costUsd: 0` and provenance `totalCostUsd: 0` remain compatibility sentinels and must never be promoted into billing proof.
- In `src/legacy/originProviderClient.ts`, the transport helper can retry an individual provider request up to three times, and policy-stage requests can be attempted in sequence. The AQ coding adapter increments `providerRequests` once around `executeOriginProvider`, not once per actual HTTP attempt. Thus the current count is an invocation-level count, not a complete outbound-attempt ledger.
- The provider client requires `usage.cost === 0`, `is_byok === false`, and rejects non-zero upstream cost when present. These are useful fail-closed runtime policy checks, but the values are still returned by the provider response and are not signed receipts.
- Some broader product release-gate interfaces still accept a plain boolean `zeroCost`. Those booleans are not themselves cryptographic proof. Before connecting any new cost-evidence flow to those gates, migrate them to a verifier-issued evidence reference/status and reject caller-supplied booleans.

## Required acceptance contract before a verifier can issue ZERO_COST_VERIFIED

1. **Provider origin and authentication:** establish an official provider API or receipt format, authenticated transport, stable issuer identity, and a documented trust model. Do not invent signatures, headers, endpoints, or trust roots.
2. **Complete request ledger:** host-generated unique request IDs; append-only records at the actual HTTP transport boundary for every outbound attempt, retry, policy-stage request, fallback, tool, image, and error; exact provider generation/request IDs; timestamps; model and served-provider identity; idempotency/replay controls. Invocation-level counters are insufficient.
3. **Reconciliation:** every host attempt must map to exactly one authoritative provider usage record or a provider-confirmed no-charge terminal record. Missing, duplicate, delayed, contradictory, or unmatched records block verification.
4. **All cost dimensions:** include inference, upstream, server tools, web search, image, audio, caching, and any platform/transaction fees that are in scope. Do not infer zero from absent fields.
5. **Time and integrity:** bounded receipt age, monotonic sequence or stable provider event identity, digest/integrity checks, replay rejection, and explicit coverage window.
6. **Free-plan compatibility:** the required verification surface must be available under the user's approved Free plan without management-plan upgrade, paid credit purchase, BYOK charges, or paid fallback.
7. **Fail-closed aggregation:** only a fully reconciled, authenticated, complete set can mint a runtime-branded zero-cost evidence object. Every other condition returns `NOT_MEASURED` or `BLOCKED_UNVERIFIED`.
8. **Independent tests:** forged JSON, modified costs, omitted usage fields, retries, partial outages, delayed records, duplicate IDs, replay, clock skew, model/provider mismatch, and non-inference charges must all be rejected.

## Safe implementation sequence

- Phase A (current): keep zero-cost issuance disabled; maintain explicit `NOT_MEASURED`; block AQ promotion.
- Phase B: add a host-side append-only request ledger that records all attempts without secrets, prompts, or completions. Do not let ledger entries alone claim provider billing.
- Phase C: only after official provider documentation confirms a usable Free-plan authenticated reconciliation source, implement a provider-specific adapter and trust-root management.
- Phase D: perform read-only reconciliation on a bounded test window; compare request counts, generation IDs, and cost totals against Activity/export. Any mismatch blocks.
- Phase E: enable the verifier behind an explicit feature flag only after independent security review and regression tests. No automatic paid fallback or upgrade.

## Release effect

This audit is a **NO-GO** for `ZERO_COST_VERIFIED` and does not change production eligibility. It is not a claim that any request cost $0.00. AQ remains `NOT_MEASURED` until the required evidence exists.
