# ORIGIN — AQ40 new current-Production baseline proposal (UNAPPROVED)

Created 2026-10-10. **This file is a review proposal, NOT an authorization to merge, execute any provider calls, spend money, switch a model, or deploy.**

## The two immutable baselines MUST NOT be conflated

| Purpose | Exact SHA | Evidence status |
| --- | --- | --- |
| Earlier historical frozen baseline | `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498` | Older benchmark comparator only. **Not** currently serving Production. Its completed and failed rounds remain in their own immutable ledger. |
| Actual serving ORIGIN Production (as observed 2026-10-10) | `437f4f0a5c66c0d9add7f65e72369f9787931f7a` | Vercel READY deployment `dpl_EQC4xWGW9hY9SkzkxXuTwxs7uLrP`, `/api/health` HTTP 200 on all three official Production aliases. **Only a proposed new comparator.** |
| Protected GitHub main (not serving the current Product) | `f6dcce9522f2fbd84e81399d0ef96d1409021cbb` | Do not mistake branch HEAD for serving Production or a previous baseline. |

## Why re-freeze is required
Q1 comparison `.github/workflows/q1-final-aq.yml` has the earlier frozen baseline SHA. Verified [PR #955](https://github.com/nori72ny/myAIspecials/pull/955) now fails closed if that SHA is not the actually serving SHA on **all three** canonical Production aliases, so an old comparison cannot masquerade as a current-Production improvement. This proposed PR, based on #955's checks, changes only the **comparator reference** to what is actually serving; it does **not** change the 40-case rubric, case bodies, quota, candidate, evaluator, source code of the serving Production, privacy rules, provider model, Vercel aliases or stored evaluation evidence.

## Gate procedure — mandatory before any merge or provider activity
1. Independent reviewer (someone other than the commit author) checks exact commit/paths and that current Production serves the proposed SHA from all three aliases.
2. Check the reviewed candidate is current; forbid any hidden case corpus, evaluator, prompt, quota or provider-policy changes. Existing historical results must remain identified with the **old** baseline SHA; never relabel/overwrite historical case score artifacts or quota reservations.
3. Owner signs off exact reviewed SHA and the 390px/mobile visual release gate **separately**; branch protection and GitHub policies still apply.
4. Real provider authenticated model endpoint must be strictly **zero-price** and **ZDR** with no fallback/BYOK or secret exposure. Until independent invoices/retention verification, `catalogEligible` does NOT mean a model works or costs $0.
5. Make a new, explicitly named comparison round for the proposed new baseline. Require all 40 actual paired answers and full source SHA/version and case-by-case evidence; neither CI PASS nor `/api/health` proves answer quality.
6. Honor existing 24-hour global provider quota and held-out Coding priority; **do not** bypass/erase reservations to launch an evaluation.
7. Final reviewed exact-head CI/held-out/Owner approval and recoverable Vercel alias rollback must all pass before considering release. All three Production aliases and the currently serving `437f4f0...` must remain unchanged until a separately authorized staged promotion.

## Fail-closed decisions
- If any live alias serves another SHA, abort evaluation; don't silently rewrite the baseline reference.
- If the candidate already produced evaluation artifacts against the old comparator, quarantine them under their original exact SHAs; do not use them as new baseline scores.
- If the proposed comparator cannot itself complete valid zero-dollar, ZDR-constrained 40-case answers, report **NOT_MEASURED**, not a passing 40/40.
- No automatic PR merge or Production release is permitted as a consequence of this document or a green CI.

Related tracking: [P0 release blockers #953](https://github.com/nori72ny/myAIspecials/issues/953), [AQ40 official measurement #842](https://github.com/nori72ny/myAIspecials/issues/842).
