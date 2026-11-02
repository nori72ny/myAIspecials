# ORIGIN Remaining Cost Flags Classification — 2026-11-03

Status: read-only classification audit on PR #1083 head `80bf0effad31d3bdc155f4b23e582fe621e7699c`.
Purpose: distinguish release billing evidence from admission policy and operational telemetry. No production behavior was changed in this audit.

## 20 inspection checkpoints

1. `visualBrainV15.ts` marks the local deterministic SVG provider as `verifiedZeroCost: true`; this is a local-computation/no-provider-billing assertion, not an external provider receipt.
2. The same local SVG provider advertises only `vector` and `ocr-aware`; it must not be represented as raster diffusion/image-model generation.
3. `visualBrainSelfTestV15` checks deterministic plan construction, not an external provider's billing state.
4. `rasterLiveQualificationV15.ts` explicitly states that Cloudflare account-level Free allocation preflight is not request-correlated usage evidence.
5. `cloudflareRequestCostEvidenceAvailableV15()` currently returns false, preventing live qualification before quota is spent when exact request cost cannot be proved.
6. Raster live qualification therefore remains blocked with `CLOUDFLARE_PER_REQUEST_COST_EVIDENCE_UNAVAILABLE`; this is the correct fail-closed posture.
7. `rasterProviderRegistryV15.ts` requires request-level `zeroCostVerified === true` before provider readiness; account-level allocation eligibility alone is insufficient.
8. `rasterImageProviderV15.ts` documents `zeroCostVerified` as per-request evidence and `freeAllocationEligible` as account-level eligibility; these are distinct concepts.
9. Pollinations status reports `freeAllocationEligible` but `zeroCostVerified: false` because the public usage API has no exact request join key.
10. Raster generation result labels its observed usage as preflight-only / request-usage-unverified rather than claiming that a nearby usage row proves the exact generation cost.
11. `cloudflareRasterSemanticCriticV15.ts` preserves the same unverified request-cost label for semantic-critic inference.
12. `rasterImageV15Router.ts` reports `freeOnly` and `paidFallbackEnabled: false` as policy configuration, while the semantic delivery gate remains disabled.
13. These raster flags are mostly admission and safety controls; they do not establish an authenticated billing receipt and should not be bulk-renamed as if they were release attestations.
14. `mcpProductionRuntime.ts` validates a configured `zeroCostEvidence` object with an evidence ID, timestamps, terms URL, declared Free plan and no paid fallback.
15. `mcpConnections.ts` checks expiry of that configured evidence before allowing an MCP server; this is a configuration/admission certificate, not a provider-signed per-call receipt.
16. MCP's `zeroCostApproved` is therefore a policy approval flag. It must not be passed into the global ORIGIN billing proof path.
17. `originProviderClient.ts` checks OpenRouter response telemetry including `usage.cost`, pricing fields and `is_byok === false`; this is useful fail-closed telemetry validation.
18. The same client constructs normalized `actualCostUsd: 0` / `usage.costUsd: 0` after upstream checks; these normalized values are not independent provider billing receipts.
19. `originProviderStreamClient.ts` applies equivalent strict usage-cost checks, but a valid response telemetry value still does not prove complete billing across retries, fallback stages, tools, or other cost dimensions.
20. `zeroCostValidator.ts` validates declared inputs and numeric values; it is a local policy validator, not a source of trusted billing evidence.

## Classification

| Area | Classification | Release billing proof? |
|---|---|---|
| Local deterministic SVG | Local no-external-provider-cost capability | No external receipt required for that local operation; do not conflate with model image generation |
| Raster Free allocation | Provider plan/quota admission | No |
| Raster request usage | Per-request telemetry currently uncorrelated | No |
| MCP zero-cost evidence | Admin/configuration policy approval | No |
| OpenRouter usage/pricing fields | Provider-reported response telemetry | No signed receipt or full-ledger reconciliation |
| Numeric cost validator | Input/policy validation | No |

## Decisions

- Do not change the raster or MCP admission flags wholesale; their current purpose is different from global billing attestation.
- Keep raster live generation blocked until exact-request evidence is available before and after inference, with no paid fallback.
- Keep MCP approval scoped to configuration admission and never treat it as global cost proof.
- Keep OpenRouter response telemetry as a useful signal, but do not mint `ZERO_COST_VERIFIED` from it alone.
- Preserve the fail-closed release-gate migrations already committed in PR #1083.
- No provider calls, paid resources, credentials, account settings, deployment or merge were performed.

## Remaining blockers

1. A durable, complete attempt ledger with one record per actual outbound fetch, retry and provider stage.
2. An authoritative Free-plan-compatible provider billing evidence source and a documented trust model.
3. Reconciliation of every attempt and cost dimension, including tools, image, semantic critic, audio, cache and provider/platform fees where applicable.
4. Independent verification and replay/duplicate detection.
5. Exact-head CI completion and review of all changes before release.
