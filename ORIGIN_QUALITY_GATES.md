# ORIGIN Quality Gates

Status: Mandatory release-quality criteria for ORIGIN Personal / ACOS.

## 1. Gate principle

A feature is not complete because code exists. Completion requires evidence across implementation, test, review, deployment, and production verification as applicable.

## 2. Required release stages

For material production changes, use these stages:

1. Scope and success criteria defined.
2. Implementation completed on a non-production branch.
3. Build and type check pass.
4. Relevant unit/integration tests pass.
5. Relevant E2E or browser verification passes.
6. Security boundary impact reviewed.
7. Mobile/responsive impact reviewed.
8. Performance impact checked when relevant.
9. Independent AI review performed for material P0/P1 changes.
10. Owner approval obtained where required by governance.
11. Merge/release performed.
12. Production smoke test performed.
13. GitHub main SHA, production deployment SHA, and health/release SHA aligned where available.
14. Regression benchmark checked for affected areas.

## 3. UI / UX gate

Reject or revise a change if it creates material regressions in any of:

- discoverability,
- cognitive load,
- touch targets,
- keyboard/IME behavior,
- mobile layout,
- responsive overflow,
- text hierarchy,
- contrast/readability,
- spacing consistency,
- error recovery,
- loading feedback,
- accessibility,
- visual consistency.

Major UI changes should be checked at representative mobile, tablet, and desktop widths.

## 4. Answer-quality gate

A change affecting prompts, models, routing, context, streaming, or output formatting must be benchmarked for:

- directness,
- factual support,
- completeness,
- usefulness,
- uncertainty handling,
- hallucination resistance,
- source quality when sources are required,
- latency,
- truncation/repetition,
- mobile readability.

A speed improvement that materially degrades answer quality fails the gate.

## 5. Artifact gate

For generated artifacts, verify as relevant:

- artifact detection/parsing,
- automatic workspace opening,
- preview render,
- code view,
- copy,
- save/download,
- share,
- edit,
- fullscreen,
- close,
- responsive behavior,
- runtime error capture,
- last-known-good recovery,
- sandbox isolation.

A generated artifact that cannot be opened or used is a release-blocking defect for the affected artifact flow.

## 6. Security gate

Material changes must not weaken:

- CSP and top-level security headers,
- Opaque Origin artifact sandbox,
- navigation/network restrictions,
- postMessage validation,
- XSS boundaries,
- credential/secret protection,
- diagnostic sanitization,
- provider/model restrictions,
- zero-cost fail-closed policy where applicable.

Security-critical changes require adversarial review before release.

## 7. Runtime Error Boundary gate

For artifact runtime recovery, confirm:

- parent application remains alive,
- runtime error is detected,
- displayed diagnostics are bounded/sanitized,
- recovery controls work,
- last-known-good is only promoted after a trustworthy readiness signal,
- message events are bound to the expected iframe window/source,
- recovery does not create an error loop.

## 8. Performance gate

For performance-sensitive changes, compare before/after when possible using:

- first meaningful response,
- completion latency,
- artifact-open latency,
- preview-render latency,
- LCP,
- INP,
- CLS,
- JS/bundle impact,
- server/API latency.

Prefer median plus tail latency (P75/P95) over a single best-case sample.

## 9. Production verification gate

After an approved production change, verify:

- production URL responds,
- core chat path responds,
- affected feature smoke test passes,
- no new high-severity runtime error cluster is visible,
- deployed release corresponds to the intended main revision.

Do not report Production Verified before these checks.

## 10. Scoring discipline

Do not award PASS based only on specifications or code presence.

Use:

- PASS: evidence shows the criterion works.
- CONDITIONAL PASS: implementation is credible but important runtime/evidence gaps remain.
- FAIL: required behavior is broken, unsafe, or contradicted by evidence.
- UNVERIFIED: no sufficient evidence was available.

## 11. P0 conditions

Examples of P0 include:

- production unavailable,
- paid route possible despite zero-cost policy,
- secret exposure,
- sandbox escape or material external-network escape,
- destructive data loss,
- core artifact flow cannot open/use generated output,
- material authentication/authorization bypass where applicable.

P0 blocks normal release progression until resolved or explicitly accepted by the owner with documented risk.
