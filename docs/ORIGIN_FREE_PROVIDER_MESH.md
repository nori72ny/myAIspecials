# ORIGIN Free Provider Mesh

## Purpose

ORIGIN keeps the $0 boundary while reducing avoidable single-provider failures. The primary route remains the audited OpenRouter `:free` model. A Gemini free-tier route is a bounded secondary route, not an unrestricted fallback.

## Route order

1. OpenRouter — primary, exact audited free model, ZDR/data-collection-deny policy.
2. Gemini — secondary, only when `ORIGIN_GEMINI_FREE_ONLY=true` and `GEMINI_API_KEY` is configured.

The secondary route is attempted at most once per user request. ORIGIN never retries the same provider in a loop.

## Gemini privacy boundary

Google's current Gemini pricing documentation lists `gemini-2.5-flash` as free of charge on the Free Tier, while also stating that Free Tier content may be used to improve Google products. Therefore ORIGIN does **not** label Gemini as ZDR or `dataCollection:"deny"`.

The secondary route is blocked for prompts containing obvious credentials, secrets, financial identifiers, confidential markers, or similarly sensitive terms. This is a conservative egress guard, not a complete privacy classifier.

## $0 boundary

The route requires an explicit operational flag `ORIGIN_GEMINI_FREE_ONLY=true`. ORIGIN does not select a paid Gemini model, enable Google Search grounding, or use paid-only tools in this route. If the free-tier operational condition cannot be established, Gemini is disabled and ORIGIN fails closed.

An environment flag cannot cryptographically prove the account's billing state; the production Google AI Studio project must therefore remain on the Free Tier. Paid-tier upgrades must never be made for ORIGIN.

## Failure behavior

- OpenRouter 429/408/5xx/timeout → one Gemini attempt if the privacy and free-tier guards pass.
- OpenRouter policy/cost/routing violation → no Gemini fallback.
- Sensitive prompt → no Gemini fallback.
- Gemini failure → return the existing graceful failure envelope; no retry amplification.

## Evidence

Every successful secondary execution records provider `Gemini`, exact model `gemini-2.5-flash`, `attempt:1`, `fallbackUsed:true`, and strategy `bounded-secondary`. Cost evidence remains `$0`.
