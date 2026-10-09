# ORIGIN Answer Accuracy — first incremental release gate

**Scope:** answer accuracy only. No image-generation, PWA, Agent, Coding or UI features are included in this release candidate. Source: original draft PR #930; this release candidate is rebuilt from protected `main` `1a9a88cb9571fce078eb0d729f007f7ac8e26e88` on `fix/answer-accuracy-current-main-20261010`. The original draft was behind current main by 23 commits. The new branch preserves the existing manual-production hold, three-domain health attestation, and security lockfile; those files were not replaced from the old draft.

## Candidate scope and constraints (2026-10-10)

- Exactly 12 answer/runtime/evaluation source and test files plus this release document differ from `main` at initial port. No CI workflow, Vercel configuration, dependency lockfile, release security guard, or main production alias changed.
- Added Japanese counter checks for 名/人, 社, 台, 個, 回, and stricter malformed-grouping checks with regression tests. This is not evidence of a live-model accuracy improvement until a real independent benchmark is completed.
- The `main` Git deployment hold in `vercel.json` is a repository configuration assertion, not independently verified proof of live Vercel native domain admission policy. The last known canonical alias still serves old production SHA `437f4f0a5c66c0d9add7f65e72369f9787931f7a`.
- Production promotion is **BLOCKED** until latest exact-head CI, independent review, live zero-cost paired quality measurement, native all-domain release-hold proof, Owner exact-SHA visual acceptance, and a safe same-build stage/promotion/rollback path are all independently verified.

## Shipped into the review candidate

- Preserve explicit constraints, numeric units/dates/denominators, conflicts and unknowns in model instructions, in Japanese and English.
- Distinguish transformation of supplied text from a separate request for fresh external information. A quoted request is not an instruction to search.
- Reject source-cited but unsupported whole numeric values and assembled dates. Retrieval timestamps are **not** evidence that an event happened on that date.
- Accept source-derived nonnegative safe-integer addition/subtraction **only when the visible arithmetic is correct, both operands are in the cited evidence, and all explicit units match**.
- Unit tests cover wrong results, unsupported operands, unsupported measures, false event dates and legitimate calculations.

## Production qualification — all must be independently evidenced

1. **Exact-head engineering:** Node 22 and 24 tests + API, Chromium E2E, Lighthouse, CodeQL, OpenSSF and ACOS at the same candidate SHA must all pass. Old SHA results do not count.
2. **Actual answer-quality measurement:** Run a *public* 40-case corpus with realistic responses, across at least numeric correctness, explicit constraints, citation fidelity/freshness, multi-part or multi-turn carryover, and Japanese/English answer clarity. Record each model output and independent scoring evidence. A prompt-only or deterministic unit-test pass is **not** a model-quality pass. Use a separate sealed held-out sample only if an authorized independent evaluation environment is available; never disclose sealed prompts.
3. **Comparison:** Run the *same permitted, zero-cost* tasks on current production baseline and candidate. Publish answer-level regressions, unsupported claims, omissions, numerical-error rates, completion failures and cost receipts. A zero-use quota skip or non-executed judge is **NOT MEASURED**, not PASS.
4. **No fees/private data:** Do not run pay-per-token evaluations or route to paid fallbacks. Actual provider-cost receipts must verify USD 0, not only an application claim. No secrets, personal data or private corpora appear in public logs.
5. **Release controls:** Owner accepts **exact SHA and answer-quality only**; verified independent exact-head review; effective GitHub required checks + stale-approval protection; *actually enforced* Vercel deployment checks preventing alias assignment until qualified. Audit must fail closed when any control is unreadable.
6. **Rollout:** Stage only the reviewed answer-quality build, validate production-configured non-billed API health, baseline/rollback, and smoke from the intended alias; promote only after all previous gates. Repeat checks after promotion. No automatic deployment based on PR text or a green status badge.

## Baseline evidence and limits

- Prior PRs #889 and #894 included source improvements but never entered current production; their passing CI cannot certify this new candidate.
- PR #892's AQ live shard run 37547020746 logged a **quota skip** and produced no comparison artifact. It does **not** constitute a passed answer-quality benchmark.
- This candidate initially has only source-level tests and research-validation regressions; actual provider answer-quality performance remains **NOT MEASURED** until output evidence is collected.
- Main branch protection summary has reported protected=true, but authenticated branch protection detail was previously 403. A summary bit is not proof that all required checks and reviewer policies are actually enforced.

**Release decision:** BLOCK unless every applicable qualification above is evidenced for the immutable candidate. Only after this feature is released should next feature (e.g. Coding or Agent) enter its own independent approval lane.
