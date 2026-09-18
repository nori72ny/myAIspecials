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
| Material Claim Model AQ-2 | VERIFIED_AUTOMATED | Included in exact-head validated AQ stack `5ef838ef23529c1a852eada948660cefa1fbee21`. |
| Deterministic Verifier AQ-3 | VERIFIED_AUTOMATED | Included in exact-head validated AQ stack `5ef838ef23529c1a852eada948660cefa1fbee21`; PASS / REPAIR_REQUIRED / BLOCKED_UNVERIFIED contract verified. |
| Evidence adapters | VERIFIED_AUTOMATED | Exact-head validated in PR #336 stack; provider-presented citations remain unverified unless separately source-checked. |
| Duplicate-submit race | VERIFIED_AUTOMATED | Exact head `64ad433528ba9f02e13780994d4f280c4bd9d583` passed Production Release, ACOS, CodeQL, OpenSSF, hosted sandbox, Vercel; browser E2E verifies one new network request and one user request for rapid duplicate submission. |
| Provider-bound context minimization | VERIFIED_AUTOMATED | Authoritative chat and streaming paths call `minimizeOriginContext`; dedicated policy tests exist. Full production smoke still belongs to release gate. |
| Routing / answer verification metadata integrity | VERIFIED_AUTOMATED | UI rejects conflicting verification states, missing routing verification, malformed envelopes, and withholds legacy content rather than showing unverifiable success. |
| Sanitized execution trace schema/store | VERIFIED_AUTOMATED | Canonical PR #339 exact head `ab2ac0ad81eaa93f6c5d5d47de86474fa5455626` passed Production Release, ACOS, CodeQL, OpenSSF, hosted sandbox, Vercel. |
| Chat trace sink wiring | VERIFIED_AUTOMATED | Exact-head validation passed GitHub release/security/sandbox gates; production enablement remains off. |
| Durable trace production wiring | IMPLEMENTED_NOT_ENABLED | Store/migration foundation and route wiring exist, but production DB migration and sink configuration remain intentionally disabled until held-out/release integration. |
| Source verifier DNS / SSRF boundary | VERIFIED_AUTOMATED | Exact-head validation passed; public-address-only DNS policy rejects private/loopback/link-local/documentation/multicast targets. |
| Source pinned fetch + claim assessor | VERIFIED_AUTOMATED | DNS-pinned HTTPS fetch, bounded response handling, content digest binding, and claim-support assessor passed exact-head GitHub validation. |
| Answer source verification pipeline / chat hook | VERIFIED_AUTOMATED | Explicit claim citations can be promoted only after successful source verification; failed checks remain unverified. |
| Research evidence adapter | VERIFIED_AUTOMATED | Retrieval/page evidence is never promoted to claim verification without explicit verification. |
| Independent reviewer identity | VERIFIED_AUTOMATED | Same execution ID or same model ID self-review is rejected; distinct reviewer identity is required. |
| Conflict-aware verifier | VERIFIED_AUTOMATED | Conflicting material evidence prevents PASS and routes to bounded repair. |
| Repair executor + reverification gate | VERIFIED_AUTOMATED | Safe repair actions are one-attempt/$0/no-mutation; repair can never self-certify success and must return to verifier. |
| Material Claim Extractor | VERIFIED_AUTOMATED | Exact answer digest, exact answer spans, one-attempt and $0 constraints validated. |
| Material Claim Coverage Review | VERIFIED_AUTOMATED | Distinct-model review detects omitted material claims and fails closed on incomplete coverage. |
| Benchmark manifest + provenance | VERIFIED_AUTOMATED | Baseline/candidate must use identical case digests, manifest, provider/model and $0 run provenance. |
| AQ Runtime Readiness Gate | VERIFIED_AUTOMATED | Missing required claim/source/reviewer/trace verification or non-zero cost blocks readiness. |
| AQ Integration Manifest | VERIFIED_AUTOMATED | Ordered integration manifest blocks unvalidated required stages from production enablement. |
| AQ Execution Budget | VERIFIED_AUTOMATED | Global provider/source/repair/wall-time/$0 budgets are bounded and fail closed on overflow. |
| Sanitized AQ Audit Record | VERIFIED_AUTOMATED | Stores stage outcomes/digests/blockers/usage only; no prompt/messages/answer text/hidden reasoning. |
| AQ Stage Policy | VERIFIED_AUTOMATED | Existing answer-quality levels resolve deterministically to required verification stages; runner-transient failure re-run passed. |
| AQ Execution Plan | IMPLEMENTED_VALIDATING | Repair/reverification corrected to conditional stages; independent review ordered after final verification; exact-head validation running. |
| AQ Stage Machine + Delivery Gate | IMPLEMENTED_VALIDATING | Required-stage skipping/self-certification blocked; conditional repair activation and final delivery gate implemented; exact-head validation running. |
| Independent answer reviewer contract | VERIFIED_AUTOMATED | Digest-bound, $0, one-attempt, fail-closed reviewer contract passed GitHub validation; live reviewer remains unconnected until post-held-out integration. |
| Independent answer reviewer | OPEN / POST-HELD-OUT | Deterministic verifier exists; separate live independent reviewer is not yet production-connected. Must respect $0/free-only eligibility. |
| Final V1.4 unseen coding qualification | INDEPENDENT_EVALUATOR_REQUIRED | Engineering assistant must not author/inspect corpus or run contaminated evaluation. |
| Main chat automated WCAG scan | VERIFIED_AUTOMATED | Exact head `8e7eb3ed6f7afd69ba13e4fade22dea0fd34a6fa` passed all gates; Axe WCAG 2 A/AA critical/serious violations are required to be zero after a rendered response. |
| Real NVDA / JAWS / VoiceOver / TalkBack speech behavior | MANUAL_REQUIRED | Automated semantics/focus tests cannot prove native assistive-technology speech output. |
| Owner hands-on acceptance | MANUAL_REQUIRED | Requires owner observation on actual device/browser; automation cannot substitute. |
| Production SHA / health / runtime smoke | IMPLEMENTED_NOT_ENABLED | Must run only after qualified integration head is promoted. |
| AQ Presenter / Repair Planner / Decision Controller | VERIFIED_AUTOMATED | Pure logic layers are exact-head validated; PASS/REPAIR/BLOCKED states cannot overclaim verification and repair never self-certifies success. |
| Answer-quality benchmark harness | VERIFIED_AUTOMATED | Separate $0 raw-metric harness is implemented and validated; it is not the official V1.4 held-out corpus. |

| AQ Stage Policy Resolver | VERIFIED_AUTOMATED | Existing answer-quality policy deterministically selects fast-path, evidence-required, or independent-review-required stages. |
| AQ Execution Budget | VERIFIED_AUTOMATED | Bounded provider/source/repair/time budgets preserve $0; provider capacity is derived from the bounded verification path rather than an arbitrary smaller ceiling. |
| AQ Usage Meter | VERIFIED_AUTOMATED | Immutable execution events derive provider executions, source fetches, repair actions, elapsed time, and accumulated cost. |
| AQ Admission Controller | VERIFIED_AUTOMATED | Policy requirements, measured budget usage, runtime readiness, verifier PASS, trace, and review requirements are composed into one fail-closed admission decision. |
| Source freshness overclaim guard | VERIFIED_AUTOMATED | Source verifier no longer permits caller-controlled freshness=passed; freshness remains not-applicable until publication/update evidence is actually checked. |
| Batched claim assessor | VERIFIED_AUTOMATED | Up to eight claim/source pairs can be checked in one $0 assessor execution with exact ID/claim/URL/digest/excerpt binding and duplicate-output rejection. |
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
