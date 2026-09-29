# PR #741 independent review packet — 2026-09-29

## Audit target

- Repository: `nori72ny/myAIspecials`
- Pull request: `#741`
- Base: `main` at `c3c428d566ef06c633ff1fe040af843091403154`
- Runtime candidate SHA: `a7459f9fccdd4b0cf7587d477f368a3ce8097f31`
- Release-hold issue: `#742`
- Production remains unchanged at the base SHA.

This file is an audit packet only. The commit that adds this file is documentation-only. Reviewers must audit the runtime candidate SHA above. If any runtime file changes after that SHA, the review is stale and must be repeated against the new runtime candidate.

## Non-negotiable restrictions

The reviewer must not:
- merge, publish, deploy, or remove Draft status;
- change billing, plans, credentials, repository settings, permissions, DNS, or security gates;
- request secrets or private user data;
- accept documentation, UI copy, mocks, or test names as proof of runtime behavior;
- assume normal CI proves answer quality or held-out Coding quality;
- describe ORIGIN as perfect, best, complete, or world-class without reproducible evidence.

Use read-only source/evidence inspection and synthetic examples.

## Current release scope

The initial release may claim only capabilities supported by exact evidence.

Explicit exclusions / unresolved runtime claims:
- Japanese/non-ASCII PDF is **not** supported in the initial release; it fails closed with `PDF_UNICODE_RENDERING_UNAVAILABLE`. Deferred work is tracked separately.
- Real Cloudflare raster generation is **not operationally proven** until a real Workers Free account is configured server-only and a generated image passes end-to-end verification, or raster is excluded from the release claim.
- Normal CI is not a substitute for trusted AQ V2 or sealed held-out Coding qualification.

## Evidence to inspect

Review the PR diff plus, at minimum:

### UI / UX / accessibility
- `src/App.tsx`
- `src/App.test.tsx`
- `src/main.tsx`
- `src/origin-top-ui.css`
- `src/components/SplashScreen.tsx`
- `src/components/personal/PersonalEditionApp.tsx`
- `tests/e2e/full-interaction-release-gate.spec.ts`
- `tests/e2e/origin-personal-navigation.spec.ts`
- exact-head Playwright and Lighthouse artifacts from Production Release CI/CD

### Answer / research
- `src/legacy/originChatResponsePolicy.ts`
- `src/legacy/originChatRouter.test.ts`
- `src/legacy/originResearchSource.ts`
- `src/legacy/originResearchSource.test.ts`
- `services/mission-engine/src/application/agent/ToolExecutor.ts`
- `services/mission-engine/src/__tests__/SecurityAndSafety.test.ts`

### Artifacts
- `src/artifacts/artifactGeneratorV12.ts`
- `src/artifacts/artifactGeneratorV12.test.ts`
- `src/artifacts/artifactV12Router.ts`
- `src/lib/orchestration/OriginCapabilityGuide.ts`

### Raster image path
- `src/creative/cloudflareRasterImageProviderV15.ts`
- `src/creative/cloudflareRasterImageProviderV15.test.ts`
- `src/creative/rasterImageV15Router.ts`
- `src/creative/rasterImageV15Router.test.ts`
- `src/creative/localRasterHistoryV15.ts`
- `src/creative/localRasterHistoryV15.test.ts`
- `src/creative/rasterImageCriticV15.ts`
- `src/creative/rasterTechnicalCriticV15.ts`

### Release / cost / provider truth
- `src/lib/orchestration/OriginFreeModelCatalog.ts`
- Issue `#742` current body
- PR `#741` current body
- exact-head GitHub workflow results
- exact-head Vercel Preview health

## Required output format

Return exactly these sections:

