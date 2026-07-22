# ORIGIN external-AI audit record — runtime candidate `39b8670`

## Exact audit target

- Repository: `nori72ny/myAIspecials`
- Pull request: `#45`
- Base branch: `main`
- Candidate branch: `audit/origin-runtime-alignment-v0-1`
- Runtime candidate SHA: `39b867036e9c0f11ac04bc08a21644cd3f705d5f`
- Required CI at this exact SHA:
  - Production Release CI/CD: success
  - ACOS 2.0 Quality Gate: success
  - CodeQL Security Analysis: success
  - OpenSSF Scorecard: success

This document is a documentation-only record committed after the runtime candidate. It does not change the audited runtime. Review conclusions apply to the exact SHA above, not to the later documentation commit or a moving branch tip.

## Non-negotiable restrictions

- No merge or deployment without explicit owner approval.
- No DNS, cloud, account, billing, credential, repository-setting, or branch-protection changes.
- No paid execution or paid fallback.
- API keys remain server-side.
- No sensitive or private input may be supplied to external reviewers.
- Documentation, UI text, test names, and workflow success are not substitutes for runtime evidence.
- Do not claim ORIGIN is complete, perfect, best, or superior without reproducible evidence.

## External review results

### Claude — architecture and safety boundaries

- Target: exact runtime SHA `39b867036e9c0f11ac04bc08a21644cd3f705d5f`
- Reported verdict: `PASS`
- Reported confidence: `high`
- Confirmed remediated:
  - direct Gemini GitHub routes are fail-closed before legacy handlers;
  - organization execution is fail-closed before Mission Engine handlers;
  - split structured secrets across turns are detected;
  - NFKC and invisible-character canonicalization is applied before detection;
  - duplicate direct provider handlers were removed from `server.ts`;
  - boundary routers remain mounted before downstream legacy/provider routes.
- Remaining non-blocking item:
  - the non-AI GitHub OAuth exchange still returns a raw `err.message`; track separately as security cleanup.
- Explicitly unverified:
  - deployed runtime behavior and live third-party execution.

Internal treatment: accepted as the strongest external evidence for the technical and safety boundary. Its `PASS` is scoped and does not authorize release.

### Grok through Groq — adversarial fail-open review

- Target: exact runtime SHA `39b867036e9c0f11ac04bc08a21644cd3f705d5f`
- Reported model identity: xAI Grok, July 2026 build, accessed through Groq
- Reported verdict: `CONDITIONAL PASS`
- Reported confidence: `medium`
- Reported no unresolved P0/P1 findings.
- Confirmed or supported remediation for legacy route bypass, Worker provider execution, split/Unicode-obfuscated secrets, free-only enforcement, stale evidence, malformed input, and zero-cost validation.

Qualifications:

- claims about frontend debounce, stale-state elimination, and exhaustive negative-test execution were not accompanied by sufficiently specific code paths or logs;
- the underlying exact hosted model and execution environment remain dependent on the provider statement;
- this review is corroborating evidence, not independent runtime execution proof.

Internal treatment: accepted with qualifications.

### Gemini in Google AI Studio — UI, accessibility-code, and product-truth review

- Target: exact runtime SHA `39b867036e9c0f11ac04bc08a21644cd3f705d5f`
- Exact-SHA file access was validated by reading SHA-pinned versions of:
  - `src/components/personal/UnifiedChat.tsx`
  - `tests/e2e/origin-personal-navigation.spec.ts`
- Reported no P0/P1 findings and high confidence.
- Supported:
  - Japanese-first copy and one-outcome input;
  - sensitive-input warning behavior;
  - zero-cost and no-independent-verification disclosure;
  - progressive disclosure of error and execution details;
  - fake-content and Enterprise-upsell removal;
  - responsive navigation and automated accessibility coverage.

Qualifications and corrected interpretation:

- `production-ready`, `matches all specifications`, and equivalent global claims are rejected as overbroad;
- duplicate-submit prevention is `PARTIAL / UNVERIFIED`, because React state alone is not a proven same-tick mutex and the inspected unit tests do not explicitly cover double-click or Enter-plus-click races;
- malformed or partially missing routing metadata handling is `PARTIAL`, not fully proven for every shape;
- automated accessibility checks do not prove NVDA, JAWS, VoiceOver, or TalkBack speech behavior;
- a suggested quick language switcher is a product idea, not a release finding.

Internal treatment: `CONDITIONAL PASS / medium` after correcting overclaims.

### Genspark — evidence consistency synthesis

