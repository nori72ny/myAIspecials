# ORIGIN Free Provider Boundary

## Purpose

ORIGIN keeps the $0 boundary without sending a request to a second provider after a failure. The production chat route uses only the exact audited OpenRouter `:free` model and fails closed when that route is unavailable.

## Active route

1. OpenRouter — exact audited free model.
2. Provider selection is constrained to endpoints satisfying ZDR, `data_collection:"deny"`, and maximum price $0.
3. ORIGIN performs no automatic cross-provider fallback and no same-provider retry.

## Quality-first rule at permanent $0

ORIGIN does not optimize for the cheapest answer because the allowed cost is already fixed at exactly $0. Within that hard boundary, it optimizes for the strongest currently evidenced result.

- The runtime quality objective is `max-quality-within-verified-zero-cost`.
- A different free provider/model may replace the current audited route only when current task-specific comparative evidence shows a material quality improvement and its pricing/privacy/authentication evidence is also valid.
- “Free tier”, “free credits”, or a provider marketing label are not sufficient proof. Successful provider-backed execution must still resolve to actual cost USD 0 under the authoritative runtime evidence for that route.
- When comparative quality evidence is absent, stale, tied, or not production-compatible, ORIGIN keeps the safer audited route and makes no superiority claim.
- Quality should first be improved with $0 local work: planning, source checking, structured critics, deterministic validation, file reopen/render checks, code typecheck/lint/test/build, and bounded repair that does not introduce paid execution.
- External best-of-N, retries, model switching, or critic calls are permitted only after the same exact-$0 evidence exists for every additional external execution.

## Privacy boundary

Before external egress, ORIGIN blocks structured credentials and high-confidence personal information, including email addresses, phone numbers, payment identifiers, government IDs, financial accounts, postal addresses, medical information, and explicitly labelled personal data.

Detection returns category names only. It does not retain or echo matched values. Pattern detection cannot prove that arbitrary natural language contains no personal information, so the UI must continue to instruct users not to submit confidential or personal data.

Gemini Free Tier is not an active production fallback. Current Google terms allow unpaid-service content to be used for product improvement and reviewed by humans; therefore the release route does not send production conversations to Gemini.

## $0 boundary

The request plan must be `freeOnly:true`, estimated cost must be exactly `$0`, the model must match the audited allowlist, provider fallback must be disabled in the ORIGIN plan, and returned usage cost must be exactly `$0`. Any missing or conflicting evidence stops the request.

The OpenRouter provider policy additionally requires ZDR, denial of data collection, and maximum prompt, completion, and request price of zero. OpenRouter may choose among compatible infrastructure endpoints for the same exact model only when every endpoint satisfies these constraints.

## Failure behavior

- 429, timeout, 5xx, invalid response, model mismatch, or non-zero billing evidence → safe failure.
- No automatic retry.
- No Gemini or other provider fallback.
- No provider error body, secret, or personal value is returned to the browser or written to application diagnostics.

## Evidence

Every successful execution records the requested and served model, provider `OpenRouter`, `attempt:1`, `fallbackUsed:false`, and actual cost `$0`.
