# ORIGIN Goal-Alignment Audit

Status: Active audit gate  
Audit type: Product-goal, architecture, safety, runtime, UX, quality, and review-evidence audit  
Owner: ノリさん  
Audit lead for this pass: ChatGPT  
Repository: `nori72ny/myAIspecials`

## 1. Audit Decision

**Verdict: BLOCK owner acceptance of ORIGIN as the intended provider-neutral, outcome-first multi-AI product.**

This is not a verdict that the repository is unusable or that prior work failed. The repository contains a substantial application shell, a deterministic delegation planner, a safety-hardened V2 preview, local audit history, responsive evidence, CI, and a deterministic answer-quality regression foundation.

The block exists because the primary user-facing chat execution path does not yet implement the same product rules that the planner and documentation promise. In particular, the real chat path remains provider-specific, bypasses the deterministic planner, can transmit the conversation without the planner's sensitive-input gate, does not enforce the visible cost cap, and does not execute independent generation, verification, or synthesis.

The owner should review the product only after the blocking runtime inconsistencies and the integrated audit gate below are resolved.

## 2. Fixed Audit Targets

### Product target

The governing target is `docs/PRODUCT_CONSTITUTION.md` on `docs/product-constitution-v1`.

The required product outcome is:

- the user describes an objective rather than selecting a provider;
- ORIGIN identifies the required capabilities;
- ORIGIN selects the best sufficient AI, tool, agent, or combination using current evidence;
- free or low-cost execution is preferred when quality remains sufficient;
- paid execution requires a prior estimate and explicit approval;
- sensitive or consequential work is gated;
- additional AI systems are used only when they add measurable value;
- important results can be independently reviewed or verified;
- ORIGIN synthesizes one understandable, actionable result;
- technical complexity is progressively disclosed rather than imposed on the user;
- the final outcome, not provider popularity, is the unit of value.

### Repository targets

| Target | Exact revision | Role in audit |
|---|---|---|
| `main` | `aea2f41a775bab17b7d72e5d68d7bbaaf6716dd6` | Current merged product |
| PR #38 | `1ffb93cebba90d63674b27a8d38b2467634ad746` | Privacy and browser-resilience foundation |
| PR #40 | `50d20678bd7cb237dc781cf0c07ca46e7f315ba4` | Localized V2 delegation preview; contains PR #38 ancestry |
| PR #41 | `4995fa19f0ddf3e13479660b4d3327d2a8b0fab8` | Deterministic answer-quality preview; contains PR #40 ancestry |
| PR #42 | current `docs/product-constitution-v1` head | Documentation and audit package only |

The branch ancestry was checked:

- PR #38 is 24 commits ahead of `main` and 0 behind.
- PR #40 is 42 commits ahead of PR #38 and 0 behind.
- PR #41 is 19 commits ahead of PR #40 and 0 behind.

Therefore PR #40 already contains PR #38, and PR #41 already contains PR #40. They must not be treated as three independent patches that can be merged in arbitrary order.

## 3. Audit Method and Independence Limits

This audit used:

- source inspection of the current merged chat, routing, settings, provider registry, and delegation components;
- source inspection of PR #38, PR #40, and PR #41 at their fixed heads;
- PR ancestry and changed-file comparison;
- GitHub Actions results and recorded Playwright evidence;
- prior external-AI review records and remediation notes;
- the product constitution as the acceptance standard.

Important independence rule:

- this ChatGPT audit is a repository-evidence audit;
- it is not a substitute for a genuinely independent Claude, Gemini, Grok, Manus, Groq, specialist, or human review;
- an external review counts only when the reviewer, model/version if known, exact SHA, access mode, request, response, verdict, and untested areas are recorded;
- a reviewer that could not access the repository or rendered product cannot approve it;
- prior reviews of separate PRs do not approve a new integrated candidate SHA.

## 4. Goal-by-Goal Assessment

Status meanings:

