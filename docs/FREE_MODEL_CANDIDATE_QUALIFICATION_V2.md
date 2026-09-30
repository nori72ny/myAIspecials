# ORIGIN Free Model Candidate Qualification V2

Status: pre-promotion eligibility gate. Passing this gate does **not** make a model the Production default and does not prove that it is better than the current model.

## Purpose

ORIGIN currently uses a fixed OpenRouter free model under a strict $0 / fail-closed privacy boundary. Newer free models may be stronger for general reasoning, coding, research or agent tasks, but a model must not be promoted merely because its public benchmark or marketing description looks better.

V2 therefore separates two questions:

1. **Eligibility** — can the candidate be used under ORIGIN's zero-cost and privacy rules?
2. **Quality** — does the candidate actually beat the current model in AQ / Coding / Agent evaluation?

This gate answers only question 1.

## Required eligibility evidence

- exact `:free` model identity in OpenRouter's official model catalog;
- exact prompt and completion price of zero;
- fresh evidence window (maximum 7 days);
- at least two successful live synthetic calibration requests;
- `provider.zdr=true` on every request;
- `provider.data_collection=deny` on every request;
- `allow_fallbacks=false`;
- max prompt/completion/request price all pinned to zero;
- served model must equal the requested free model or its canonical non-`:free` identity;
- OpenRouter-reported usage cost must be exactly zero;
- no BYOK path;
- calibration prompts must be synthetic/public and contain no user or proprietary data.

Any unverifiable condition fails closed.

## CLI

```sh
ORIGIN_FREE_MODEL_CANDIDATE='qwen/qwen3.8-27b:free' \
OPENROUTER_API_KEY='...' \
npm run qualify:free-model-candidate:v2
```

The script writes `test-results/free-model-candidate-v2.json` by default. It uses the same OpenRouter routing policy as Production, including ZDR, data-collection deny, no provider fallback and max price zero.

## Promotion rule

`eligibleForQualityBenchmark=true` means only that the model may enter a controlled A/B benchmark. Production promotion still requires:

- AQ V2 comparison against the current model on an evaluator-owned corpus;
- Coding / Agent qualification when the model is intended for those lanes;
- no regression in safety, tool calling, structured-output compatibility or latency requirements;
- exact zero-cost evidence at the promoted revision;
- a separate reviewed change to the Production model catalog.

During the current frozen independent round for `b5fcdf6fc9138f40a9211241173efe8a0a2ee0a6`, this work remains on an unmerged branch so it cannot invalidate the candidate SHA.
