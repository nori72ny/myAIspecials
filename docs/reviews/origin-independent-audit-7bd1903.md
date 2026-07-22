# ORIGIN Independent Source Audit — Candidate `7bd1903`

- Repository: `nori72ny/myAIspecials`
- Pull request: #45
- Exact candidate SHA: `7bd1903bbe2f25d2e4d3d0dcf6f358ab61f604fb`
- Reviewer: OpenAI GPT-5.6 Thinking
- Review date: 2026-07-19
- Access mode: GitHub source review, GitHub Actions job/artifact review, and official OpenRouter documentation review
- Not used: production deployment, real credentials, private prompts, paid execution, live provider request, manual screen reader

## Verdict

**BLOCK owner hands-on acceptance and keep PR #45 as a Draft.**

The exact candidate has a healthy automated baseline and materially improves the primary `/api/chat` path. However, Critical and High findings remain because other mounted provider-transmission paths bypass the new ORIGIN policy boundary, one path automatically approves a human-approval request, and the minimum primary-plus-independent-review loop is not connected to the live chat path.

This is not a merge or deployment recommendation.

## Automated evidence reviewed

For candidate `7bd1903bbe2f25d2e4d3d0dcf6f358ab61f604fb`, the following GitHub Actions workflows completed successfully:

- Production Release CI/CD
- ACOS 2.0 Quality Gate
- CodeQL Security Analysis
- OpenSSF Scorecard

The production matrix passed on Node.js 22 and Node.js 24, including dependency install, security audit, lint, build, unit tests, Playwright E2E, Lighthouse, Gitleaks, dependency review, evidence upload, and SBOM generation.

Automated success is treated as regression evidence, not as proof that Issue #44 is complete.

## Controls that passed source review

### A. Primary chat boundary

The server and serverless entrypoint mount `createOriginChatRouter()` before the legacy router and place a boundary guard behind it so `/api/chat` cannot silently fall through to the historical handler.

Evidence:

- `server.ts:148-155`
- `api/index.ts:17-22`

### B. Primary-chat pre-transmission checks

The authoritative chat router validates message structure, requires the final message to be a user message, handles weather clarification locally, checks the full conversation for likely sensitive input, minimizes context, and builds a server-side execution plan before provider execution.

Evidence:

- `src/legacy/originChatRouter.ts:76-176`

### C. Free-only and routing checks

The current plan is restricted to an explicit `:free` model, zero estimated cost, disabled provider fallbacks, `data_collection: deny`, ZDR-only routing, and zero maximum provider price. The response is discarded unless reported usage cost is exactly zero and router metadata proves a single successful attempt with no fallback.

Evidence:

- `src/lib/orchestration/OriginExecutionPolicy.ts:21-49,66-76,92-143`
- `src/legacy/originProviderClient.ts:131-215,218-315`

The official OpenRouter model page showed `moonshotai/kimi-k2.6:free` with price `Free` during this review. Official OpenRouter documentation also confirms the request fields `allow_fallbacks`, `data_collection`, `zdr`, and `max_price`, plus the opt-in `X-OpenRouter-Metadata: enabled` response metadata used by the client.

## Findings

### F-01 — Critical — Other mounted provider routes bypass the ORIGIN execution boundary

The new control is authoritative only for `/api/chat`. Other live routes can transmit user-supplied content to external providers without the same sensitive-input, free-only, cost, provider-data, approval, timeout, routing-evidence, and trace controls.

Examples:

1. `/api/v1/validate-mission` sends `request` and `output` to Gemini whenever `GEMINI_API_KEY` is configured.
   - `server.ts:54-143`
2. `/api/analyze` is mounted before the protected chat route and calls `callLLM` with the user prompt plus organization state.
   - `server.ts:145-158`
   - `src/legacy/analyzeRoute.ts:20-165,313-340`
3. `/api/generate-image` sends the raw prompt to `gemini-2.5-flash-image`.
   - `src/legacy/legacyRoutes.ts:47-84`