- **ACHIEVED**: implemented and supported by matching evidence for the stated scope;
- **PARTIAL**: meaningful implementation exists, but the complete product requirement is not met;
- **MISSING**: no sufficient working implementation was found;
- **BLOCKED**: implementation exists but conflicts with a fixed product rule or creates a release-blocking risk;
- **UNVERIFIED**: implementation may exist, but evidence is insufficient or stale.

| Goal | Status | Evidence and assessment |
|---|---|---|
| Personal-use application shell | **ACHIEVED** | Personal Edition includes dashboard, unified chat, workspace, memory, new-chat flow, settings, theme handling, and responsive navigation. |
| User need not select a provider | **PARTIAL** | The delegation planner selects a role/provider deterministically, but Settings still exposes provider selection and the real chat backend selects between OpenRouter and Gemini from environment keys rather than the planner decision. |
| Provider-neutral routing | **BLOCKED** | `MultiAIOrchestrator` provides a provider-neutral-looking planner contract, but the actual `/api/chat` path hardcodes Gemini-family execution and does not consume the planner decision or capability registry. |
| Capability-based selection | **PARTIAL** | Static task classification, capability lists, reliability, latency, quota, fallback, and verifier ranking exist. They are not connected to the primary chat execution path and are not based on current measured provider evidence. |
| Free-only default | **PARTIAL / BLOCKED** | The delegation planner excludes paid and automatic providers. The live chat path does not enforce the planner's free-only rule. A separate `RoutingService` also treats `openrouter/auto` as free, which conflicts with the fixed prohibition on automatic paid-risk routing. |
| Estimated cost before paid execution | **MISSING** | The live chat estimates cost after the response. No pre-execution estimate, reservation, approval threshold, or hard stop was found in `/api/chat`. |
| Budget enforcement | **MISSING** | `maxCostCap`, retry count, timeout, and auto-route settings exist in UI state, but repository search found no runtime enforcement in the live chat/provider path. |
| No automatic paid fallback | **BLOCKED** | `callLLM` automatically falls back from OpenRouter to Gemini when both credentials are present. It does not perform a cost-policy or owner-approval check before the fallback. |
| Sensitive-input protection before provider transmission | **BLOCKED** | PR #38/#40 protect the delegation planner and local audit data. `UnifiedChat` sends its message history to `/api/chat`, and the backend sends it to a provider without using `SensitiveInputDetector` or obtaining a provider-disclosure approval. |
| Advisory versus consequential execution distinction | **PARTIAL** | The planner has dangerous-operation detection and human-approval messaging. The live chat execution path does not use the same approval object or enforcement boundary. |
| Independent reviewer selection | **PARTIAL** | The planner selects a separate verification provider and records a verification plan. It does not invoke the reviewer or verify the returned answer automatically. |
| Multi-AI execution | **MISSING** | The current planner prepares instructions for another AI. The live chat performs one provider call. No production path was found that independently executes multiple candidates for a user request. |
| Evidence-aware synthesis | **MISSING** | No live claim extraction, conflict resolution, citation verification, or synthesis engine is connected to Unified Chat. |
| Outcome-first evaluation | **PARTIAL** | PR #41 adds deterministic synthetic scoring. It is a keyword, section, length, Japanese-character-ratio, and dangerous-affirmation regression checker; it is not a calibrated evaluation of real completed outcomes. |
| Real comparative benchmarking | **MISSING** | No current dated benchmark evidence was found that compares real provider outputs by domain, quality, completion, safety, latency, and actual cost. Static provider ratings must not be presented as measured superiority. |
| Provider adapter execution boundary | **PARTIAL** | `IProviderAdapter` exists, but it only returns self-declared provider records. It does not define execution, streaming, usage, cancellation, idempotency, normalized errors, or data-policy handling. The live client bypasses it. |
| Provider evolution and removal | **PARTIAL / CONCEPTUAL** | Registry registration and removal exist, and extensive lifecycle specifications exist. A controlled, evidence-driven live lifecycle is not implemented. |
| Progressive-disclosure result UX | **PARTIAL** | V2 improves Japanese labels, selection reasons, verification explanations, responsiveness, and provider-ID hiding. The structured machine instruction remains prominent, the mobile flow remains long, and the main chat result is not integrated with the V2 decision summary. |
| Japanese-first coherent product | **PARTIAL** | V2 is substantially localized. The surrounding Personal Edition still contains ACOS, English project labels, enterprise switching, provider terminology, and experimental navigation. |
| Browser-local audit history | **ACHIEVED for planner scope** | PR #38/#40 implement typed storage failures, truthful persistence messages, redaction, result/verification states, elapsed time, and local deletion. This does not audit actual provider calls or final answer evidence. |
| Automated responsive and accessibility checks | **ACHIEVED for V2 tested scope** | PR #40 has responsive, reflow, reduced-motion, focus-trap, keyboard, axe, and visual evidence across the recorded viewport matrix. |
| Manual assistive-technology verification | **MISSING** | NVDA + Firefox or VoiceOver + Safari remains uncompleted. Automated Playwright and axe cannot replace it. |
| Reproducible exact integrated release | **MISSING** | There is no single owner-candidate SHA containing only the accepted main, safety, V2, runtime alignment, and quality changes with matching integrated audit evidence. |
| World-class comparative claim | **UNVERIFIED** | The architecture aims at world-class quality, but there is no controlled baseline comparison, current sample set, calibrated human judgment, or uncertainty report sufficient for a superiority claim. |

