# ORIGIN Runtime Alignment — Phase 1

Target: PR #45  
Tracking issue: #44  
Status: Draft, unmerged, undeployed

## Scope

This phase moves the primary `/api/chat` request path behind an explicit server-side ORIGIN boundary.

Implemented controls:

- validates chat messages before execution;
- preserves weather clarification without provider calls;
- scans the complete transmitted conversation with `SensitiveInputDetector`;
- stops before provider execution when sensitive categories are detected;
- records only detection categories in the error response;
- selects only the explicit OpenRouter `google/gemini-2.5-flash:free` model;
- fails closed when an explicitly free provider is not configured;
- uses a dedicated client with no automatic cross-provider fallback;
- returns provider/model metadata from the same execution plan used for the call;
- reports estimated and actual cost as zero for this explicit free-model phase;
- states that independent verification and synthesis are not yet run.

## Tests added

- strict free-only policy selection and fail-closed behavior;
- invalid policy rejection;
- exact `:free` model execution;
- no network call for unconfigured or policy-violating plans;
- normalized provider errors without provider response-body disclosure;
- secret-bearing chat blocked before executor invocation;
- truthful executed-provider metadata;
- weather handling without provider execution.

## Remaining blockers

- update the Personal Edition chat UI for the new safety and free-provider errors;
- remove the shadowed legacy `/api/chat` handler after regression confirmation;
- connect owner cost/timeout settings to the authoritative server policy or remove them from preview;
- add independent reviewer execution and synthesis;
- create one final candidate SHA and audit it independently;
- complete real screen-reader validation.

No merge, deployment, DNS, billing, credentials, or paid services are authorized by this phase.
