# ORIGIN Independent Source Audit — Candidate `617a283`

- Repository: `nori72ny/myAIspecials`
- Pull request: #45
- Exact candidate SHA: `617a283fcbd2fd8269c98bb7e8d3fd05f886a675`
- Reviewer: OpenAI GPT-5.6 Thinking
- Review date: 2026-07-20
- Access mode: GitHub source review and GitHub Actions job review
- Not used: deployment, real credentials, private prompts, paid execution, live provider requests, account-level provider settings, manual screen reader, rendered visual inspection

## Verdict

**BLOCK owner hands-on acceptance and keep PR #45 as a Draft.**

The exact candidate has a healthy automated baseline and closes the previously identified live provider-route bypasses by failing closed at every mounted server, serverless, and Worker entrypoint found in this audit. The authoritative `/api/chat` path remains the only enabled provider-transmission route.

Owner acceptance is still blocked because the minimum primary-plus-independent-reviewer loop is not connected, the unified trace is not durably recorded, and disabled legacy implementations still contain unsafe auto-approval and unsupported execution/evidence claims that would become dangerous if their guards were removed or reordered.

This is not a merge or deployment recommendation.

## Automated evidence reviewed

For candidate `617a283fcbd2fd8269c98bb7e8d3fd05f886a675`, all required workflows completed successfully:

- Production Release CI/CD
- ACOS 2.0 Quality Gate
- CodeQL Security Analysis
- OpenSSF Scorecard

The production matrix passed on Node.js 22 and Node.js 24, including dependency installation, security audit, TypeScript/design-token lint, build, unit tests, Playwright browser installation, E2E tests, Lighthouse, Gitleaks, dependency review, evidence upload, and SBOM generation.

Automated success is regression evidence. It does not establish Issue #44 completion or prove live provider behavior.

## Provider-transmission inventory

### Enabled authoritative route

`POST /api/chat`

The route validates messages, requires a final user message, handles weather clarification locally, blocks likely sensitive input before transmission, minimizes context, builds a server-side free-only plan, invokes one dedicated OpenRouter execution client, verifies zero actual cost, and returns the provider/model used by the accepted result.

Evidence:

- `src/legacy/originChatRouter.ts`
- `src/legacy/originProviderClient.ts`
- `src/lib/orchestration/OriginExecutionPolicy.ts`
- `src/lib/orchestration/OriginContextPolicy.ts`

### Express and serverless routes disabled before legacy or Mission Engine handlers

The following routes return `503 ORIGIN_PROVIDER_PATH_DISABLED` before a later handler can transmit user content:

- all methods: `/api/v1/validate-mission`
- all methods: `/api/analyze`
- all methods: `/api/generate-image`
- all methods: `/api/swarm/run`
- POST: `/api/v1/missions`
- POST: `/api/v1/missions/:missionId/execute`
- POST: `/api/v1/executive/run`

The POST-only rules preserve unrelated read-only Mission Engine status routes.

Evidence:

- `src/legacy/originLegacyProviderBoundaryGuard.ts`
- `src/legacy/originLegacyProviderBoundaryGuard.test.ts`
- `server.ts`
- `api/index.ts`

### Cloudflare Worker provider route disabled

`POST /api/v1/ai/free-chat` returns a fixed `503` response and does not call `fetch`. The status endpoint explicitly reports `providerExecutionEnabled: false`.

Evidence:

- `worker/index.mjs`
- `worker/index.test.mjs`

### Mounted routes reviewed as local/read-only

The following mounted Mission Engine areas do not directly transmit user content in the reviewed route handlers:

- `/api/v1/health`
- GET Mission status
- GET Task status
- Agent registry CRUD
- Organization state, metrics, and SSE reads
- Organization simulation execution through `runExecutionLoop`

The provider-capable Mission planning, Mission execution, and Executive Brain POST routes are blocked by the global boundary described above.

## Closed findings from candidate `7bd1903`

### Previous F-01 — Other mounted provider routes bypass the ORIGIN boundary

**Runtime disposition: CLOSED by fail-closed route guards for the reviewed entrypoints.**

All mounted provider-capable routes found in the Express, serverless, Mission Engine, and Worker entrypoints are now either the authoritative `/api/chat` route or disabled before provider-capable code.

Residual risk:

- The inventory is source-based and must be repeated when new routes or entrypoints are added.
- Guard ordering remains security-sensitive.
- Disabled implementations remain in the repository.

### Previous F-02 — `/api/analyze` automatically grants human approval

**Live runtime effect: CLOSED while `/api/analyze` is disabled before its handler.**

**Source-level unsafe implementation: NOT REMOVED.**

The auto-approval callback remains in disabled code. It must not be treated as an accepted approval design and must be removed before any route is re-enabled.

### Previous F-03 — `/api/analyze` emits unsupported execution/evidence claims

**Live runtime effect: CLOSED while `/api/analyze` is disabled.**

**Source-level misleading implementation: NOT REMOVED.**

The unsupported primary-source, citation, audit, and zero-hallucination claims remain in unreachable code and must be deleted or rewritten before migration.

## Remaining findings

### F-01 — High — Minimum independent-review loop is not connected to live chat

The live `/api/chat` response reports:

- `verificationStatus: "not-run"`
- independent verification and synthesis are not executed

The repository contains reviewed-execution, review-policy, and synthesis modules, but the authoritative route does not invoke them.

Impact:

- Issue #44's primary-plus-independent-reviewer requirement is incomplete.
- No conclusion-first synthesized answer is produced from independent execution.
- Owner acceptance cannot start.

Required disposition:

- Connect a genuinely independent review call and synthesis under the same sensitive-input, zero-cost, no-fallback, provider-data, timeout, and routing-evidence controls; or
- keep the capability explicitly unavailable and keep owner acceptance blocked.