## 5. Confirmed Strengths

### 5.1 Substantial usable product foundation

The repository is not an empty prototype. It contains:

- a working Personal Edition shell;
- chat, dashboard, workspace, memory, history, and settings concepts;
- mobile-responsive navigation;
- light and dark presentation support;
- error-state handling in the chat;
- a globally reachable delegation planner.

### 5.2 Deterministic planning and fallback foundation

The merged planner has:

- deterministic task classification;
- capability eligibility;
- free-only filtering;
- quota-exhaustion exclusion;
- reliability and latency ordering;
- stable fallback ranking;
- separate verifier selection;
- understandable reason generation;
- human-approval flags for dangerous or sensitive requests.

This is valuable architecture, but it currently governs the manual planner rather than real answer execution.

### 5.3 Privacy and browser resilience in PR #38

PR #38 contains a strong planner-specific hardening increment:

- representative sensitive-input detection;
- strict `[REDACTED]` handling for instructions and local audit records;
- typed localStorage read/write/quota/remove/unavailable failures;
- no false claim that a record was saved;
- single accessible clipboard-failure alert;
- polite success announcements;
- focus trapping, Escape closure, and focus restoration;
- false-positive regression coverage;
- mobile, dark-mode, keyboard, and accessibility evidence.

All four recorded workflows passed at the final PR #38 head.

### 5.4 Provider-neutral Japanese V2 in PR #40

PR #40 materially improves the planner experience:

- internal provider IDs are hidden from normal summaries;
- roles and task types are shown in Japanese;
- selection reasons are request-category-specific;
- independent verification is explained;
- stored legacy internal English reasons are normalized;
- standalone provider-key formats receive additional redaction coverage;
- responsive behavior is tested across ten CSS viewport configurations;
- reduced-motion and focus-cycle tests exist;
- axe WCAG A/AA Critical and Serious checks cover the expanded matrix.

The final PR #40 technical evidence reports no unresolved accepted Critical, High, Medium, or Low finding from its completed external audits. Manual screen-reader use remains open.

### 5.5 Deterministic quality-regression foundation in PR #41

PR #41 establishes useful low-cost mechanics:

- versioned synthetic fixtures;
- provider-neutral evaluation data structures;
- deterministic failure reasons;
- safety/privacy dangerous-affirmation checks;
- Japanese-quality and structured-output checks;
- sanitized suite reporting;
- preview-only UI and E2E coverage.

