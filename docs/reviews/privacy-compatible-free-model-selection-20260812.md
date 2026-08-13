# Privacy-compatible fixed free model selection — 2026-08-12

## Decision

ORIGIN's source default is changed to:

```text
google/gemma-4-26b-a4b-it:free
```

This is a source-only selection. No model generation was performed, so Japanese response quality, served-model identity, and runtime output conformance remain unverified pending a separately authorized smoke test.

## Required policy

The existing fail-closed provider policy remains unchanged:

```text
prompt price = 0
completion price = 0
data_collection = deny
allow_fallbacks = false
```

## Official evidence checked

- OpenRouter models API: the exact model ID was listed with prompt and completion prices of `0`.
- OpenRouter model endpoints API: the free Darkbloom endpoint was listed at prompt and completion prices of `0`; it supports `reasoning`, `response_format`, and `structured_outputs`.
- OpenRouter provider record: Darkbloom declares `training: false` and `trainingOpenRouter: false`. It declares prompt retention, so this selection satisfies the requested no-training `data_collection: deny` policy but is not represented as zero data retention.
- Google Gemma 4 model card: Gemma 4 supports more than 140 languages; the 26B A4B instruction-tuned model is included in that family.

Sources:

- https://openrouter.ai/api/v1/models
- https://openrouter.ai/api/v1/models/google/gemma-4-26b-a4b-it:free/endpoints
- https://openrouter.ai/provider/darkbloom
- https://openrouter.ai/google/gemma-4-26b-a4b-it:free
- https://ai.google.dev/gemma/docs/core/model_card_4

## Comparison

| Candidate | $0 input/output | No-training endpoint evidence | Reasoning | Structured output | Multilingual/Japanese basis | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| `google/gemma-4-26b-a4b-it:free` | Yes | Yes, Darkbloom | Yes | Yes | Gemma 4 officially supports 140+ languages; live Japanese output unverified | Selected |
| `openai/gpt-oss-20b:free` | Yes | Yes, Darkbloom | Yes | Yes | Exact official Japanese support not established in this review | Not selected |
| `inclusionai/ling-3.0-tiny:free` | Yes | Stronger ZDR evidence via Novita | Yes | Not listed by the endpoint | Exact official Japanese support not established in this review | Not selected |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | Yes | No; free endpoint notice permits collection for improvement | Yes | Not listed by the endpoint | Not material after privacy-policy failure | Rejected |

## Runtime gates retained

- The model is fixed; there is no model fallback.
- A response is accepted only when the served model exactly equals the requested model.
- A response is accepted only when reported actual cost is exactly `$0.00`.
- Secrets and authorization values must not be logged or returned.
- Evidence expires after seven days and execution fails closed after expiry.
