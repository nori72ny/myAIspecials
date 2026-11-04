# Cloudflare Workers AI Free ZDR Preview Gate

Status: Preview-only implementation proposal; not production approved.

Last reviewed: 2026-11-04

## Purpose

Provide a separate, disabled-by-default preview inference path so ORIGIN can evaluate a Cloudflare-hosted model without relying on an OpenRouter endpoint whose strict ZDR eligibility is not established.

This preview does not change the Release 1 production provider decision. The Vercel production chat path remains unchanged.

## Selected fixed preview model

- Provider: Cloudflare Workers AI
- Model: `@cf/google/gemma-4-26b-a4b-it`
- Model ID is hard-coded in the preview Worker and cannot be overridden by request input or environment variables.
- Cloudflare's model page identifies this model as Cloudflare-hosted and Zero Data Retention (ZDR), with a 256K context window, reasoning, vision, and function calling.
- Cloudflare's Workers Free plan changelog lists this model among models available on Workers Free.

Official references:
- Model and ZDR: https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/
- Workers AI data usage: https://developers.cloudflare.com/workers-ai/platform/data-usage/
- Free allocation and model pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Workers Free model eligibility: https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/
- Cloudflare API token permission groups: https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- Billing API token permission: https://developers.cloudflare.com/billing/understand/billing-permissions/

## Model selection status

The current preview hard-codes Gemma 4 26B A4B as a cost-efficient baseline because Cloudflare documents it as ZDR, Free-plan eligible, multilingual, vision-capable, reasoning-capable, and function-calling capable.

Additional candidates must be included in the quality review before selecting the long-term primary model:
- `@cf/nvidia/nemotron-3-120b-a12b`: Cloudflare documents it as ZDR, reasoning-capable, function-calling capable, and available on Workers Free. It is described as an agentic model with a 256K context window. Its published token rates are materially higher than Gemma 4 (0.50/1.50 USD per million input/output tokens versus 0.10/0.30).
- `@cf/zai-org/glm-4.7-flash`: Cloudflare documents it as ZDR, reasoning-capable, function-calling capable, multilingual, and available on Workers Free, with a 131K context window. Its published token rates are 0.0605/0.40 USD per million input/output tokens.
- At an illustrative 1,000 input + 1,000 output tokens, the published neuron rates imply about 182 Neurons for Nemotron, 42 for GLM-4.7-Flash, and 36 for Gemma. This is a rate-based estimate, not measured usage or billing.

Do not interpret model size or vendor descriptions as a verified quality ranking. Keep Gemma as the current preview baseline until the same Japanese and English held-out task set is run against both models under the same Free-plan and privacy constraints. No automatic fallback or runtime model rotation is permitted. Model selection remains a manual release decision.

Official candidate references:
- Nemotron model and ZDR: https://developers.cloudflare.com/ai/models/%40cf/nvidia/nemotron-3-120b-a12b/
- GLM-4.7-Flash model and ZDR: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- Workers Free model eligibility: https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/
- Gemma model and ZDR: https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/

## Cost boundary

Cloudflare Workers Free includes 10,000 Neurons per account per day. On the Free plan, usage beyond that allocation fails with an error; it does not silently continue as free usage. On Workers Paid, usage above the 10,000-Neuron allocation is billed at $0.011 per 1,000 Neurons. Cloudflare's published pricing also lists the selected model at $0.10 per million input tokens and $0.30 per million output tokens (9,091 and 27,273 Neurons respectively). These are metered rates, not zero-priced inference.

The selected model is separately listed by Cloudflare as a Workers Free-accessible model and as a Zero Data Retention model. This establishes provider-published model eligibility, not the user's actual account plan or billing state. Cloudflare's general Workers AI data-usage commitment says standard inference inputs and outputs are not retained after processing and are not used for model training. The documented exceptions include stateful features, customer-enabled logging/caching, and legal obligations; this preview must not enable those storage features or log prompt/response content.

These are metered unit rates, not a claim that all usage is free. The $0.00 condition depends on the account actually remaining on Workers Free and staying within the 10,000-Neuron daily allocation. The application cannot independently prove the Cloudflare account plan from this Worker.

Required before enabling preview inference:
1. The owner verifies in the Cloudflare dashboard that the account is on Workers Free.
2. No Workers Paid plan, AI Gateway prepaid credits, or paid billing route is used for this preview.
3. The owner confirms the Free-plan status and enables the two preview flags only after verification. The flag is an owner attestation, not the runtime proof.
4. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as server-side secrets. The API token must be read-only and limited to `Account Settings Read`, `Billing Read`, and `Workers AI Read`; no Edit/Write permissions are required.
5. Set a cryptographically random server-side `ORIGIN_PREVIEW_TOKEN` of at least 32 characters as a Wrangler secret; it must never be placed in source, browser code, logs, or this document.
6. Before every inference, the Worker reads the account's Workers usage model, subscription list, and exact model schema. It requires `default_usage_model=bundled`, no active paid Workers subscription, and a valid schema for the fixed model. Any API permission failure, timeout, paid-plan indication, incomplete/paginated subscription response, or ambiguous response fails closed before inference. The current implementation requires the subscription list to fit entirely in the API response; it does not silently accept a partial first page. For every active Workers-scoped subscription, it requires an explicit `free`/`partners_free` rate-plan ID, an explicit numeric price of exactly `0`, and `externally_managed=false`; missing or unknown values fail closed. Unknown subscription states, malformed rows, and active rows without enough product identity to distinguish Workers from other products also fail closed rather than being ignored. Only explicitly known inactive states (`Cancelled`, `Expired`, `Failed`) are skipped. `Paid` and `AwaitingPayment` states are rejected even if the nested rate-plan metadata inconsistently claims a zero-priced Free plan.
7. Any missing or ambiguous condition keeps inference disabled.

The preview returns `actualCostUsd: null` and `costEvidenceStatus: NOT_MEASURED`. Provider usage metadata does not prove the final billed amount. Actual billing evidence remains a separate requirement.

## Execution safeguards

- The preview route is disabled by default.
- It requires `FREE_ONLY=true`, `CF_WORKERS_AI_PREVIEW_ENABLED=true`, `CF_WORKERS_AI_FREE_PLAN_CONFIRMED=true`, the Cloudflare AI binding, read-only Cloudflare account credentials, and the server-side preview token.
- One fixed model only.
- No retries, provider fallback, model fallback, or paid fallback.
- Maximum request body: 64 KiB, enforced while streaming the request body.
- Maximum prompt length: 12,000 characters.
- Maximum output: 1,024 tokens. Busy inference requests are rejected immediately; no queue wait, retry, provider fallback, or model fallback is attempted.
- No prompt or response logging is added by this Worker.
- Unapproved browser origins are rejected.
- Provider errors fail closed.
- Every inference is preceded by read-only live verification of Workers account settings, a complete non-paginated Billing subscription list, and the exact model schema; no inference is sent if any billing evidence is incomplete or the account is not verifiably on the bundled Workers Free allocation.
- Unit tests use a mocked AI binding and do not perform live inference.

## Release boundary

This is a separate preview-only Worker configuration. It is not wired into the Vercel production chat path and does not make Cloudflare Worker a production route.

No Cloudflare deployment, account setting, plan, billing setting, API token, or secret is changed by this PR. Production enablement requires a separate security review, independent billing evidence, exact-SHA CI, owner approval, and a separate deployment approval.