This is useful as a regression guard. It must not be described as proof of answer correctness, best-provider selection, or world-class outcome quality.

## 6. Blocking Findings

### GA-01 — Primary chat bypasses the ORIGIN planner

Severity: **Critical**  
Status: **Open**

Evidence:

- `src/components/personal/UnifiedChat.tsx` sends the conversation to `/api/chat`.
- `src/legacy/legacyRoutes.ts` selects OpenRouter or Gemini from environment-key presence.
- the model is hardcoded to Gemini 2.5 Flash through OpenRouter or direct Gemini;
- `MultiAIOrchestrator`, its verification plan, and PR #41's evaluator are not used by this path.

Impact:

The user-visible product can claim or imply intelligent provider-neutral routing while the actual answer path uses a separate provider-specific implementation. This is a product-truthfulness and architecture-boundary failure.

Required resolution:

- introduce one server-side orchestration boundary for every live request;
- classify the task and constraints there;
- resolve provider eligibility and execution plan there;
- execute only the selected approved plan;
- return a normalized result and audit record generated from that same decision;
- eliminate separate contradictory routing implementations from the primary flow.

Required verification:

- mock-provider E2E proves the selected plan controls the actual call;
- a provider marked unavailable, paid-only, quota-exhausted, or disallowed is never called;
- routing metadata shown to the user matches the executed provider adapter.

### GA-02 — Sensitive chat content can cross the provider boundary without the planner safeguard

Severity: **Critical**  
Status: **Open**

Evidence:

- PR #38/#40 use `SensitiveInputDetector` in the planner;
- `UnifiedChat` sends the complete non-error message list to `/api/chat`;
- `/api/chat` forwards messages through `callLLM`;
- no equivalent sensitive-input classification, minimization, redaction, blocking decision, provider data-policy check, or disclosure approval is present in this path.

Impact:

A user may believe the product's secret warning protects ORIGIN generally, when it currently protects only the delegation planner. This creates a potentially serious confidentiality and expectation mismatch.

Required resolution:

- move sensitive-input classification to a shared server-side pre-provider gate;
- treat client detection as supplementary UX, never the sole control;
- default to blocking or requiring a sanitized replacement for likely credentials;
- record only categories and decision metadata, not matched secret values;
- require explicit disclosure approval when sensitive context must be sent to an eligible provider;
- define provider retention, region, and data-use eligibility before sending.

Required verification:

- synthetic AWS, GitHub, Google, Slack, Stripe, Authorization, PEM, OAuth/JWT, and assignment examples never reach the mock provider payload;
- false-positive and Unicode/whitespace bypass cases are tested;
- logs, errors, screenshots, audit records, and clipboard output exclude the source secret.

### GA-03 — Free-only and cost approval are not enforced in live execution

Severity: **Critical**  
Status: **Open**

Evidence:

- the planner has free-only eligibility;
- the live chat chooses its provider from configured keys;
- cost is estimated only after the response;
- `maxCostCap` exists in settings UI/state but is not consumed by the live provider path;
- the provider client can fall back automatically;
- the separate `RoutingService` treats `openrouter/auto` as free, contradicting the planner's explicit exclusion.

Impact:

The fixed cost constitution is not guaranteed by the primary execution path. A visible setting can create an assurance that the backend does not enforce.

Required resolution:

- define one authoritative execution policy object containing free-only, hard budget, approval threshold, provider allow-list, and automatic-fallback prohibition;
- estimate cost before any possibly paid execution;
- stop and request approval when a threshold would be exceeded;
- reconcile actual usage after execution;
- remove `openrouter/auto` from free eligibility;
- disable cross-provider fallback unless the fallback independently passes all cost, data, capability, and approval checks.

Required verification:

- paid and automatic candidates are excluded in free-only mode;
- cost-cap settings change actual execution eligibility;
- no request is sent when approval is required and absent;
- retries and fallback cannot bypass the hard cap.

### GA-04 — Planning, execution, verification, and synthesis are disconnected

