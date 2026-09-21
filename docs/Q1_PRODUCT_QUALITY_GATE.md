# Q1 Product Quality Gate

## Purpose

Q1 is the acceptance boundary for ORIGIN product quality before broader production expansion.

It prevents implementation, CI success, Lighthouse, synthetic tests, or benchmark harness existence from being reported as product-quality completion without measured evidence.

Q1 covers four independent acceptance surfaces:

1. rendered UI/UX quality;
2. live answer quality;
3. held-out Agentic Coding quality;
4. controlled Claude Code comparison.

The gate fails closed if any evidence is missing, stale, bound to another candidate SHA, or not comparable.

## Candidate binding

All evidence must bind to the same exact candidate commit SHA.

A result from another branch, earlier candidate, preview, or production release cannot be substituted.

## UI/UX acceptance

Required evidence:

- exact-head rendered validation;
- screenshots for mobile, tablet, and desktop;
- no horizontal overflow;
- automated accessibility checks pass.

Existing Playwright visual QA now captures home and long-answer evidence at:

- mobile 390 x 844;
- tablet 768 x 1024;
- desktop 1440 x 1000.

Passing Lighthouse or E2E alone is not treated as visual-design acceptance.

## Answer-quality acceptance

Required evidence:

- a completed live AQ benchmark run;
- exactly 40 cases across 10 frozen families;
- the release report marks the candidate promotion-eligible;
- zero-cost execution.

A skipped live lane is explicitly not acceptance evidence.

## Agentic Coding acceptance

Required evidence:

- completed held-out Coding execution;
- qualification passes;
- attempted/solved/regression counts are internally valid;
- zero-cost execution.

The benchmark harness or public synthetic fixtures are not model-performance evidence.

## Claude Code comparison

A Claude Code parity claim requires controlled comparative evidence:

- identical corpus digest;
- identical base commit;
- identical time budget;
- identical evaluator version;
- equal attempted task count;
- ORIGIN solved count is not lower;
- ORIGIN regression count is not higher.

Without that evidence the gate returns `CLAUDE_CODE_COMPARISON_MISSING` and ORIGIN must not claim Claude Code parity or superiority.

## Evidence provenance

Every acceptance surface must carry bounded provenance alongside its measured values:

- source type (`github-actions` or `controlled-external`);
- stable evidence ID;
- exact candidate head SHA;
- SHA-256 artifact digest;
- creation timestamp;
- explicit expiry timestamp.

The gate rejects malformed digests, future-dated evidence beyond a small clock-skew allowance, expired evidence, evidence bound to another head, and evidence whose lifetime exceeds 31 days. Release evidence should be populated from retained workflow/external artifacts rather than copied from narrative status text.

This provenance check prevents stale or accidentally mis-bound evidence from being accepted. It does not replace independent source authentication; the release process must still retain the referenced workflow/external artifacts.

## Executable gate

Run:

```sh
npm run eval:q1-quality -- <evidence.json>
```

The command exits 0 only when all four acceptance surfaces pass. Missing or failed evidence exits non-zero.

## Current status

As of this Q1 branch:

- UI/UX v3.1 Phase 6-10 implementation exists and automated release gates have passed on its stack, but Q1 now requires exact-head three-viewport rendered evidence.
- Answer-quality infrastructure and the 40-case / 10-family qualification model exist, but skipped live AQ execution is not counted as accepted.
- held-out Agentic Coding infrastructure exists, but benchmark infrastructure alone does not establish Claude Code-class performance.
- no controlled Claude Code comparison evidence is currently recorded in this branch.

Therefore Q1 is intentionally not complete until those measured evidence gaps are closed.

## Release rule

Do not merge or publish a release as “Q1 quality accepted” unless the executable gate passes on evidence bound to the exact candidate SHA.

Production deployment remains a separate owner-approval gate.
