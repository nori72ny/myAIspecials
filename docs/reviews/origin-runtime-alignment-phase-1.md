# ORIGIN Runtime Alignment — Phases 1–2

Target: PR #45  
Tracking issue: #44  
Status: Draft, unmerged, undeployed

## Scope

These phases move the primary `/api/chat` request path behind an explicit server-side ORIGIN boundary and make the Personal Edition UI state the same safety and cost rules that the server actually enforces.

## Implemented runtime controls

- validates chat messages before execution;
- preserves weather clarification without provider calls;
- scans each transmitted conversation message with `SensitiveInputDetector`;
- stops before provider execution when sensitive categories are detected;
- records only detection categories in the error response;
- ignores generic credential-safety wording in assistant history while still blocking structured secret patterns there;
- selects only a specific OpenRouter model whose official model page showed an explicit `:free` identifier and `Price Free`;
- fails closed when the free-provider credential is absent;
- fails closed when the free-model evidence catalog is invalid or past its review date;
- uses a dedicated client with no automatic cross-provider fallback;
- returns provider/model metadata from the same execution plan used for the call;
- reports estimated and actual cost as zero for this explicit free-model phase;
- states that independent verification and synthesis are not yet run.

## Free-model evidence

Current catalog entry:

- model: `moonshotai/kimi-k2.6:free`;
- evidence source: <https://openrouter.ai/moonshotai/kimi-k2.6:free/pricing>;
- verified: `2026-07-19T00:00:00.000Z`;
- mandatory review after: `2026-08-18T23:59:59.999Z`.

The evidence establishes only that the official OpenRouter model page showed an explicit free variant at the verification time. It does **not** establish that this model is the highest-quality model for every task. ORIGIN must not make a superiority claim until a versioned comparative benchmark exists.

The previous hard-coded `google/gemini-2.5-flash:free` assumption was removed because the official Gemini 2.5 Flash page showed the base model as paid, while free-variant availability can change independently. The new catalog makes the evidence and review deadline explicit rather than silently assuming permanent availability.

## Personal Edition alignment

- chat identity and input wording use ORIGIN Personal;
- the client sends a hard zero-cost ceiling and the selected timeout to the server policy;
- secret-block, free-provider unavailable, policy, timeout, rate-limit, and provider failure states use distinct wording;
- secret-block errors do not offer retry or connection-setting actions;
- provider-configuration errors offer the settings action;
- result metadata says when execution was free and when independent verification was not run;
- provider selection toggles were removed from Personal settings;
- the misleading variable cost slider and automatic retry selector were removed;
- settings now state that provider selection is server-controlled, the hard ceiling is `$0.00`, and automatic provider switching is disabled;
- provider credentials are described as server-managed and must not be entered in chat or settings.

## Tests added or updated

- strict free-only policy selection and fail-closed behavior;
- official-source and evidence-date catalog validation;
- stale catalog evidence rejection;
- invalid policy rejection;
- exact evidence-backed `:free` model execution;
- no network call for unconfigured, stale, or policy-violating plans;
- normalized provider errors without provider response-body disclosure;
- secret-bearing chat blocked before executor invocation;
- assistant-history false-positive and structured-secret regression cases;
- truthful executed-provider and evidence metadata;
- weather handling without provider execution;
- truthful Personal Edition error actions and execution metadata;
- ORIGIN identity and policy settings in unit and Playwright journeys.

## Remaining blockers

- show a dedicated Personal Edition title for stale or invalid free-model evidence;
- remove the shadowed legacy `/api/chat` handler after regression confirmation;
- minimize provider-bound conversation context while preserving task correctness;
- add provider data-use, retention, and region eligibility metadata;
- add independent reviewer execution and synthesis;
- create one final candidate SHA and audit it independently;
- complete real screen-reader validation.

No merge, deployment, DNS, billing, credentials, or paid services are authorized by these phases.