Severity: **High**  
Status: **Open**

Evidence:

- the planner creates a selected provider, verifier, and copyable instruction;
- the user must manually move that instruction elsewhere;
- Unified Chat makes one provider call;
- result and verification status are manually entered into local history;
- no automated independent reviewer or synthesis stage is connected.

Impact:

The defining ORIGIN outcome—automatic selection and useful multi-AI coordination—is not yet delivered. The existing implementation is best described as a safe delegation planning assistant plus a separate single-provider chat.

Required resolution:

Implement first with deterministic mock adapters:

1. analyze request;
2. select single or reviewed mode based on measurable value/risk;
3. execute primary;
4. execute an independent reviewer only when required;
5. evaluate conflicts and critical failures;
6. synthesize one result;
7. show conclusion first, with execution details expandable;
8. record plan, execution, verification, cost, and outcome from one trace.

### GA-05 — No exact integrated candidate has been audited

Severity: **High**  
Status: **Open**

PR #38 and PR #40 have substantial isolated review evidence. PR #41 has internal CI and visual verification. However:

- no exact candidate SHA combines the chosen runtime alignment, PR #38, PR #40, and any accepted PR #41 portion;
- no independent reviewer has reviewed that combined SHA end to end;
- no owner preview should be presented as release-candidate evidence until the exact integrated SHA exists.

Required resolution:

- create a minimal integration branch only after the P0 runtime plan is approved;
- include only accepted changes;
- run full CI and matching rendered evidence;
- perform source, runtime, privacy, cost, UX, accessibility, and evaluation audits on that exact SHA;
- do not reuse evidence from a different SHA without proving that the relevant code is identical.

## 7. Major Non-Blocking-to-Architecture but Blocking-to-Quality Findings

### GA-06 — Settings do not accurately represent runtime behavior

The settings UI states or implies:

- Gemini and OpenAI operate together;
- selected agents control execution;
- a maximum cost cap is enforced;
- configured retry and timeout values govern providers;
- auto routing is configurable.

The live chat path instead selects OpenRouter when its key exists, otherwise Gemini, and repository search found these settings primarily in types, state, and UI rather than execution enforcement.

Required resolution:

- hide or label non-functional controls as preview-only;
- preferably wire every visible execution setting to a tested backend policy;
- add contract tests proving UI setting, server policy, and executed behavior agree.

### GA-07 — Static provider evidence is not sufficient for routing claims

The capability registry contains hardcoded names, capability ratings, quality, latency, cost, and failure-rate values. These can support deterministic mocks, but they are not current benchmark evidence.

Required resolution:

- label all synthetic/self-declared records as such;
- version the catalog and evidence source;
- do not use provider marketing or static constants as proof of superiority;
- add dated synthetic benchmark fixtures first, then controlled live evidence under explicit budget and approval.

### GA-08 — Provider adapter contract is discovery-only

`IProviderAdapter` currently defines identity and provider discovery. It does not establish the execution boundary required by the constitution.

Minimum contract needed before live multi-provider operation:

- normalized request and context policy;
- text, structured, streaming, multimodal, and tool result forms as applicable;
- usage and actual cost;
- timeout and cancellation;
- idempotency;
- normalized errors and retry safety;
- provider/model/revision identity;
- retention, region, and data-use metadata;
- health and quota;
- redacted audit metadata;
- mock conformance tests.

### GA-09 — PR #41 scoring is useful but not calibrated outcome evaluation

The evaluator gives axes binary scores based on missing terms, forbidden terms, required headings, maximum characters, Japanese-character ratio, and dangerous-affirmation regexes.

Risks:

- correct paraphrases can fail because a literal term is absent;
- incorrect answers can pass by including required terms;
- Japanese-character ratio is not a complete language-quality measure;
- all axis failures score zero, giving no calibrated partial credit;
- no human-agreement study or real provider comparison has been recorded;
- PR #41 has no completed independent external audit in the reviewed record.

