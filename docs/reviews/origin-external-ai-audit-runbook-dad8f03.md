# ORIGIN external-AI audit runbook — runtime candidate `dad8f03`

## Audit target

- Repository: `nori72ny/myAIspecials`
- Pull request: `#45`
- Runtime candidate SHA: `dad8f0327987edeab06ee4129274f1eb8ac76e56`
- Base branch: `main`
- Candidate branch: `audit/origin-runtime-alignment-v0-1`
- Candidate CI evidence: Production Release CI/CD, ACOS 2.0 Quality Gate, CodeQL Security Analysis, and OpenSSF Scorecard all completed successfully for the exact runtime candidate SHA.

This runbook may be committed after the runtime candidate. Review the exact runtime candidate SHA above, not an unpinned branch tip. A documentation-only commit containing this runbook does not alter the runtime candidate.

## Non-negotiable restrictions

The reviewer must not:

- merge or approve the pull request;
- deploy, publish, or run production infrastructure;
- change DNS, cloud, billing, accounts, credentials, repository settings, or branch protection;
- use paid AI execution or recommend a paid fallback as a runtime solution;
- request real credentials, private prompts, customer data, or production traces;
- claim ORIGIN is complete, perfect, best, or superior without reproducible evidence;
- treat documentation or UI text as proof of runtime behavior.

Use synthetic test data only. Report recommendations; do not edit the repository.

## Minimum evidence package to provide each reviewer

Provide the pull-request diff for `main...dad8f0327987edeab06ee4129274f1eb8ac76e56` plus these files at the exact candidate SHA:

### Authoritative runtime and disabled legacy boundaries

- `api/index.ts`
- `api/index.test.ts`
- `server.ts`
- `worker/index.mjs`
- `worker/index.test.mjs`
- `src/legacy/originChatBoundaryGuard.ts`
- `src/legacy/originChatBoundaryGuard.test.ts`
- `src/legacy/originLegacyProviderBoundaryGuard.ts`
- `src/legacy/originLegacyProviderBoundaryGuard.test.ts`
- `src/legacy/originChatRouter.ts`
- `src/legacy/originChatRouter.test.ts`
- `src/legacy/originChatValidation.ts`
- `src/legacy/originProviderClient.ts`
- `src/legacy/originProviderClient.test.ts`

### Orchestration, privacy, free-only, and review policy

- `src/lib/orchestration/SensitiveInputDetector.ts`
- `src/lib/orchestration/SensitiveInputDetector.test.ts`
- `src/lib/orchestration/OriginContextPolicy.ts`
- `src/lib/orchestration/OriginContextPolicy.test.ts`
- `src/lib/orchestration/OriginExecutionPolicy.ts`
- `src/lib/orchestration/OriginExecutionPolicy.test.ts`
- `src/lib/orchestration/OriginFreeModelCatalog.ts`
- `src/lib/orchestration/OriginFreeModelCatalog.test.ts`
- `src/lib/orchestration/OriginReviewPolicy.ts`
- `src/lib/orchestration/OriginReviewPolicy.test.ts`
- `src/lib/orchestration/OriginReviewSynthesis.ts`
- `src/lib/orchestration/OriginReviewSynthesis.test.ts`
- `src/lib/orchestration/OriginReviewedExecution.ts`
- `src/lib/orchestration/OriginReviewedExecution.test.ts`
- `src/lib/orchestration/MultiAIOrchestrator.ts`
- `src/lib/orchestration/MultiAIOrchestrator.test.ts`

### Approval and evaluator boundaries

- `services/mission-engine/src/application/usecases/ExecuteMissionUseCase.ts`
- `services/mission-engine/src/__tests__/MissionEngine.test.ts`
- `src/lib/evaluation/OriginAnswerSafetyEvaluator.ts`
- `src/lib/evaluation/OriginAnswerSafetyEvaluator.test.ts`

### User-facing Personal Edition

