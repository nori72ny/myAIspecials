# ORIGIN Runtime Alignment — Phase 4

Target: PR #45  
Tracking issue: #44  
Status: Draft, unmerged, undeployed

## Objective

Close the gap between the model requested by ORIGIN and the provider endpoint that actually served the response.

## Request controls

Every OpenRouter request now includes:

- an explicit evidence-backed `:free` model;
- `provider.allow_fallbacks: false`;
- `provider.data_collection: "deny"`;
- `provider.zdr: true`;
- `provider.max_price` set to zero for prompt, completion, request, and image pricing;
- `usage.include: true`;
- `X-OpenRouter-Metadata: enabled`.

The request contains no application-level cross-provider fallback.

## Response controls

ORIGIN withholds the answer unless all of the following are true:

- usage cost is present, finite, and exactly zero;
- router metadata is present;
- router metadata identifies the model requested by ORIGIN;
- the successful attempt number is exactly one;
- the routing strategy is not `fallback`;
- no more than one provider attempt is recorded;
- a selected provider endpoint is identified;
- the served model is identified.

The successful chat response records:

- requested model;
- served model;
- selected provider;
- routing strategy;
- region when supplied;
- successful attempt number;
- confirmation that no fallback was used;
- applied data policy;
- exact zero-cost usage evidence.

## Failure behavior

- Missing or invalid cost: `PROVIDER_COST_UNVERIFIED`.
- Nonzero cost: `PROVIDER_POLICY_VIOLATION`; answer discarded.
- Missing or inconsistent routing evidence: `PROVIDER_ROUTING_UNVERIFIED`; answer withheld.
- Evidence of a fallback attempt: `PROVIDER_ROUTING_UNVERIFIED`; answer withheld.

## Evidence limitation

The implementation is verified with synthetic requests and mocked OpenRouter responses. No live API credential or live provider execution was used. Therefore endpoint availability under the combined free, zero-price, data-deny, and ZDR constraints remains unverified until separately authorized.

## Remaining work

- dedicated Personal Edition wording for unverifiable cost, unverifiable routing, and oversized input;
- removal of the shadowed legacy chat handler;
- independent review/synthesis execution;
- final external-AI and real screen-reader audits.

No merge, deployment, paid execution, credential request, DNS, billing, or account change is authorized.