Required resolution:

- keep the deterministic checker as a safety/regression layer;
- add exact deterministic validators where possible;
- add reference, pairwise, execution, source-quality, and human evaluation where appropriate;
- calibrate thresholds against human judgments;
- record evaluator version, sample size, variance, uncertainty, and failure classes;
- independently audit the evaluator for gaming and false confidence.

### GA-10 — Product naming and navigation remain incoherent

The goal is ORIGIN, while the implementation continues to expose ACOS Personal, enterprise switching, marketplace, organization cockpit, performance observatory, UAF, and experimental concepts. V2 is more coherent than the surrounding application.

Required resolution for personal v0.1:

- present one clear product identity;
- make Unified Chat the primary entry;
- hide enterprise and experimental modules from normal personal navigation;
- integrate delegation automatically or as an understandable step within chat;
- keep technical provider/audit detail behind progressive disclosure.

### GA-11 — Planner information hierarchy is still too technical

V2 is materially better, but it still displays a structured machine instruction in the primary vertical flow and uses a separate floating launcher.

Recommended direction:

- default to `おすすめの進め方` rather than a provider-oriented label;
- show conclusion, reason, verification plan, and next action first;
- collapse the structured instruction under `詳細な指示を見る` or expose it only when copying;
- explicitly state whether ORIGIN will execute or only prepare instructions;
- delay audit-history controls until a result exists;
- validate whether the separate launcher should be replaced by automatic routing inside Unified Chat.

### GA-12 — Manual assistive-technology testing is open

Automated keyboard, axe, focus, viewport, zoom-equivalent, and reduced-motion evidence is strong. A real screen-reader journey remains required before claiming accessibility completion.

Minimum manual journey:

- VoiceOver + Safari or NVDA + Firefox;
- open/close dialog and focus return;
- read input label and secret warning;
- execute a plan;
- understand recommendation, task type, verification, approval requirement;
- access structured instruction and copy feedback;
- read storage warning;
- edit result and verification state;
- navigate mobile or narrow layout where practical.

## 8. External-AI Review Ledger

### PR #38

| Reviewer | Recorded result | Audit interpretation |
|---|---|---|
| Claude | PASS WITH CHANGES | Findings were reproduced and accepted fixes were recorded. |
| Grok | PASS WITH CHANGES | Overlapping clipboard, resilience, and accessibility findings were addressed. |
| Gemini | BLOCK, but repository/rendered access unavailable | Not counted as code or product approval; retained as lower-confidence hypotheses only. |
| Manus | Not completed because credits were unavailable | Not counted. |
| ChatGPT/internal | Completed with CI, branch-integrity, and remediation checks | Useful implementation evidence, not independent final approval. |

PR #38's scoped safety work is technically strong, but the final product still needs integrated review.

### PR #40

| Reviewer | Recorded result | Audit interpretation |
|---|---|---|
| Claude | Source-level audit; 1 High and 3 Low accepted findings | Accepted findings were fixed and verified at final PR #40 head. |
| Groq | Minor fixes then pass | Findings were addressed or documented. |
| Gemini | Indeterminate because repository/preview access was unavailable | Not counted as approval. |
| Manus | Not run because credits were unavailable | Not counted. |
| ChatGPT/internal | Functional, visual, responsive, localization, and remediation audit | Completed for the recorded V2 SHA. |

Remaining PR #40 item: manual real-screen-reader verification.

### PR #41

| Reviewer | Recorded result | Audit interpretation |
|---|---|---|
| Internal CI and visual verification | Pass for recorded intermediate/final branch evidence | Supports implementation stability only. |
| Independent evaluator/security/product reviewer | Not found in recorded evidence | Required before accepting the evaluator as a release quality gate. |

### Integrated personal-use candidate

No completed external review exists because the exact integrated candidate does not yet exist.

## 9. Required Independent Audit Program Before Owner Review

The external review program must examine the exact integrated candidate SHA, not merely the separate historical PRs.