- Latest exact-SHA rerun was not performed because the free credit was exhausted.
- No paid continuation was used.
- The earlier audit against an older SHA remains historical discovery material only and is not acceptance evidence for `39b8670`.

Internal treatment: `INCOMPLETE` for the latest runtime candidate.

## Corrected claims-to-evidence matrix

| Claim | Status | Notes |
|---|---|---|
| Authoritative provider route | PROVEN | Boundary routers precede downstream routes and fail closed. |
| Sensitive-input blocking | PROVEN | Per-message and structured cross-stream detection, NFKC, and invisible-character removal are covered. |
| Provider-bound context minimization | PARTIAL | Policy/design work exists; full runtime minimization remains deferred. |
| Free-only enforcement | PROVEN | Zero ceiling, current catalog evidence, exact-route checks, and fail-closed behavior. |
| No paid fallback / automatic provider switch | PROVEN | Dedicated execution path and routing verification. |
| Truthful cost and verification UI | PROVEN for expected schema; PARTIAL for arbitrary malformed metadata | Answers are withheld when route or zero cost cannot be verified. |
| Japanese-first and one-outcome UX | PROVEN from code and tests | Owner hands-on confirmation is still required. |
| Mobile and keyboard behavior | PARTIAL | Automated coverage exists; physical-device and duplicate-submit race checks remain. |
| Real screen-reader behavior | UNVERIFIED | Automated semantics are not hardware/OS speech verification. |
| Independent reviewer execution | INCOMPLETE | UI truthfully reports `not-run`; runtime synthesis is not connected. |
| Durable sanitized trace persistence | INCOMPLETE | Design documentation is not a production storage implementation. |
| Owner acceptance | INCOMPLETE | Must be performed by the owner. |

## Owner hands-on acceptance checklist

Perform with synthetic, non-sensitive data only.

### Desktop and mobile navigation

- Open the Personal Edition at desktop width and at approximately `390x844`.
- Confirm the first screen asks for the desired outcome without model, agent, provider, cost-slider, or retry-policy selection.
- Open and close the mobile sidebar using its control, backdrop, Escape key, and a navigation item.
- Confirm no fake project names, Enterprise upgrade prompts, provider toggles, or internal AI-core labels appear.

### Composer and submission

- Confirm Enter submits and Shift+Enter inserts a newline.
- Confirm whitespace-only input does not submit.
- Rapidly test double-click, double-Enter, and Enter-plus-click while one request starts. Record whether more than one network request or duplicate user message appears.
- Confirm the composer remains visible and does not cover the last response at mobile size.

### Safety and truthful errors

- Use a synthetic credential-shaped value, never a real secret.
- Confirm the request is blocked before provider execution and that no retry or settings action appears for the secret block.
- Confirm provider-not-configured, rate-limit, timeout, unavailable, stale-free-evidence, cost-unverified, and routing-unverified states use distinct wording.
- Confirm technical details are initially collapsed and reveal only an error code and reference ID when opened.

### Execution disclosure

- For a successful synthetic request, confirm `無料で実行` appears only when free-only and zero-cost metadata support it.
- Open execution details and confirm model, processing time, cost, selection reason, and `独立検証なし` are displayed without claiming verification occurred.
- Confirm missing or contradictory metadata never produces a misleading success/free/verified label.

### Accessibility acceptance

- Complete at least one manual VoiceOver or NVDA session with keyboard-only navigation.
- Verify labels for the main request field, chat field, send button, sidebar control, settings control, error alert, status changes, and both `<details>` summaries.
- Verify focus order, visible focus, Escape behavior, and focus restoration.
- Record browser, OS, assistive technology, version, and observed failures.

## Release blockers that remain after external review

- owner hands-on acceptance;
- real screen-reader verification;
- duplicate-submit race determination;
- provider-bound context minimization decision;
- automatic independent reviewer execution and evaluator integration;
- durable sanitized trace persistence;
- explicit owner authorization before changing Draft state, merging, or deploying.

## Acceptance rule

The external reviews found no confirmed unresolved P0/P1 issue in the exact runtime candidate. This is sufficient to proceed to owner hands-on acceptance, subject to the qualifications in this document. It is not sufficient to declare the product complete or production-ready.

Because Genspark could not rerun under the free-only constraint, its latest-SHA evidence-synthesis slot remains explicitly incomplete. The safer interpretation governs any disagreement or unverified claim.

The pull request must remain Draft until the owner explicitly authorizes a state change. No external-AI verdict authorizes merge or deployment.