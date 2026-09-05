# ORIGIN Engineering Handover

> Operational source of truth for the next AI engineer/agent. Always validate volatile claims against the live repository, CI, and production.

## 0. Mission
ORIGIN Personal is a personal AI / Agentic Coding OS and PWA. The current product track is V2 intelligence + capability routing, with a safe agentic-coding foundation already established. The product goal is a reliable general-purpose AI workbench for coding, research, writing, analysis, business work, artifacts, and multimodal workflows.

## 1. Non-negotiable constraints
1. **$0 is hard policy.** No paid API, paid model, billable fallback, or ambiguous-cost provider.
2. If $0 cannot be proven, fail closed.
3. Never fake provider/tool/build/runtime success.
4. Never expose API keys, credentials, tokens, private keys, or sensitive content.
5. Agent repository writes stay inside the server-owned repository root and use bounded atomic/race-resistant primitives.
6. Verification is ORIGIN-owned, bounded, deterministic, and must not execute arbitrary repository lifecycle hooks.
7. Do not weaken security tests to make CI green.
8. Do not claim production readiness without exact-HEAD evidence.
9. Keep the legacy Mission Engine outside Personal production unless a new security/release review explicitly approves otherwise.
10. Provider routing must preserve explicit cost/privacy evidence.

## 2. Current exact release state
- Repository: `nori72ny/myAIspecials`
- Production main SHA: `6ca8136d6a27336a52dd6fc37f91e469e2975dba`
- PR #162: merged — bounded Gemini free-tier secondary route.
- Production deployment: READY for the exact SHA above.
- Production `/api/health`: HTTP 200 and release SHA matches `6ca8136d6a27336a52dd6fc37f91e469e2975dba`.
- Recent Vercel runtime-error check: no runtime errors in the selected window.
- Vercel build completed successfully; the `allow-scripts` messages are warnings, not proof of failure, and must remain monitored.

## 3. Provider policy
### OpenRouter
Primary route. Use an exact audited free model and preserve `data_collection: deny`, ZDR, and zero pricing evidence. Do not silently select a paid model.

### Gemini
Secondary route only. It is enabled only when `ORIGIN_GEMINI_FREE_ONLY=true` and `GEMINI_API_KEY` exists. The route uses an exact allowlisted Gemini free model and does not enable paid tools or grounding. Gemini Free Tier has a different data-use/privacy policy from the OpenRouter ZDR route, so do **not** describe Gemini as ZDR or data-collection-deny. Sensitive-input egress is blocked. If the free-only operational guard cannot be established, Gemini is disabled and the request fails closed.

### Provider failover invariant
A user request may try OpenRouter once and, when eligible, Gemini once. Never retry the same provider in a loop. Never fall back to a paid provider/model. Every successful response must carry provider/model/attempt/fallback/cost evidence.

## 4. Capability routing
`src/lib/orchestration/OriginCapabilityRouter.ts` provides deterministic capability classification for `answer`, `research`, `coding`, `writing`, and `analysis`. Explicit capability selection overrides keyword classification. Routing is local/deterministic and does not choose paid models.

## 5. Agentic-coding security foundation
- Deployment-authenticated, one-time approval is required for mutating actions.
- Approval is bound to exact normalized action/tool/params and expires quickly.
- Repository root is server-owned.
- Safe reader/writer/deleter use descriptor-based race defenses and atomic writes on supported Linux paths; unsupported platforms fail closed.
- Checkpoint rollback is optimistic-concurrency guarded and verifies the restored state.
- Verification commands are ORIGIN-owned; do not replace them with arbitrary `npm run` execution.
- Network and unrestricted shell remain denied by default.

## 6. Release gate
For every release candidate, verify the **exact current HEAD**: lint, typecheck, complete unit/integration tests, production build, Node/serverless runtime checks, configured E2E/Lighthouse/security/secret-scan/CodeQL gates, benchmark/security regression, exact deployment evidence, production smoke evidence, and current $0/provider evidence. Pending, skipped, missing, or stale evidence is not PASS.

## 7. Current known next work
1. Remove any remaining whole-request retry amplification around the provider executor; provider-level routing already has bounded one-attempt-per-provider behavior.
2. Add/maintain regression coverage proving OpenRouter 429/5xx -> eligible Gemini once, no same-provider retry, sensitive input blocks Gemini, paid model IDs are rejected, and the total latency budget is bounded.
3. Validate the Gemini deployment flag/configuration in the live environment without exposing credentials; never infer that a configured API key is free unless the explicit free-only guard is present.
4. Continue V2 capability routing into research/coding/artifact lanes without one giant rewrite.
5. Improve mobile/PWA UX and resilient streaming only after the provider safety invariants remain green.

## 8. Operating procedure
1. Fetch current main SHA, open PRs, changed files, exact CI runs/jobs, and production deployment.
2. Reproduce failures before changing code.
3. Make the smallest safe change and add a regression test.
4. Re-run all relevant gates on the new exact SHA.
5. Review diffs for cost leakage, privacy downgrade, permission broadening, secret exposure, network/shell expansion, and path escape.
6. Merge/deploy only with exact-HEAD evidence.
7. Continue in meaningful batches; do not stop for trivial approval checkpoints.

## 9. Definition of done
ORIGIN is not done because the UI renders or build is green. Production work must be reproducible, secure, bounded, verified, observable, and actually useful. Provider failure must produce an honest graceful result, never a fabricated success.

_Last updated 2026-09-05 JST after production SHA `6ca8136d6a27336a52dd6fc37f91e469e2975dba`._