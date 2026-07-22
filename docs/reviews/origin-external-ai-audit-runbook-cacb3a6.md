# ORIGIN external-AI audit runbook — runtime candidate `cacb3a6`

## Exact audit target

- Repository: `nori72ny/myAIspecials`
- Pull request: `#45`
- Runtime candidate SHA: `cacb3a6ebb0a9e5c6c3611c14ed7a7ce5cbbc3a6`
- Base: `main`
- Branch: `audit/origin-runtime-alignment-v0-1`
- Required CI at this SHA: Production Release CI/CD, CodeQL Security Analysis, ACOS 2.0 Quality Gate, and OpenSSF Scorecard — all succeeded.

This document may be committed after the runtime candidate. Review the exact SHA above, not the moving branch tip. The documentation-only commit containing this runbook does not alter the runtime candidate.

## Restrictions

The reviewer must not merge, deploy, publish, change DNS/cloud/billing/accounts/credentials/repository settings, request real secrets or private data, or use paid AI execution. Use synthetic inputs only. Documentation, UI text, and test names are not proof of runtime behavior.

## Required evidence

Inspect the `main...cacb3a6ebb0a9e5c6c3611c14ed7a7ce5cbbc3a6` diff and, at minimum:

- `api/index.ts`, `server.ts`, `worker/index.mjs`
- `src/legacy/originChatBoundaryGuard.ts`
- `src/legacy/originLegacyProviderBoundaryGuard.ts`
- `src/legacy/originChatRouter.ts`
- `src/legacy/originChatValidation.ts`
- `src/legacy/originProviderClient.ts`
- `src/lib/orchestration/SensitiveInputDetector.ts`
- `src/lib/orchestration/OriginContextPolicy.ts`
- `src/lib/orchestration/OriginExecutionPolicy.ts`
- `src/lib/orchestration/OriginFreeModelCatalog.ts`
- `src/lib/orchestration/OriginReviewPolicy.ts`
- `src/lib/orchestration/OriginReviewSynthesis.ts`
- `src/lib/orchestration/OriginReviewedExecution.ts`
- `services/mission-engine/src/application/usecases/ExecuteMissionUseCase.ts`
- `src/components/personal/UnifiedChat.tsx`
- corresponding unit, integration, worker, and E2E tests.

If the exact SHA or required files cannot be inspected, verdict must be `INCOMPLETE`.

## Required output

1. Verdict: `PASS`, `CONDITIONAL PASS`, `FAIL`, or `INCOMPLETE`.
2. Blocking findings: P0/P1 only, with file, symbol/line, failure scenario, and minimal remediation.
3. Non-blocking findings: P2/P3 with the same evidence standard.
4. Claims-to-code matrix covering privacy, free-only execution, no paid fallback, approval boundary, legacy-route blocking, truthful routing/cost metadata, reviewer status, and sanitized traces.
5. Negative tests attempted and observed outcome.
6. Unverified areas.
7. Confidence: high/medium/low with reason.

## External reviewer prompt

```text
Act as an independent senior application-security, distributed-systems, and product-truth reviewer. Audit ORIGIN PR #45 at exact SHA cacb3a6ebb0a9e5c6c3611c14ed7a7ce5cbbc3a6 against main.

Do not edit, merge, deploy, publish, request credentials, use private data, or use paid execution. Do not trust documentation, comments, UI claims, or test names unless runtime code and reproducible tests support them.

Attempt to disprove these claims:
1. Every live chat request reaches the authoritative /api/chat boundary before any provider execution.
2. Sensitive content is blocked before provider transmission and source values are not exposed in errors or traces.
3. Provider-bound context is bounded and minimized according to the implemented policy.
4. Execution is restricted to an explicitly evidenced OpenRouter free model, with a hard $0.00 ceiling and no automatic provider/model fallback.
5. Returned model, provider, cost, routing, and verification metadata describe the actual executed plan.
6. Provider failures, malformed responses, timeouts, stale model evidence, and missing credentials fail closed.
7. Mission or orchestration paths cannot approve or execute owner-controlled actions automatically.
8. Legacy handlers, workers, alternate routes/methods, middleware order, retries, and UI double-submission cannot bypass policy.
9. The weather fast path does not make current-data claims and the former polynomial regular expression issue is removed without introducing classification regressions.

Try malformed roles, assistant-ending conversations, split secrets, Unicode variants, oversized input, stale evidence, contradictory cost metadata, missing API keys, retry/fallback behavior, alternate entry points, and duplicate requests. Cite exact code paths. A finding without a concrete failure path is advisory, not blocking.

Return exactly the required output sections from this runbook. PASS is prohibited if any P0/P1 remains or exact-SHA evidence is incomplete.
```

## Acceptance rule

External review permits progression only when no unresolved P0/P1 remains, every conclusion is tied to the exact runtime SHA, disagreements are resolved toward the safer interpretation, and any remediation receives fresh CI and targeted re-review. The PR remains Draft until the owner explicitly authorizes a state change. External review never authorizes merge or deployment.