Impact:

- Sensitive content can leave the application without the new detector.
- Execution can use a provider/model that is not selected by the ORIGIN plan.
- Zero-cost status is not established before execution.
- Provider policy and actual routing are not verified.
- A configured legacy credential changes behavior silently.

Required disposition:

- Route every external-provider call through one authoritative execution gate, or fail closed by disabling the endpoint until migrated.
- Add route-level tests proving sensitive-input blocking, zero-cost enforcement, no automatic provider fallback, and no executor call on policy failure.

### F-02 — Critical — Human approval is automatically granted in `/api/analyze`

`onApprovalRequired` resolves approval as `true` with the reason `System-approved non-interactive API analysis`.

Evidence:

- `src/legacy/analyzeRoute.ts:141-147`

This directly conflicts with the project rule that Human Approval cannot be auto-approved in production and with Issue #44's requirement that approval thresholds prevent execution when unmet.

Required disposition:

- Remove automatic approval.
- Return a stable approval-required outcome without executing the gated action.
- Require an explicit, attributable owner decision before resuming.

### F-03 — High — `/api/analyze` emits execution and evidence claims before they are established

The SSE stream reports statements such as:

- `Research Agent: Querying primary sources...`
- `Retrieved 3 authoritative database indexes and legal citations.`
- `hallucination rate (0% confirmed).`

These messages are emitted before the provider synthesis and without evidence that those actions or results occurred.

Evidence:

- `src/legacy/analyzeRoute.ts:69-125`

Impact:

- Planning is presented as completed execution.
- Source retrieval and verification are represented as facts without traceable evidence.
- The user can receive a false impression of external research and zero hallucination.

Required disposition:

- Replace simulated completion claims with truthful stage language such as `preparing`, `not verified`, or `not connected`.
- Emit evidence claims only from recorded tool/provider results.

### F-04 — High — The minimum independent-review loop is not connected to live chat

The live `/api/chat` response always reports `verificationStatus: "not-run"` and explicitly states that independent verification and synthesis are not executed.

Evidence:

- `src/legacy/originChatRouter.ts:177-205`

The repository contains deterministic review policy, synthesis, and reviewed-execution modules, but the authoritative chat router does not invoke them.

Impact:

- Issue #44's primary-plus-independent-reviewer loop is incomplete.
- No conclusion-first synthesized result is produced from independent execution.

Required disposition:

- Either connect the reviewed execution path end to end under free-only constraints, or keep the feature explicitly unavailable and do not advance owner acceptance.

### F-05 — Medium — The chat trace is response-local rather than a unified persisted audit trace

The router returns a generated request ID and execution metadata, but it does not record the plan, transmission decision, provider execution, verification state, cost, and outcome in one durable audit record.

Evidence:

- `src/legacy/originChatRouter.ts:71-74,170-205`

Impact:

- Post-incident reconstruction depends on client-captured responses.
- The Issue #44 unified-trace requirement is not met.

Required disposition:

- Record sanitized trace events in the existing audit abstraction without storing secret source values or full private prompts.

### F-06 — Medium — The answer-safety evaluator remains internal-only and has adversarial gaps

The evaluator is not connected to the live chat response path, which is the correct disposition until independent validity work is complete. Source review found likely gaps that should be covered before integration:

- A negative phrase anywhere in the same punctuation-delimited clause suppresses the whole clause. Example: `I will not merge A, but I will merge B` can be treated as safe because the negative expression is found before the positive action.
- Markdown fenced code, inline backticks, and block quotes are not masked by the current quote handling.
- Common affirmative paraphrases such as `I'll merge`, `going to deploy`, and equivalent Japanese forms are not comprehensively modeled.

Evidence:

- `src/lib/evaluation/OriginAnswerSafetyEvaluator.ts:28-50,52-60,101-124`

Required disposition:

- Keep the evaluator internal-only.
- Add adversarial tests for mixed positive/negative actions, Markdown code/examples, contractions, paraphrases, and multiple targets in one sentence.
- Re-audit before using it as a production safety gate or approval signal.