### Reviewer A — Security and privacy

Suggested reviewer class: Claude or equivalent independent code/security reviewer.

Must inspect:

- all paths from user input to provider payload;
- sensitive detection, blocking, redaction, logs, errors, traces, storage, copied content, and artifacts;
- provider disclosure and data-policy approval;
- browser storage and cross-tab behavior;
- consequential-action enforcement;
- exact synthetic reproduction cases.

### Reviewer B — Adversarial failure and cost control

Suggested reviewer class: Grok or equivalent adversarial reviewer.

Must attack:

- Unicode, whitespace, line-break, encoding, and obfuscation bypasses;
- false positives;
- provider timeout, 429, malformed output, unavailable model, empty output, partial stream, and cancellation;
- retries and fallback attempting to bypass free-only or hard budgets;
- stale catalog and incorrect provider-health states;
- mismatch between displayed and executed provider.

### Reviewer C — UX, Japanese, and accessibility

Suggested reviewer class: Gemini, Manus, or equivalent reviewer with actual rendered access.

Must use:

- desktop and narrow mobile;
- light and dark modes;
- 200% zoom/reflow;
- keyboard-only operation;
- actual screen-reader journey;
- long Japanese content;
- empty, success, refusal, partial, sensitive, approval, storage failure, provider failure, conflict, and cost-approval states.

### Reviewer D — Provider architecture and future adaptability

Suggested reviewer class: Groq architecture reviewer, Claude, or an equivalent provider-integration specialist.

Must inspect:

- one authoritative router and execution adapter boundary;
- provider/model/revision identity;
- discovery versus trusted capability evidence;
- normalized usage, errors, cancellation, idempotency, and audit;
- provider removal and fallback;
- absence of SDK/provider types in orchestration core;
- conformance tests for mock and future adapters.

### Reviewer E — Answer quality and evaluator validity

Must be independent from the evaluator implementation.

Must inspect:

- fixture representativeness;
- false passes and false failures;
- prompt/answer leakage into reports;
- gaming resistance;
- critical-failure gates;
- human calibration;
- pairwise and task-specific evaluation;
- uncertainty and small-sample limitations;
- whether visible scores would mislead a non-expert.

### Acceptance of external findings

- every finding must be reproduced or validated against code, tests, rendered evidence, or observed behavior;
- conflicting reviews must be explicitly resolved;
- a prepared prompt is not a completed review;
- no reviewer authorizes merge or deployment;
- unresolved Critical or High findings block owner review;
- unresolved Medium findings require an explicit disposition and residual-risk statement;
- inaccessible reviewers are recorded as indeterminate, not pass or block evidence.

## 10. Minimum Work Before Asking ノリさん to Review

### P0 — Product truth and safety

- [ ] One authoritative server-side orchestration boundary controls live chat execution.
- [ ] The executed provider exactly matches the displayed routing decision.
- [ ] Sensitive-input protection runs before every provider transmission.
- [ ] Free-only, automatic-provider exclusion, budget, and approval rules are enforced server-side.
- [ ] The cost cap, timeout, retry, and provider settings shown in UI are either enforced or removed from the personal preview.
- [ ] Automatic unapproved OpenRouter-to-Gemini fallback is removed or policy-gated.
- [ ] Planning versus execution wording is accurate everywhere.

### P1 — Minimal ORIGIN execution loop

- [ ] Mock-provider execution is connected to the plan.
- [ ] Single mode works end to end.
- [ ] Primary-plus-independent-reviewer mode works end to end.
- [ ] Review is skipped when it adds no expected value.
- [ ] Conflict and critical-failure states are represented.
- [ ] One conclusion-first synthesized result is produced.
- [ ] Plan, execution, verification, cost, and outcome share one trace ID.

### P1 — Personal product coherence

