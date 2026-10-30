# ORIGIN raster image generation: zero-cost admission policy

Status: release policy for the FREE_ONLY image lane. This document is normative for provider routing and release review.

## Non-negotiable invariants

- A generation request may run only when the selected provider and exact model are admitted to a non-billable path.
- Paid fallback is always disabled. No provider may silently switch to a paid plan, paid model, paid key, or billable overage.
- Unknown, stale, incomplete, or ambiguous pricing/quota evidence means deny the request.
- Never infer that a provider is free merely because an API key has a positive balance, the account has a trial, or a model appears in a catalog.
- Never retry an ambiguous inference request. Retry/fallback is permitted only after a documented response proves the provider rejected the request before inference was accepted.
- The UI must distinguish provider unavailable/quota exhausted from successful generation. It must not return procedural placeholder art as if it were AI output.

## Cloudflare Workers AI

- Admission must verify the account is on the bundled Workers Free usage model, the selected model is available to that plan, and no active paid Workers subscription is detected.
- The Free allocation is a hard daily limit. Exhaustion must fail closed; there is no automatic paid overage path in the Free plan.
- Account-level plan verification is not request-correlated billing evidence and does not prove that a particular generation cost exactly $0.00.
- The API does not provide a reliable real-time remaining-Neurons counter for this router. Do not promise that a provider switch will happen before the daily quota is exhausted.
- Switch to another independently admitted free provider only when a documented pre-inference error code proves that Cloudflare did not accept the inference request. Network timeouts, connection resets, generic 5xx responses, and unknown errors are ambiguous and terminal.

## Pollinations

- Admit only an exact image model whose current catalog entry proves numeric zero pricing (all applicable price fields are zero), or a narrowly validated explicit-free marker with independently audited model identity and free metadata.
- Require a server-side scoped key restricted to the exact admitted model and Quest-Pollen-only allocation. A positive Pollen budget alone is not proof of zero cost.
- Reject keys that are not verified as Quest-Pollen-only, models with any nonzero pricing variant, paid-only models, missing pricing, unknown pricing fields, or a model identity that differs from the verified catalog result.
- Before generation, capture a usage baseline. After generation, require exactly one unambiguous matching usage event for the same model with `cost_usd === 0`, `meter_source === "tier"`, and a positive output-image-token count.
- If the usage baseline or post-generation record is missing, ambiguous, delayed, or nonzero, do not mark the operation as cost-verified. Do not automatically retry the generation.
- A usage check after inference is evidence for audit and release qualification; it cannot retroactively prevent a charge. Therefore a key/model admission that is not provably non-billable before inference must be rejected.

## Routing and fallback

1. Verify provider configuration and exact model eligibility.
2. Verify non-billable account/key allocation and paid-fallback-off invariants.
3. Select one provider; do not race providers or duplicate inference.
4. Submit one generation request.
5. Permit fallback only after an explicit, documented pre-inference rejection; re-run the full admission checks for the fallback provider.
6. Persist the image bytes durably before reporting completion.
7. Record provider/model, dimensions, request outcome, and the strongest available cost evidence without recording secrets.

## Release gates

- Unit tests cover missing credentials, invalid plan/key scope, nonzero/missing model prices, paid variants, quota exhaustion, ambiguous errors, fallback selection, and duplicate-request prevention.
- CI must pass on the exact PR head.
- A live test is permitted only after the owner explicitly approves the provider, model, request count, and evidence that the request cannot incur a charge. Do not use production credentials for speculative testing.
- Do not merge or deploy while provider free-plan configuration, non-billable admission, persistence, or mobile browser behavior is unverified.
- Report cost evidence precisely: `PLAN_ELIGIBLE`, `MODEL_PRICE_ZERO`, and `REQUEST_USAGE_ZERO_CONFIRMED` are distinct claims. Never collapse them into a generic “free verified” label.