### F-07 — Medium — Strict router-metadata verification can reject valid cache hits

The provider client correctly fails closed when `openrouter_metadata` is missing. Official OpenRouter documentation states that cache-hit responses omit router metadata. The request does not explicitly establish a no-cache guarantee.

Evidence:

- `src/legacy/originProviderClient.ts:167-215,247-292`

Impact:

- A legitimate zero-cost response can be discarded as routing-unverified.
- This is an availability risk, not a cost-policy bypass.

Required disposition:

- Establish and test a no-cache execution mode if the API supports it, or retrieve equivalent immutable routing evidence through a documented generation record path before accepting the answer.
- Continue to fail closed if routing cannot be proven.

## Issue #44 status after this audit

### P0 / runtime alignment

- Primary `/api/chat` authoritative boundary: **implemented for that route**
- Provider shown equals provider executed: **implemented for accepted `/api/chat` responses**
- Sensitive input before every provider transmission: **not complete**
- Provider data-policy enforcement: **implemented for `/api/chat`, not global**
- Free-only and automatic-provider exclusion: **implemented for `/api/chat`, not global**
- Estimated cost and zero ceiling: **implemented for `/api/chat`, not global**
- Approval threshold enforcement: **failed by `/api/analyze` auto-approval**
- Retry/timeout/fallback policy cannot bypass controls: **implemented for `/api/chat`, not demonstrated globally**
- Unapproved OpenRouter-to-Gemini fallback removed or gated: **not complete globally**
- UI settings truthful/enforced: **substantially improved; rendered independent audit still pending**
- Planning-versus-execution wording accurate: **failed by `/api/analyze` progress messages**

### Minimum ORIGIN loop

- Single-provider request: **implemented in source for `/api/chat`; live credential execution not tested in this audit**
- Primary plus independent reviewer: **not implemented end to end**
- Reviewer value/skip policy: **deterministic module exists, live integration incomplete**
- Synthesized conclusion: **module exists, live integration incomplete**
- Unified trace: **not complete**

### Integrated audit candidate

- Exact candidate SHA: **yes**
- Matching automated evidence: **yes**
- Manual NVDA/Firefox or VoiceOver/Safari: **not complete**
- Exact-candidate security/privacy audit: **this source audit completed, blocking findings remain**
- Adversarial cost-bypass audit: **partial source review only**
- Rendered Japanese UX/accessibility audit: **not complete**
- Provider adaptability audit: **partial; live provider evidence not tested**
- Evaluator validity audit: **completed at source level with Medium findings; keep internal-only**

## Untested areas

- No real OpenRouter or Gemini credential was used.
- No provider request was sent.
- No production/serverless deployment was exercised.
- No account-level OpenRouter privacy, logging, budget, or provider settings were inspected.
- No provider-region or endpoint-eligibility response was observed.
- No manual screen-reader test was performed.
- No rendered visual review was performed in this audit.
- No load, concurrency, abuse-rate, or denial-of-service test was performed.

## Required next sequence

1. Inventory every mounted provider-transmission endpoint.
2. Remove the `/api/analyze` automatic approval bypass.
3. Route legacy provider calls through the authoritative policy boundary or disable them fail-closed.
4. Replace simulated execution/evidence statements with truthful status reporting.
5. Add global route tests for sensitive-input, cost, fallback, approval, and actual-provider invariants.
6. Connect or explicitly defer the independent-review loop and unified trace.
7. Resolve the evaluator adversarial cases while keeping it internal-only.
8. Produce a new exact candidate SHA and rerun the full automated and independent audit set.
9. Complete real screen-reader and owner hands-on review only after Critical and High findings are closed.

## Restrictions preserved

- No merge
- No deployment
- No DNS, Cloudflare, billing, account, credential, or repository-setting change
- No paid execution
- No real secret or private prompt content
- No claim that ORIGIN or Issue #44 is complete
