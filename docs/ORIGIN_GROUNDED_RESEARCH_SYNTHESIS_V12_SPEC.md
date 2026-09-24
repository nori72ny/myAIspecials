# ORIGIN Grounded Research Synthesis V1.2

Status: Draft post-first-release candidate
Issue: #648
PR: #667

## Objective

Upgrade Grounded Research from a bounded evidence digest to a concise answer that directly addresses the user's question while preserving ORIGIN's strict $0, privacy, provenance, and fail-closed boundaries.

## Pipeline

1. Sensitive-input detection runs before external retrieval or model egress.
2. Grounded Research retrieves a bounded set of public HTTPS sources.
3. Unsafe URLs are removed.
4. ORIGIN builds the existing deterministic evidence digest.
5. If a currently verified free-provider plan is available, ORIGIN may perform exactly one synthesis model execution.
6. The model receives only:
   - the current research question
   - the bounded public evidence packet
   - conservative conflict signals
7. The model must use exact source IDs and URLs copied from the packet.
8. ORIGIN validates citation structure deterministically.
9. Only citation-valid synthesis is shown.
10. Any provider or citation failure discards the model output and returns the deterministic evidence digest.

## Non-negotiable safety

- Provider retry count: 0
- Provider fallback: 0
- Paid fallback: prohibited
- Provider attempt evidence must remain attempt=1 / fallbackUsed=false
- Billing evidence must remain costUsd=0
- Full prior conversation is not sent into synthesis
- Secrets remain blocked before egress
- No invented URL may appear in accepted synthesis
- No invented source ID may appear in accepted synthesis
- A source ID paired with a different URL fails validation
- Two or more safe sources require at least two distinct cited sources
- Every factual paragraph or bullet must carry an inline source citation
- Citation validation must never be presented as factual truth verification
- Publisher authority / primary-source status is not inferred unless deterministically proven elsewhere

## Accepted citation form

Exact Markdown inline link copied from the packet:

`[S1](https://example.com/path)`

The source ID and URL pair must match the retrieval packet exactly after safe HTTPS normalization.

## Safe degradation

If synthesis cannot be safely adopted:

- do not return the model-generated text
- do not call another model
- do not retry the provider
- keep the already-retrieved public evidence available
- label routing metadata with the synthesis failure state
- preserve the existing bounded evidence limitations

This is fail-closed for the synthesis layer, not a provider fallback.

## Validation states

Successful:
- `citation-validated`

Rejected:
- `EMPTY_SYNTHESIS`
- `UNKNOWN_CITATION`
- `MISMATCHED_CITATION_URL`
- `INSUFFICIENT_SOURCE_COVERAGE`
- `UNCITED_FACTUAL_UNIT`

Execution unavailable:
- free provider plan unavailable/stale
- provider failure
- synthesis explicitly disabled in tests

## User-facing truthfulness

When synthesis succeeds, ORIGIN may say:

> 引用先が取得済みソースと一致することは機械検証しました。

It must also state:

> 主張の真偽・網羅性・媒体の権威性は独立検証していません。

ORIGIN must not label the synthesis as independently verified unless a separate independent-review gate actually ran and passed.

## Release order

This work is post-first-release only.

Do not merge while P0 Issue #650 remains open or canonical Production releaseSha differs from main. This current-main rebuild supersedes Draft PR #662.

## Acceptance evidence

Required before merge:
- pure citation-validator unit tests
- router adoption test for valid multi-source synthesis
- invented source-ID rejection
- mismatched URL rejection
- unknown URL rejection
- insufficient source coverage rejection
- uncited factual unit rejection
- one-attempt provider failure safe degradation
- no provider call when free-provider evidence is unavailable
- ACOS Quality Gate PASS
- CodeQL PASS
- OpenSSF PASS
- Production Release CI/CD PASS
