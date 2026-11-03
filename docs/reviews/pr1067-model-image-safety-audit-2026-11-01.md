# PR #1067 model catalog and image-routing safety audit

Date: 2026-11-02
Target branch: `remediation/mobile-geometry-benchmark-health`
Base release candidate: `a43e91cbe96f07b8743735534c0d76ebd63f76df`
Scope: model evidence refresh, Cloudflare raster model allowlist, zero-cost routing and failover review.

## 1. OpenRouter free-model catalog

- `OriginFreeModelEvidence`, `OriginFreeModelId`, `OriginFreeModelCatalogResult`, and the public catalog selector function signatures remain unchanged.
- `google/gemma-4-31b-it:free` is still listed at $0.00, but its only listed free provider is Google AI Studio. Google's Gemini API free tier permits submitted content to be used to improve products and may allow human review. This is incompatible with ORIGIN's personal-data/ZDR boundary. The 2026-11-01 price-only recheck therefore does **not** refresh runtime eligibility; the existing catalog evidence remains expired and the model is not executable.
- OpenRouter's Free plan lists 50 requests/day and does not include Data Policy-Based Routing. ZDR routing is listed as available on every plan, but the exact Gemma free endpoint has not been proven to satisfy ZDR. Model price alone is not a privacy qualification. See `https://openrouter.ai/pricing`, `https://openrouter.ai/google/gemma-4-31b-it:free`, and `https://ai.google.dev/gemini-api/terms`.
- The catalog does not add `openrouter/free`, aliases, paid model IDs, or model IDs without the `:free` suffix.
- `nvidia/nemotron-3-ultra-550b-a55b:free` remains excluded. Its free endpoint disclosure explicitly permits provider logging and use for model improvement; it also asks users not to upload personal or confidential data. See `https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free`.
- Catalog pricing evidence is not request-level billing proof. Runtime must enforce `provider.zdr=true`, `data_collection=deny`, zero maximum price, disabled provider fallback, exact served-model identity, and fail-closed cost validation. Until a compliant free endpoint is independently proven, no OpenRouter model is executable.

## 2. Execution-policy integrity

- `OriginExecutionPolicy` remains `allowProviderFallbacks=false`, `dataCollection="deny"`, and `requireZeroDataRetention=true`.
- A source audit found that `zeroCostRoutingPolicy.ts` previously retried after 403/404 by removing `zdr=true` and then weakening the price fields. That contradicted the execution policy and could permit a non-ZDR provider. This PR removes all relaxation stages: one policy only (`zdr=true`, `data_collection=deny`, `max_price={prompt:0,completion:0,request:0}`, `allow_fallbacks=false`). A 403/404 is terminal; no privacy or price constraint is relaxed.
- Model catalog validity is time-bounded. Expired or invalid evidence returns a failure and must not silently select another model.
- This PR does not claim that a live inference request has been executed or that request-level $0.00 has been proven.

## 3. Cloudflare Workers AI and the 8,500-Neuron threshold

- Cloudflare's published Workers Free allocation is 10,000 Neurons per account per UTC day. ORIGIN's requested safety target is 8,500, leaving a nominal 1,500-Neuron reserve.
- The current application does not have a trusted, atomic, account-wide Neuron reservation mechanism. A model estimate, dashboard observation, or in-memory counter cannot protect concurrent serverless instances from crossing the threshold.
- Consequently, the 8,500 target is documented as a release requirement, not claimed as an enforced runtime guard. Live Cloudflare inference remains blocked until a durable shared reservation and authoritative usage reconciliation are implemented and tested.
- The Cloudflare adapter now admits only `@cf/black-forest-labs/flux-2-klein-4b`; the 9B variant is rejected before provider requests. This reduces exposure but does not replace the missing quota guard.

## 4. Image routing and free failover

- The public raster status/generate/edit routes remain fail-closed. Generation and editing return 503 until exact-request pre-inference zero-cost evidence is available.
- The World Class v1.6 image routes remain permanently disabled by zero-cost policy.
- `selectRasterProviderV15` admits a provider only when `zeroCostVerified === true`, paid fallback is false, payment method is not required, and credentials remain server-only.
- Cloudflare Free-allocation eligibility alone is not sufficient: its adapter reports `zeroCostVerified=false`. Pollinations scoped-key/model eligibility is also not sufficient; post-generation usage records have no exact request correlation key and cannot retroactively prove that dispatch was non-billable.
- No provider race, automatic retry, or fallback is allowed after ambiguous network errors, timeouts, resets, or generic 5xx responses. A fallback is permissible only after a documented pre-inference rejection and a fresh admission check for the secondary provider.
- The live qualification path remains blocked before inference when request-level cost proof is absent.

## 5. Verification required on the new PR head

- TypeScript, lint, catalog tests, execution-policy tests, Cloudflare provider tests, raster registry tests, raster router tests, and the complete PR CI must pass on the exact resulting HEAD SHA.
- The test suite must demonstrate that expired model evidence fails closed; non-`:free`/automatic model IDs are rejected; Cloudflare 9B is rejected before network access; account-level free allocation does not authorize inference; 403/404 never relax ZDR or zero-price policy; and no paid fallback is possible.
- No live image inference, paid usage, merge, or production deployment is authorized by this audit.
- The 8,500-Neuron runtime guard, live provider zero-cost proof, and 40-case image benchmark remain UNVERIFIED until their prerequisites are implemented and independently evidenced.
