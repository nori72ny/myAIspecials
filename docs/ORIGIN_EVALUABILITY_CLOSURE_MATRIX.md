# ORIGIN — Evaluability Closure Matrix

## Goal

Track previously PARTIAL / UNVERIFIED / INCOMPLETE areas and convert every automatable item into code + reproducible evidence before production release.

## Status classes

- VERIFIED_AUTOMATED — reproducible automated evidence exists.
- IMPLEMENTED_VALIDATING — code/tests exist and exact-head validation is running.
- IMPLEMENTED_NOT_ENABLED — implementation exists but production wiring/configuration is intentionally disabled.
- MANUAL_REQUIRED — cannot be proven by automation alone.
- INDEPENDENT_EVALUATOR_REQUIRED — must remain outside the engineering assistant.
- OPEN — no sufficient implementation/evidence yet.

## Current matrix

| Area | Current status | Evidence / action |
|---|---|---|
| UI/UX Phase 6–10 | VERIFIED_AUTOMATED | Stacked exact-head validation complete through Phase 10; production not promoted. |
| Evidence Ledger AQ-1 | VERIFIED_AUTOMATED | Exact head `bf8f7cc8fa5252e52e853555ad9e21e10f742138`; Production Release, ACOS, CodeQL, OpenSSF, hosted coding sandbox, Vercel successful. |
| Material Claim Model AQ-2 | IMPLEMENTED_VALIDATING | Draft stacked PR #334; focused unit contract exists. |
| Deterministic Verifier AQ-3 | IMPLEMENTED_VALIDATING | Draft stacked PR #335; PASS / REPAIR_REQUIRED / BLOCKED_UNVERIFIED contract exists. |
| Evidence adapters | IMPLEMENTED_VALIDATING | Draft stacked PR #336; provider-presented citations remain unverified. |
| Duplicate-submit race | IMPLEMENTED_VALIDATING | Browser E2E proves one network request + one user message for rapid duplicate submission; exact-head rerun in progress. |
| Provider-bound context minimization | VERIFIED_AUTOMATED | Authoritative chat and streaming paths call `minimizeOriginContext`; dedicated policy tests exist. Full production smoke still belongs to release gate. |
| Sanitized execution trace schema/store | IMPLEMENTED_VALIDATING | Strict schema, append-only Postgres store, server-only migration, retention, tests implemented in PR #342; not production-enabled. |
| Durable trace production wiring | IMPLEMENTED_NOT_ENABLED | Store/migration foundation exists, but production DB migration and chat-route sink wiring are intentionally deferred until held-out/release integration. |
| Independent answer reviewer | OPEN / POST-HELD-OUT | Deterministic verifier exists; separate live independent reviewer is not yet production-connected. Must respect $0/free-only eligibility. |
| Final V1.4 unseen coding qualification | INDEPENDENT_EVALUATOR_REQUIRED | Engineering assistant must not author/inspect corpus or run contaminated evaluation. |
| Real NVDA / JAWS / VoiceOver / TalkBack speech behavior | MANUAL_REQUIRED | Automated semantics/focus tests cannot prove native assistive-technology speech output. |
| Owner hands-on acceptance | MANUAL_REQUIRED | Requires owner observation on actual device/browser; automation cannot substitute. |
| Production SHA / health / runtime smoke | IMPLEMENTED_NOT_ENABLED | Must run only after qualified integration head is promoted. |
| Answer-quality benchmark before/after | POST-HELD-OUT | Benchmark specification frozen in planning; baseline/candidate runtime runs begin after official held-out evidence is frozen. |

## Closure priority

### Can close before final unseen
1. AQ contract exact-head validations.
2. duplicate-submit browser race.
3. sanitized trace code/migration validation.
4. context-minimization regression evidence.
5. malformed metadata / fail-closed negative tests.
6. security and secret-leak regression coverage.

### Must wait for independent evaluator
1. official V1.4 final unseen corpus/run/evidence.

### Must wait for production integration
1. durable trace migration enablement.
2. chat route trace sink wiring.
3. production SHA equality.
4. live health/chat/research/coding smoke.

### Requires human/manual observation
1. native screen-reader speech behavior.
2. owner acceptance on target devices.

## Rule

No item may be promoted from PARTIAL/UNVERIFIED to verified based on documentation alone. It needs reproducible code/test/runtime evidence appropriate to the claim.