- [ ] Adopt a consistent ORIGIN personal identity.
- [ ] Hide enterprise, marketplace, organization, and experimental navigation from the normal personal flow.
- [ ] Integrate or clearly place the delegation decision within Unified Chat.
- [ ] Collapse machine-oriented instructions by default.
- [ ] Keep technical provider identity in optional details only.
- [ ] Complete Japanese wording and mixed-language cleanup.

### P1 — Integrated quality evidence

- [ ] Create one exact personal-use candidate SHA.
- [ ] Run full lint, build, unit, integration, E2E, security, accessibility, and visual evidence on that SHA.
- [ ] Add mock-provider contract tests for free-only, cost, approval, timeout, malformed output, refusal, provider removal, and fallback.
- [ ] Independently audit PR #41's evaluator or keep it internal-only.
- [ ] Complete real screen-reader verification.
- [ ] Complete the independent multi-AI review program above.
- [ ] Reproduce, triage, fix, or explicitly accept every material finding.

### P2 — After owner acceptance of personal v0.1

- current provider benchmark catalog;
- evidence expiry and refresh;
- broader live provider integrations;
- controlled multi-AI parallel candidates;
- production outcome learning;
- advanced artifacts and connectors;
- enterprise, marketplace, billing, tenant, and lifecycle expansion.

P2 must not delay or distract from the P0/P1 personal-use candidate.

## 11. Proposed Technical Consolidation Direction

This is an audit recommendation, not implementation authorization.

### One request flow

```text
Unified Chat
  -> Request safety and data-classification gate
  -> Task and capability analysis
  -> Cost/data/action approval policy
  -> Candidate eligibility
  -> Execution-plan selection
  -> Provider adapter execution
  -> Optional independent review
  -> Evaluation and synthesis
  -> Conclusion-first result
  -> Trace, cost, verification, and audit record
```

### Reuse rather than duplicate

Reuse:

- PR #38/#40 sensitive-input detector and truthful browser-storage behavior;
- deterministic free/quota/reliability/latency routing concepts;
- V2 provider-neutral presentation functions;
- PR #41 fixture and sanitized-failure mechanics as a low-level regression layer;
- existing Personal Edition shell.

Consolidate or replace:

- provider selection in `/api/chat`;
- direct provider calls that bypass the planner;
- duplicate capability registries and contradictory free-only rules;
- UI-only execution settings;
- hardcoded model selection and misleading provider labels;
- separate floating planning flow if integration into chat proves clearer.

## 12. Current Gate State

- Product-goal audit by ChatGPT: **Completed for the stated SHAs**
- Existing external review evidence: **Consolidated**
- PR #38 scoped audit: **Technically complete; integrated reuse pending**
- PR #40 scoped audit: **Technically complete except manual screen reader; integrated reuse pending**
- PR #41 independent audit: **Missing**
- Primary chat safety/cost/orchestration alignment: **Blocked**
- Exact integrated candidate: **Missing**
- Independent audit of exact integrated candidate: **Missing**
- Owner hands-on review: **Paused until audit gate is satisfied**
- Merge: **Not authorized**
- Deployment: **Not authorized**
- Paid service activation: **Not authorized**

## 13. Final Audit Conclusion

ORIGIN has progressed well beyond an idea: its Personal Edition, deterministic planner, local audit history, safety hardening, localized V2, responsive evidence, and regression-evaluation foundation are real and valuable.

However, the strongest parts currently sit beside the primary answer path rather than governing it. The next correct step is not more broad specification and not an immediate owner demo. It is to make the live request path obey the same provider-neutral, free-only, privacy, approval, verification, and outcome-first rules already expressed in the planner and constitution.

ノリさん should be asked to review only after:

1. the primary runtime blockers are fixed;
2. one minimal integrated candidate SHA exists;
3. all matching automated evidence passes;
4. independent reviewers inspect that exact candidate with real access;
5. findings are reproduced and resolved;
6. the remaining known risks are stated plainly.

Until then, the accurate product status is:

> **Strong personal-product and orchestration foundations; not yet a complete, audited ORIGIN execution system.**