- `src/components/personal/PersonalDashboard.tsx`
- `src/components/personal/PersonalEditionApp.tsx`
- `src/components/personal/UnifiedChat.tsx`
- `src/components/personal/__tests__/PersonalDashboard.test.tsx`
- `src/components/personal/__tests__/UnifiedChat.test.tsx`
- `src/components/personal/__tests__/UnifiedChatErrorDetails.test.tsx`
- `tests/e2e/origin-personal-navigation.spec.ts`
- `tests/e2e/acos.spec.ts`

### Existing audit context

- `docs/reviews/origin-independent-audit-bad3ccc.md`
- `docs/reviews/origin-sanitized-trace-design.md`
- `docs/reviews/origin-runtime-alignment-phase-9.md`

If the reviewer cannot inspect the exact files or diff, its verdict must be `INCOMPLETE`, not `PASS`.

## Common required output format

Every reviewer must return exactly these sections:

1. **Verdict:** `PASS`, `CONDITIONAL PASS`, `FAIL`, or `INCOMPLETE`.
2. **Blocking findings:** P0 and P1 only, each with file path, symbol or line range, exploit/failure scenario, and minimal remediation.
3. **Non-blocking findings:** P2 and P3 with the same evidence standard.
4. **Claims-to-code matrix:** for privacy, free-only execution, no paid fallback, no automatic approval, disabled legacy provider paths, truthful routing/cost metadata, independent review status, and sanitized trace handling.
5. **Negative tests attempted:** state the bypass or failure case and observed result.
6. **Unverified areas:** anything not proven from supplied evidence.
7. **Confidence:** `high`, `medium`, or `low`, with a one-sentence reason.

A finding without a concrete code path or reproducible scenario is advisory, not blocking.

## Reviewer 1 — Claude: architecture and safety boundary audit

Paste the following prompt with the evidence package:

```text
You are an independent senior application-security and distributed-systems reviewer. Audit ORIGIN pull request #45 at exact runtime candidate SHA dad8f0327987edeab06ee4129274f1eb8ac76e56 against main.

Do not trust documentation, comments, UI labels, test names, or prior audit conclusions unless the runtime code and tests independently support them. Do not edit, merge, deploy, publish, or request credentials. Use synthetic examples only.

Primary questions:
1. Can any request reach a legacy or alternative provider path that bypasses the authoritative /api/chat policy?
2. Can sensitive input, assistant-history secrets, oversized content, or hidden context reach an external provider before blocking or minimization?
3. Can execution exceed a verified zero-dollar ceiling, use a paid fallback, switch provider/model automatically, or present cost/routing metadata not derived from the actual served route?
4. Can Mission Engine or any orchestration path approve or execute without explicit owner approval?
5. Can reviewer failure, timeout, malformed output, or synthesis logic silently become approval or a verified answer?
6. Are error bodies, logs, trace IDs, or audit records capable of leaking secrets?
7. Are race conditions, stale React state, retries, or duplicate requests able to violate policy?

Attempt adversarial call-path analysis, not only local function review. Trace entry points through guards, router, provider client, review policy, mission execution, and UI. Use the required output format from the runbook. PASS is prohibited if any P0/P1 remains or the exact SHA cannot be inspected.
```

## Reviewer 2 — Gemini in Google AI Studio: UI, accessibility, and runtime-truth audit

Google AI Studio and the Gemini app are not independent model families for this purpose. Run one Gemini review through AI Studio with uploaded files; do not count a second Gemini-chat review as an independent audit.

```text
Act as an independent frontend, accessibility, and product-truth reviewer. Audit ORIGIN pull request #45 at exact runtime candidate SHA dad8f0327987edeab06ee4129274f1eb8ac76e56.

Do not modify or deploy anything. Do not infer runtime guarantees from copy. Compare every important user-facing promise against server/runtime behavior and tests.

Review at least:
- Japanese-first comprehension and whether a new user can state one outcome without selecting a model or agent;
- mobile first-load navigation, sidebar behavior, keyboard handling, composer sizing, focus visibility, and screen-reader naming;
- Enter versus Shift+Enter behavior, empty/whitespace submission, duplicate submission, loading state, and retry behavior;
- error-state clarity, hidden technical details, support reference IDs, and whether secret-block errors offer unsafe retry/settings actions;
- whether “free”, “verified”, “independent verification”, “execution completed”, model, cost, and selection reason are truthful for missing, malformed, or contradictory metadata;
- whether healthy/unknown AI status is hidden without concealing degraded or unavailable conditions;
- fake projects, enterprise upsell, provider toggles, or unimplemented options that could mislead users;
- WCAG 2.2 AA issues visible from code and automated tests, while explicitly stating that automated checks do not replace a real screen-reader session.

Attempt concrete keyboard-only and narrow-viewport failure scenarios. Use the required output format. Mark real screen-reader behavior as unverified unless actually tested with a named screen reader and browser.
```

