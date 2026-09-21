# Q1 Product Quality Gate

## Purpose

Q1 is the acceptance boundary for ORIGIN product quality before broader production expansion.

It prevents implementation, CI success, Lighthouse, synthetic tests, or benchmark harness existence from being reported as product-quality completion without measured evidence.

Q1 core covers three independent acceptance surfaces:

1. rendered UI/UX quality;
2. live answer quality;
3. held-out Agentic Coding quality.

Claude Code comparison is a separate comparative-claim gate. It is intentionally not a prerequisite for accepting ORIGIN's own product quality, because a controlled external comparison can require a separate provider account, quota, or cost approval that is outside ORIGIN's zero-cost release criteria.

Both gates fail closed on missing, stale, malformed, or mismatched evidence. Q1 core can pass without Claude Code evidence, but ORIGIN must not claim Claude Code parity or superiority unless the separate parity gate passes.

## Candidate binding

All Q1 core evidence must bind to the same exact candidate commit SHA.

A result from another branch, earlier candidate, preview, or production release cannot be substituted.

Claude Code comparison evidence must also bind to the same candidate SHA and controlled comparison identity before any parity claim is allowed.

## UI/UX acceptance

Required evidence:

- exact-head rendered validation;
- screenshots for mobile, tablet, and desktop;
- no horizontal overflow;
- automated accessibility checks pass.

Existing Playwright visual QA captures home and long-answer evidence at:

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

## Separate Claude Code parity gate

A Claude Code parity claim requires controlled comparative evidence:

- identical corpus digest;
- identical base commit;
- identical time budget;
- identical evaluator version;
- equal attempted task count;
- ORIGIN solved count is not lower;
- ORIGIN regression count is not higher.

Without that evidence the parity gate returns `CLAUDE_CODE_COMPARISON_MISSING` and ORIGIN must not claim Claude Code parity or superiority.

A failed or unavailable parity comparison does not downgrade a separately proven Q1 core result. It only keeps the comparative claim unavailable.

## Evidence provenance

Every acceptance surface must carry bounded provenance alongside its measured values:

- source type (`github-actions` or `controlled-external`);
- stable evidence ID;
- exact candidate head SHA;
- SHA-256 artifact digest;
- creation timestamp;
- explicit expiry timestamp.

The gates reject malformed digests, future-dated evidence beyond a small clock-skew allowance, expired evidence, evidence bound to another head, and evidence whose lifetime exceeds 31 days. Release evidence should be populated from retained workflow/external artifacts rather than copied from narrative status text.

This provenance check prevents stale or accidentally mis-bound evidence from being accepted. It does not replace independent source authentication; the release process must still retain the referenced workflow/external artifacts.

## Executable gates

Run Q1 core:

```sh
npm run eval:q1-quality -- <evidence.json>
```

This command exits 0 only when UI/UX, live AQ, and held-out Coding all pass.

Run the separate Claude Code parity gate:

```sh
npm run eval:claude-code-parity -- <evidence.json>
```

This command exits 0 only when the controlled Claude Code comparison establishes parity under the frozen comparison rules.

The product-quality report uses schema `origin.product-quality-gate.v2` and includes `claudeCodeParityEstablished` plus `claudeCodeBlockers` for visibility, but those comparison fields do not determine Q1 core `passed`.

## Current status

As of the current candidate:

- UI/UX implementation and automated release gates exist, but Q1 still requires exact-head three-viewport rendered evidence.
- Answer-quality infrastructure and the 40-case / 10-family qualification model exist, but skipped live AQ execution is not counted as accepted.
- held-out Agentic Coding infrastructure exists, but the final measured qualification still requires retained exact-candidate evidence.
- no controlled Claude Code comparison evidence is currently recorded, so no Claude Code parity or superiority claim is permitted.

Therefore Q1 core remains incomplete until the three measured product-quality evidence gaps are closed. Claude Code parity remains independently unproven until its separate controlled comparison gate passes.

## Release rule

Do not publish a release as “Q1 quality accepted” unless the Q1 core executable gate passes on evidence bound to the exact candidate SHA.

Do not publish a “Claude Code parity”, “Claude Code-class”, or superiority claim unless the separate comparison executable gate passes.

Production deployment remains a separate owner-approval gate.
