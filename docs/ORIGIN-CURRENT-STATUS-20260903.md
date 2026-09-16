# ORIGIN Current Engineering Status — 2026-09-03 JST

## Purpose
This is a dated continuity record so parallel AI sessions do not restart from stale August handovers. It supplements `docs/ORIGIN-HANDOVER.md`; the live repository and exact-head CI remain authoritative.

## Current repository state

- Repository: `nori72ny/myAIspecials`
- Default branch: `main`
- Current main observed during this review: `25f909541559152a27596eea86b21045cea3ec1c`
- Phase 2 security PR #124: **merged** on 2026-09-02 at merge commit `d02a83c5bb51bb1169c7e45a39e503e628de1f54`.
- Current security transport PR #127: **open, not merged**; head `5842f4a464093e4881c2dc97efa9af3f5d27aab1`; base `release-base-current` at `25f909...`.

## What has advanced since older handovers

1. The Agentic Coding OS Phase 2 safety foundation from PR #124 is now merged into `main`. It includes server-owned repository scope, descriptor-based race defenses, bounded atomic writes, secret filtering, bounded verification, checkpoint/rollback integrity, and benchmark integrity gates.
2. The current free-model catalog on `main` uses `google/gemma-4-26b-a4b-it:free` with dated evidence checked 2026-09-02 and a finite review deadline of 2026-09-12. This must be revalidated before that deadline and never treated as permanently free.
3. OpenRouter's current official model page was independently checked on 2026-09-03 and reports `google/gemma-4-26b-a4b-it:free` as Free with zero prompt/completion pricing.
4. The current main branch contains the hardened repository writer implementation. Non-Linux race-safe writes intentionally fail closed.
5. The current `/api/chat` route has zero-cost execution checks, sensitive-input blocking, context minimization, retry/timeout handling, provider routing evidence, and truthful `not-run` status for requests that require independent review but cannot obtain an independent reviewer.
6. Legacy provider-capable routes are protected by fail-closed boundaries; the Phase 2 release work explicitly keeps unsafe legacy Mission Engine execution outside the Personal production composition.

## Open release blockers

### P0 — CI / exact-head evidence

Current PR #127 cannot be merged until its required CI is green on the exact head. Earlier CI evidence included a failing unit-test gate; do not reuse older green runs from another SHA as acceptance evidence.

### P0 — Gemini transport security

`src/legacy/originProviderClient.ts` on `main` still contains the Gemini REST transport using the URL query parameter form. PR #127 changes this to the `x-goog-api-key` header and adds a regression test. This PR must pass exact-head CI before merge.

### P1 — Independent review

`/api/chat` currently identifies requests that require independent review, but the live route does not execute a genuinely independent second provider and synthesis path. It therefore reports `verificationStatus: not-run` for those requests. This is honest behavior, but it is not completion of the desired primary-plus-independent-review loop.

### P1 — Durable unified trace

The current response exposes a trace ID and routing metadata, but a reviewed durable server-side audit sink is not configured. Do not describe response-local metadata as a durable audit log.

### P1 — Provider evidence

Only exact provider/model combinations with current $0 evidence may execute. Provider-wide free claims are prohibited. If Gemini/Groq are ever enabled as primary or reviewer paths, each needs its own current evidence and routing/cost verification.

### P1 — Hands-on release validation

Before production promotion, exact-head runtime smoke, serverless runtime smoke, PWA/device validation, accessibility validation, and an independent security review must be current for the exact release candidate.

## Release rule

Do not merge or deploy merely because the UI works, a historical CI run is green, or an AI reports completion. Merge/deploy only after the exact candidate has green required CI, current zero-cost evidence, security regression evidence, runtime smoke evidence, and an explicit Go/No-Go review. If any required gate is missing, the release remains blocked.

## Next work order

1. Finish PR #127 security transport fix and rerun exact-head CI.
2. Diagnose and eliminate every current unit-test failure without weakening tests.
3. Re-audit all mounted provider-capable routes and legacy boundaries after the merge candidate changes.
4. Implement or formally gate the independent-review path under the same zero-cost and provider-independence rules.
5. Implement a reviewed durable sanitized trace only after retention/access/failure semantics are defined.
6. Run exact-head security, runtime, E2E, accessibility and production smoke checks.
7. Only then make the production Go/No-Go decision.

## Safety note

No API keys, tokens, passwords, deployment secrets, or private credentials belong in this document.