1. **Reviewer and target** — reviewer/model/product, exact audited SHA, evidence actually inspected.
2. **Verdict** — `PASS`, `CONDITIONAL PASS`, `FAIL`, or `INCOMPLETE`.
3. **P0/P1 blocking findings** — each must include path/symbol or evidence, failure scenario, impact, and minimal remediation.
4. **P2/P3 non-blocking findings** — same evidence standard.
5. **Claims-to-evidence matrix** — claim, runtime evidence, test/visual evidence, status.
6. **Negative tests / adversarial cases considered** — attempted scenario and result.
7. **Unverified areas** — state explicitly; do not infer PASS.
8. **Release disposition** — unresolved blockers only. Do not authorize merge/deployment.
9. **Confidence** — high/medium/low with one sentence.

A finding without a concrete path, observable failure scenario, or reproducible evidence is advisory, not blocking.

## Reviewer A — independent code / architecture / security

```text
Act as an independent principal engineer and application-security reviewer. Audit ORIGIN PR #741 at runtime candidate SHA a7459f9fccdd4b0cf7587d477f368a3ce8097f31 against main c3c428d566ef06c633ff1fe040af843091403154.

Do not trust prior conclusions. Trace real call paths and fail-closed behavior. Do not edit, merge, deploy, publish, request secrets, or change billing.

Focus on:
- alternate or legacy provider paths that could bypass the authoritative free-only policy;
- paid fallback, provider/model switching, unverifiable cost, quota exhaustion, and fail-open behavior;
- secret handling and whether credentials can reach client storage, URLs, logs, response bodies, or user-visible provenance;
- research SSRF, DNS rebinding, redirects, allowlist suffix mistakes, response-size limits, and source-constraint bypasses;
- artifact parser/generator malformed input, silent corruption, truncation, unsafe filenames, and false verification;
- raster provider plan verification, quota/paid-plan detection, response-envelope parsing, signature/dimension validation, and provenance integrity;
- imported/local image-history validation and unknown-provider rejection;
- race, retry, duplicate request, stale state, or cancellation paths that could violate policy;
- whether any current user-facing capability claim exceeds runtime evidence.

Normal CI success is not sufficient by itself. Use the required output format. PASS is prohibited if any P0/P1 remains or the exact runtime SHA cannot be inspected.
```

## Reviewer B — independent UX / content / accessibility / product truth

```text
Act as an independent senior product designer, accessibility reviewer, and product-truth auditor. Audit ORIGIN PR #741 at runtime candidate SHA a7459f9fccdd4b0cf7587d477f368a3ce8097f31.

Do not modify or deploy anything. Inspect the exact source, exact-head Playwright screenshots/report, E2E coverage, and Lighthouse evidence. Do not infer runtime guarantees from copy.

Focus on:
- first-use comprehension: can a non-technical user understand what to type and what ORIGIN can actually do;
- simple input-first hierarchy versus dashboard/SaaS clutter;
- mobile widths 320/375/390, desktop 1440, overlays, + menu dismissal, settings, history, safe areas, keyboard/focus behavior, and horizontal overflow;
- 44px touch targets, >=16px mobile form inputs, visible focus, contrast, semantic names, status/error announcements, keyboard-only paths, and screen-reader risks;
- consistency of iconography, typography, spacing, hierarchy, button labels, and terminology;
- image-generation unavailable/degraded states: no false success, no prompt substitution, no paid fallback language;
- Japanese/non-ASCII PDF limitation: the UI and capability copy must not imply it is supported;
- answer/artifact delivery states and whether verified language is backed by actual verification;
- whether any buttons/links appear actionable but are dead, misleading, or expose internal implementation jargon.

Compare principles—not visual copying—against mature conversational products. Automated accessibility checks do not replace a real named screen-reader session; mark that unverified unless performed. Use the required output format.
```

## Acceptance

This packet does not itself satisfy independent review.

PR #741 may clear the independent-review blocker only when:
- an independent code/architecture review and an independent UX/content/accessibility review both identify this exact runtime SHA;
- all P0/P1 findings are reconciled against source/evidence and resolved;
- deferred P2/P3 items are tracked separately where appropriate;
- reviews and disposition are recorded under `docs/reviews/`;
- runtime changes made after review trigger targeted re-review;
- owner approval remains separate from review, merge, and deployment.