### F-02 — Medium — Disabled provider implementations retain unsafe latent behavior

Disabled code still contains:

- automatic human approval in analysis and Mission execution paths;
- simulated research, citation, verification, completion, consensus, and quality claims;
- provider/model selections outside the authoritative ORIGIN policy;
- fallback content that can represent unexecuted work as completed.

Impact:

- A future guard removal, route reordering, or partial migration could silently restore the original Critical and High failures.
- Maintainers can mistake unreachable code for approved behavior.

Required disposition:

- Remove automatic approval outside explicit test doubles.
- Replace simulated completion/evidence wording with truthful unavailable or pending states.
- Delete obsolete provider calls, or migrate them through one authoritative gate before re-enabling.
- Add an architectural test that fails when a provider-capable route is mounted without an explicit ORIGIN disposition.

### F-03 — Medium — Unified execution trace is response-local, not durable

The primary route returns a request/trace ID and execution metadata, but no server-side record was found that durably links:

- input disposition;
- context-minimization decision;
- execution plan;
- provider transmission decision;
- actual provider/model;
- routing evidence;
- cost;
- verification state;
- final outcome.

Impact:

- Post-incident reconstruction depends on a client retaining the response.
- Issue #44's unified-trace requirement is incomplete.

Required disposition:

- Record a sanitized trace through a server-side audit abstraction.
- Do not store full private prompts or secret source values.
- Define retention, capacity, and failure behavior explicitly.

### F-04 — Medium — Answer-safety evaluator remains internal-only and has adversarial gaps

Keeping the evaluator outside the live response path remains the correct disposition. Source review still identifies likely gaps involving:

- mixed negative and positive actions in one punctuation-delimited clause;
- Markdown code fences, inline code, and block quotes;
- contractions and paraphrases;
- multiple targets in one sentence.

Required disposition:

- Keep it internal-only.
- Expand adversarial tests.
- Re-audit before using it as a production gate or approval signal.

### F-05 — Medium — Strict OpenRouter routing-evidence verification can reject cache hits

The provider client fails closed when routing metadata is absent. Prior official-document review indicated that cache-hit behavior can omit router metadata. The current request does not establish a reviewed, tested no-cache guarantee.

Impact:

- A valid zero-cost response may be discarded.
- This is an availability risk, not a cost-policy bypass.

Required disposition:

- Establish a documented no-cache mode or equivalent immutable generation evidence.
- Continue failing closed when actual routing cannot be proven.

## Issue #44 status after this audit

### P0 / runtime alignment

- Primary chat authoritative boundary: **implemented for `/api/chat`**
- Provider shown equals provider executed: **implemented for accepted `/api/chat` responses**
- Sensitive-input control before enabled provider transmission: **implemented for `/api/chat`; all other reviewed provider paths disabled**
- Provider disclosure/data policy: **implemented for `/api/chat`; other provider paths disabled**
- Free-only and automatic-provider exclusion: **implemented for `/api/chat`; other provider paths disabled**
- Estimated cost and zero ceiling: **implemented for `/api/chat`; other provider paths disabled**
- Approval threshold enforcement: **live bypass routes disabled; latent auto-approval code remains**
- Retry/timeout/fallback cannot bypass policy: **implemented for `/api/chat`; disabled elsewhere**
- Unapproved OpenRouter-to-Gemini fallback: **not reachable through reviewed mounted provider routes**
- UI settings truthful/enforced: **substantially improved; rendered audit still pending**
- Planning-versus-execution wording: **primary chat improved; misleading disabled code remains**

### Minimum ORIGIN loop

- Single-provider request: **implemented in source for `/api/chat`; no live credential execution in this audit**
- Primary plus independent reviewer: **not connected**
- Reviewer value/skip policy: **modules exist; live integration incomplete**
- Synthesized conclusion: **module exists; live integration incomplete**
- Unified trace: **not durable**

### Integrated audit candidate

- Exact candidate SHA: **yes**
- Matching automated evidence: **yes**
- Exact-candidate source/security/privacy audit: **completed here; High finding remains**
- Adversarial cost-bypass audit: **source-level only**
- Manual NVDA/Firefox or VoiceOver/Safari: **not complete**
- Rendered Japanese UX/accessibility audit: **not complete**
- Live provider architecture verification: **not complete**
- Evaluator validity: **internal-only disposition retained**
- Owner hands-on acceptance: **blocked**

## Untested areas

- No real OpenRouter or Gemini credential was used.
- No external provider request was sent.
- No production or serverless deployment was exercised.
- No account-level privacy, logging, budget, cache, or provider settings were inspected.
- No provider-region or endpoint-eligibility response was observed.
- No manual screen-reader or rendered visual review was performed.
- No load, concurrency, abuse-rate, or denial-of-service test was performed.

## Required next sequence

1. Remove latent automatic approval from non-test code.
2. Remove or rewrite simulated execution and evidence claims in disabled code.
3. Add a maintained provider-route inventory/architectural test.
4. Implement a sanitized durable unified trace.
5. Connect the independent-review and synthesis path under the same free-only controls, or retain the explicit feature block.
6. Expand adversarial evaluator tests while keeping the evaluator internal-only.
7. Resolve or explicitly accept the router-metadata/cache availability risk.
8. Produce a new exact candidate SHA and rerun all automated workflows.
9. Perform a new exact-candidate independent audit.
10. Complete rendered Japanese UX/accessibility and real screen-reader review only after all Critical/High findings are closed.
11. Start owner hands-on acceptance only after the technical gate is cleared.

## Restrictions preserved

- No merge
- No deployment
- No DNS, Cloudflare, billing, account, credential, or repository-setting change
- No paid execution
- No real secret or private prompt content
- No claim that ORIGIN or Issue #44 is complete