## Reviewer 3 — Grok: adversarial fail-open and claim-challenge audit

The owner wrote “grow”; this runbook treats that as xAI Grok. If a different product was intended, substitute it only after identifying the exact service and model.

```text
Perform a hostile red-team review of ORIGIN pull request #45 at exact runtime candidate SHA dad8f0327987edeab06ee4129274f1eb8ac76e56. Your job is to disprove the safety and truthfulness claims, not to summarize the implementation.

No edits, merges, deployments, credentials, private data, or paid execution. Use only supplied code/diff and synthetic attacks.

Try to construct at least twelve bypasses across:
- alternate HTTP methods, routes, worker endpoints, legacy handlers, import order, and middleware order;
- malformed JSON, unexpected roles, duplicated latest messages, Unicode/encoding tricks, secret fragments split across messages, assistant-history secrets, and oversized input;
- zero-cost metadata missing, negative, NaN-like, string-typed, contradictory, or reported for a different provider/model;
- stale/free-model catalog evidence, implicit fallbacks, retries, timeouts, and provider error normalization;
- approval callbacks, replayed approvals, reviewer timeout/failure, synthesis ambiguity, and auto-approval regressions;
- trace/error/log leakage and user-visible technical identifiers;
- frontend double-submit, stale state, initialPrompt replay, navigation reset, and mobile overlay failures.

For every attempted bypass, identify the exact code path and whether it succeeds, fails closed, or cannot be determined. Do not give PASS merely because tests exist. Use the runbook output format.
```

## Reviewer 4 — Genspark: cross-document consistency and release-evidence synthesis

Genspark may combine multiple models and tools, so treat its result as a synthesis review, not proof of an independent model consensus.

```text
Audit the evidence consistency of ORIGIN pull request #45 at exact runtime candidate SHA dad8f0327987edeab06ee4129274f1eb8ac76e56.

Do not modify, merge, deploy, publish, or request credentials. Build a traceable matrix connecting PR claims, runtime code, tests, CI evidence, and existing audit documents.

Required tasks:
1. Identify claims that are proven by exact runtime code and tests.
2. Identify claims supported only by documentation, UI copy, mocks, or design contracts.
3. Identify stale conclusions from earlier SHAs that do not automatically apply to dad8f03.
4. Check that all four required workflows refer to the exact candidate SHA and distinguish workflow success from product correctness.
5. Detect contradictions among PR description, phase documents, independent audit, sanitized-trace design, and current UI/runtime.
6. Produce a release-blocker checklist separating technical pass, external audit, real screen-reader verification, owner hands-on acceptance, merge approval, and deployment approval.
7. Do not recommend declaring ORIGIN complete, perfect, best, or superior.

Use the required output format and cite every conclusion to a file path, code symbol/line, test, or workflow record. Return INCOMPLETE when source evidence is unavailable.
```

## Acceptance rule

External review is sufficient to proceed to owner acceptance only when:

- Claude and Grok report no unresolved P0/P1 findings;
- Gemini/AI Studio reports no unresolved P0/P1 user-truth or accessibility-code findings;
- Genspark finds no material claim-to-evidence contradiction;
- every reviewer audited the exact runtime SHA and disclosed unverified areas;
- any disagreement is resolved against the safer interpretation;
- all remediation commits receive fresh CI and, when they affect an audited boundary, a targeted re-audit.

Even then, the pull request remains Draft until the owner explicitly authorizes a state change. External AI review does not authorize merge or deployment and does not replace hands-on owner acceptance or real assistive-technology testing.
