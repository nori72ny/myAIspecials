# PR #1067 model catalog and image-routing safety audit

Date: 2026-11-01
Target branch: `remediation/mobile-geometry-benchmark-health`
Base release candidate: `a43e91cbe96f07b8743735534c0d76ebd63f76df`
Scope: model evidence refresh, Cloudflare raster model allowlist, zero-cost routing and failover review.

## 1. OpenRouter free-model catalog

- `OriginFreeModelEvidence`, `OriginFreeModelId`, `OriginFreeModelCatalogResult`, and the public catalog selector function signatures remain unchanged.
- The only executable model remains `google/gemma-4-31b-it:free`. Its public OpenRouter model page lists the exact `:free` variant at $0.00. Evidence window refreshed to 2026-11-01 through 2026-11-11.
- The catalog does not add `openrouter/free`, aliases, paid model IDs, or model IDs without the `:free` suffix.
- `nvidia/nemotron-3-ultra-550b-a55b:free` is not admitted to the executable catalog. The free endpoint disclosure allows provider logging and use for model improvement; current evidence does not establish compatibility with ORIGIN's ZDR and data-collection-deny requirements.
- Catalog pricing evidence is not request-level billing proof. Runtime must continue to enforce `provider.zdr=true`, `data_collection=deny`, zero maximum price, disabled provider fallback, exact served-model identity, and fail-closed cost validation.

## 2. Execution-policy integrity

- `OriginExecutionPolicy` remains unchanged: OpenRouter remains the deterministic primary; `allowProviderFallbacks=false`, `dataCollection="deny"`, and `requireZeroDataRetention=true`.
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
- The test suite must demonstrate that expired model evidence fails closed; non-`:free`/automatic model IDs are rejected; Cloudflare 9B is rejected before network access; account-level free allocation does not authorize inference; and no paid fallback is possible.
- No live image inference, paid usage, merge, or production deployment is authorized by this audit.
- The 8,500-Neuron runtime guard, live provider zero-cost proof, and 40-case image benchmark remain UNVERIFIED until their prerequisites are implemented and independently evidenced.
