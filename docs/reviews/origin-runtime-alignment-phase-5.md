# ORIGIN Runtime Alignment — Phase 5 Legacy Chat Boundary Audit

Target: PR #45  
Tracking issue: #44  
Status: Draft, unmerged, undeployed

## Audit question

Can any normal application entrypoint bypass the authoritative ORIGIN `/api/chat` route and reach the historical provider-specific chat handler in `createLegacyRouter()`?

## Entry points inspected

- `server.ts`
- `api/index.ts`
- direct imports of `createLegacyRouter()` found by repository search

## Finding

The historical `/api/chat` implementation still exists physically inside `src/legacy/legacyRoutes.ts`. It is unsafe as an authoritative execution route because it can select OpenRouter or Gemini from environment-key presence, uses a hardcoded model family, estimates cost after execution, and bypasses the new ORIGIN context, privacy, free-only, data-policy, routing-evidence, and zero-cost checks.

However, both application entrypoints now mount the routes in this order:

1. `createOriginChatRouter()`;
2. `originChatBoundaryGuard` on every `/api/chat` method;
3. `createLegacyRouter()`.

Therefore a handled request returns from the authoritative route, while any unexpected fallthrough is stopped with `ORIGIN_CHAT_BOUNDARY_NOT_HANDLED` before the historical handler can execute.

The boundary guard has dedicated tests confirming that a later legacy handler is not reached and unsupported methods also fail closed.

## Decision

- Runtime bypass through the inspected production and serverless entrypoints: **blocked**.
- Historical unsafe code physically removed: **not completed**.
- Owner acceptance impact: the runtime Critical bypass is mitigated, but code deletion remains required before final candidate audit because dead sensitive code increases maintenance and regression risk.

## Required deletion stage

Before final external-AI audit:

- remove the `/api/chat` block from `src/legacy/legacyRoutes.ts`;
- remove its `callLLM` dependency if unused elsewhere in that module;
- remove or migrate the legacy chat-specific tests;
- keep the boundary guard as defense in depth until at least one stable release after deletion;
- run all CI on the exact deletion SHA;
- search the repository again for provider-specific chat paths and direct `callLLM` use.

## CI state

For head `3e45acd9d6413f2ce78a4f29d397a6f1efa1b559`:

- ACOS 2.0 Quality Gate: success;
- CodeQL Security Analysis: success;
- OpenSSF Scorecard: success;
- Production Release CI/CD: cancelled, not counted as pass.

The Phase 5 documentation commit is `7876487356c8a99101dd9e3fe37933331a27146a`; its four workflows were queued when this report was written. No failed-job rerun was requested.

No merge, deployment, DNS, billing, credential, account, or paid-service action is authorized by this audit.
