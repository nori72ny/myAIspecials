# ORIGIN Independent Source Audit — Candidate `bad3ccc`

- Repository: `nori72ny/myAIspecials`
- Pull request: #45
- Exact candidate SHA: `bad3ccca0c6e04c95ece8e1977b980516e6faf7e`
- Reviewer: OpenAI GPT-5.6 Thinking
- Review date: 2026-07-20
- Access mode: GitHub source review and GitHub Actions job review
- Not used: deployment, real credentials, private prompts, paid execution, live provider requests, account-level provider settings, manual screen reader, rendered visual inspection

## Verdict

**BLOCK owner hands-on acceptance and keep PR #45 as a Draft.**

This candidate has a healthy automated baseline. The previously identified mounted provider-route bypasses are fail-closed, non-interactive Mission Engine execution no longer auto-approves human approval requests, and the internal answer-safety evaluator now covers mixed positive/negative clauses, Markdown examples, contractions, and common affirmative paraphrases.

Owner acceptance remains blocked because the minimum primary-plus-independent-reviewer loop is not connected to the live chat path, the unified trace is not durably recorded, rendered Japanese UX and real screen-reader verification are incomplete, and disabled legacy implementations still contain unsupported execution/evidence claims that would become dangerous if their guards were removed or reordered.

This is not a merge or deployment recommendation.

## Automated evidence reviewed

For candidate `bad3ccca0c6e04c95ece8e1977b980516e6faf7e`, all required workflows completed successfully:

- Production Release CI/CD
- ACOS 2.0 Quality Gate
- CodeQL Security Analysis
- OpenSSF Scorecard

The Production matrix passed on Node.js 22 and Node.js 24, including dependency installation, security audit, TypeScript/design-token lint, build, unit tests, Playwright browser installation, E2E tests, Lighthouse, Gitleaks, dependency review, evidence upload, and SBOM generation.

Automated success is regression evidence. It does not establish Issue #44 completion or prove live provider behavior.

## Findings closed since candidate `617a283`

### Auto-approval in Mission Engine execution

`ExecuteMissionUseCase` no longer injects a production auto-approval callback. An approval callback must be explicitly supplied. Without one, execution returns while the organization remains in `AWAITING_HUMAN_APPROVAL`, `APPROVAL_TIMED_OUT`, or `REJECTED`, and it does not mark tasks or the mission complete.

The integration test supplies an explicit test-only approval handler so deterministic test coverage does not reintroduce a production approval bypass.

Disposition: **closed for the reviewed use case**. Route guards remain required because the Mission Engine provider paths have not been migrated to the ORIGIN execution policy.

### Internal answer-safety evaluator adversarial gaps

The evaluator remains internal-only. This candidate adds handling and tests for:

- a refusal and an affirmative action in the same sentence;
- Markdown fenced code, inline code, and blockquote examples;
- contractions such as `I'll merge` and `I won't merge`;
- `going to deploy` and comparable affirmative forms;
- neutral references that discuss merge/deployment without claiming execution.

Disposition: **materially improved, residual risk accepted for internal-only use**. Do not use it as a production safety gate or approval signal without another independent validity review.

## Provider-transmission boundary status

### Enabled authoritative route

- `POST /api/chat`

The route validates input, handles weather clarification locally, blocks likely sensitive input before transmission, minimizes context, builds a server-enforced free-only plan, invokes one dedicated OpenRouter client, verifies accepted zero-cost execution, and reports the provider/model from the executed plan.

### Disabled before later handlers

- all methods: `/api/v1/validate-mission`
- all methods: `/api/analyze`
- all methods: `/api/generate-image`
- all methods: `/api/swarm/run`
- POST: `/api/v1/missions`
- POST: `/api/v1/missions/:missionId/execute`
- POST: `/api/v1/executive/run`
- Worker POST: `/api/v1/ai/free-chat`

These routes remain unavailable until migrated to the same sensitive-input, data-policy, free-only, routing-evidence, approval, timeout, trace, and truthful-status controls.

## Remaining blockers

### High — Minimum independent-review loop is not connected

The live `/api/chat` result still reports verification as not run. The repository contains review and synthesis components, but the authoritative route does not execute a primary-plus-independent-reviewer request end to end.

Required disposition:

- connect the reviewed execution path under the same free-only and privacy controls, or explicitly defer it and keep owner acceptance blocked;
- prove reviewer skip/value policy and conclusion-first synthesis with deterministic tests.

### Medium — Unified trace is not durable

The response includes a trace ID and routing metadata, but plan, transmission decision, execution, verification, cost, and outcome are not stored in one durable sanitized audit record.

Required disposition:

- record one trace through the existing audit abstraction without storing source secrets or full private prompts;
- add tests for successful, blocked, policy-rejected, and provider-failure traces.

### Medium — Disabled legacy code retains unsafe claims

Guarded legacy modules still contain auto-generated claims about research, verification, hallucination rate, testing, consensus, persistence, and deployment approval that are not established by recorded evidence.

Required disposition:

- keep the entrypoint guards authoritative;
- delete or rewrite the dormant claims before re-enabling any route;
- add route-order regression tests so refactoring cannot silently bypass the guards.

### Medium — Manual accessibility and rendered UX evidence is incomplete

No real NVDA + Firefox or VoiceOver + Safari session was performed for this exact candidate, and no independent rendered Japanese UX review was completed.

Required disposition:

- complete these only after technical blockers are resolved and before owner hands-on acceptance.

## Residual risks and untested areas

- No real OpenRouter or Gemini credential was used.
- No external provider request was sent.
- No deployment or serverless runtime was exercised.
- No account-level provider privacy, logging, budget, or region settings were inspected.
- No load, concurrency, abuse-rate, cache-hit, or denial-of-service test was performed.
- The answer-safety evaluator is not a complete natural-language policy verifier.
- Disabled legacy code remains in the repository and depends on route-order guards for safety.

## Required next sequence

1. Keep PR #45 as Draft and preserve all provider-route guards.
2. Add a durable sanitized trace for the authoritative chat path.
3. Connect or explicitly defer the independent-review and synthesis loop.
4. Remove or rewrite unsupported claims in dormant legacy routes before any re-enablement.
5. Produce a new exact candidate SHA and rerun the complete automated audit set.
6. Perform independent source review of that exact SHA.
7. Perform rendered Japanese UX and real screen-reader verification.
8. Request owner hands-on review only after all Critical and High findings are closed.

## Restrictions preserved

- No merge
- No deployment
- No DNS, Cloudflare, billing, account, credential, or repository-setting change
- No paid execution
- No real secret or private prompt content
- No claim that ORIGIN or Issue #44 is complete
