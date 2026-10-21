# ORIGIN AI Studio Next Handoff

Exact source SHA: `d128f5dcc826d4dfae83f7b004f38af1dad9bc14`

Date prepared: 2026-07-31 JST

Expected and actual cost for preparing this handoff: `$0.00`

## Purpose

This handoff tells Google AI Studio and any external reviewer what to do next after PR #48 was merged to `main`.

ORIGIN is not a generic AI chat tool. ORIGIN is a user-goal execution and answer-quality system. The user should state one goal, and ORIGIN should decide the needed information, routing, verification, answer structure, and next action while preserving a calm, world-class Personal experience.

GitHub remains the only source of truth. AI Studio is the preferred implementation workbench, not the product identity and not automatic permission to use Gemini API in production.

## Current State

- Repository: `nori72ny/myAIspecials`
- Canonical branch: `main`
- Exact source SHA: `d128f5dcc826d4dfae83f7b004f38af1dad9bc14`
- PR #48: merged to `main`
- Deployment: not approved and not performed
- Runtime cost policy: `$0.00` only
- Live external AI execution during this handoff: none
- Secrets requested, displayed, or used: none

Latest local recheck on this SHA:

- `npm ci --cache /tmp/origin-npm-cache`: PASS
- `npm run lint`: PASS
- `npm test`: PASS, 66 files / 771 tests
- `npm run test:api`: PASS, 5 passed / 1 skipped
- `npm run build`: PASS
- local production HTTP smoke: PASS for `/health`, `/`, `/api/chat` fail-closed without provider credentials, and weather no-external-AI path

E2E note: PR #48 had passing candidate CI evidence. A later local rerun could not execute Playwright because the Codex environment could not install Chromium. Treat that as environment-limited, not as a product pass or fail.

## Non-Negotiable Constraints

- Do not use paid services, paid APIs, paid models, or paid fallback.
- External AI may only use confirmed free execution.
- OpenRouter may only use explicit `:free` models with no paid fallback.
- Gemini API / AI Studio direct runtime must not be enabled unless free-tier evidence, data policy, model stability, zero-cost proof, and owner approval are all present.
- API keys, passwords, tokens, and secrets must never be requested, shown, logged, committed, or placed in UI.
- Credentials may only be read from server-side environment variables in future runtime work.
- Do not merge to `main` without explicit owner approval.
- Do not deploy without separate explicit owner approval.
- Do not change DNS, cloud, billing, account, repository settings, or authentication settings.
- Do not claim tests passed unless they were executed on the exact candidate SHA.
- Do not show fake data, sample data, mock answers, unimplemented features, or unsupported privacy claims as real product behavior.

## Product Direction To Preserve

Use `docs/ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.md` as the canonical product contract.

The implementation must preserve these principles:

- One natural-language goal is the primary input.
- ORIGIN should understand the goal, not just answer the literal prompt.
- The answer should lead with the useful result, then evidence, verification status, constraints, and next action.
- Provider/model details belong in technical details, not the main answer.
- Independent review must not be claimed unless it actually ran.
- Source verification must not be claimed unless source content was actually checked.
- The UI should be Japanese-first, calm, dense enough for repeated use, and usable on mobile, tablet, and desktop.
- The interface should not become a model picker, dashboard demo, or generic AI chat clone.
- Future AI services should be added through provider adapters and capability evidence, not by rewriting the core product around one provider.

## AI Studio Implementation Prompt

Use this prompt when asking the main implementation AI in Google AI Studio to continue work.

```text
Repository:
nori72ny/myAIspecials

Product:
ORIGIN

Exact base SHA:
d128f5dcc826d4dfae83f7b004f38af1dad9bc14

You are the implementation agent working in Google AI Studio.
GitHub is the only source of truth. Use only the code at the exact SHA above.
Do not rely on AI Studio chat memory, generated previews, or unstaged local state as truth.

Goal:
Prepare the next safe release-candidate improvement for ORIGIN Personal without deploying.
Preserve ORIGIN as a world-class goal-execution and answer-quality service, not a generic AI chat tool and not a Gemini-only product.

Hard constraints:
- Expected and actual cost must be $0.00.
- Do not use paid models, paid APIs, paid tools, or paid fallback.
- Do not request, display, store, log, or commit secrets.
- Do not change DNS, cloud, billing, account, repository settings, or auth settings.
- Do not merge to main.
- Do not deploy.
- Do not enable Gemini API or AI Studio direct runtime as production execution.
- Do not present unimplemented features, fake data, mock output, or unverified privacy/performance claims as real.

First inspect:
- docs/ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.md
- docs/ORIGIN_PERSONAL_RELEASE_1_GATE.md
- docs/AI_STUDIO_DEVELOPMENT_CONTRACT.md
- src/components/personal/PersonalEditionApp.tsx
- src/components/personal/PersonalDashboard.tsx
- src/components/personal/UnifiedChat.tsx
- src/components/SettingsModal.tsx
- src/server/createOriginApp.ts
- src/legacy/originProviderClient.ts
- src/lib/orchestration/OriginAnswerEnvelope.ts
- src/lib/orchestration/OriginReviewPolicy.ts
- src/lib/orchestration/OriginSourceVerification.ts

Recommended next implementation scope:
1. Improve the main answer presentation so conclusion, answer body, evidence, independent-review status, limitations, and next actions are visibly distinct while remaining compact.
2. Keep provider/model IDs in collapsed technical details only.
3. Ensure every user-facing Japanese phrase matches actual runtime capability.
4. Add or update tests proving no fake Project/Memory/sample content appears in the Personal release UI.
5. Add or update tests proving AI Studio direct runtime remains disconnected from the formal /api/chat release path.
6. Add or update tests proving source verification and independent review are not displayed as completed when not executed.
7. Do not add new runtime provider execution unless a separate owner-approved provider task explicitly allows it.

Validation required before reporting complete:
- npm ci
- npm run lint
- npm test
- npm run test:api
- npm run build
- relevant E2E when browser support is available

Output required:
- branch name
- changed files
- exact commit SHA
- tests run and results
- tests not run and why
- remaining P0/P1/P2
- confirmation that main was not merged
- confirmation that deployment was not performed
- confirmation that cost remained $0.00
```

## External AI Audit Prompt

Use this prompt when asking Claude, Gemini, Grok, or another free reviewer to audit the next candidate.

```text
Repository:
nori72ny/myAIspecials

Pull Request:
<PR number>

Exact candidate SHA:
<candidate SHA>

Audit only the real code at this exact SHA.
Do not use main, another SHA, screenshots without code, or prior conversation memory as evidence.
Do not edit files. Do not run paid tools or paid models. Do not request secrets. Do not merge or deploy.

Product standard:
ORIGIN is a goal-execution and answer-quality service. It must not be reduced to a generic AI chat tool, model picker, fake multi-AI dashboard, or Gemini-only wrapper.

Focus areas:
- First-release Personal UI exposes only implemented capabilities.
- No Project/Memory fake data or sample content is visible.
- No unsupported privacy, encryption, learning, quality, or world-best claims are visible.
- Japanese-first wording is natural and truthful.
- Main answer view prioritizes useful result, then evidence, verification status, limitations, and next action.
- Technical provider/model details are separated from the main answer.
- Source verification is not shown as completed unless source content was actually checked.
- Independent review is not shown as completed unless an independent reviewer actually ran.
- /api/chat remains the formal Personal route.
- legacy routes cannot bypass the free-only policy.
- worker routes cannot execute providers.
- AI Studio direct runtime remains disabled/disconnected from release 1 unless explicitly approved in code and docs.
- paid model, automatic model selection, automatic retry, and provider fallback are blocked.
- secret-like input is blocked before provider transmission.
- provider errors and traces are sanitized.
- duplicate submit, retry, whitespace input, Enter/Shift+Enter, mobile 390x844, and screen-reader states remain correct.

For each claim, label evidence as exactly one of:
- CODE-PROVEN
- TEST-COVERED
- EXECUTED
- UNVERIFIED

Required output:
- Verdict
- Blocking Findings
- Non-Blocking Findings
- Claims-to-Code Matrix
- Negative Tests
- Unverified Areas
- Confidence
```

## Release Decision Prompt

Use this only after a candidate PR has passed CI and review.

```text
Exact candidate SHA:
<candidate SHA>

Decide whether this candidate can move toward first public daily-use release.
Separate these states clearly:
- code ready
- PR ready for owner merge approval
- merged to main
- deployment approved
- deployed
- production smoke verified
- daily-use public release complete

Do not mark release complete from merge alone.
Deployment requires a separate explicit owner approval.
Production smoke must confirm:
- Personal UI loads
- /api/chat uses the formal ORIGIN boundary
- no fake or unimplemented features are visible
- no secrets are requested or exposed
- successful free execution, if configured, proves actual cost $0.00 and no fallback
- provider-not-configured path fails closed
- source and independent-review displays match actual execution
```

## Current Recommendation

The next PR should be a narrow release-quality PR, not a broad feature PR.

Recommended title:

`release: refine ORIGIN Personal answer presentation and AI Studio handoff`

Recommended scope:

- polish structured answer display
- harden truthfulness tests
- preserve AI Studio as development workbench only
- keep deployment out of scope

Do not start production deployment until ノリさん separately approves deployment and the target environment is explicitly identified.

## Merge and Deployment State

- This handoff changes no runtime behavior by itself.
- Merge performed by preparing this handoff: no
- Deployment performed by preparing this handoff: no
- Billing/account/DNS/cloud/repository settings changed: no
- Secrets requested, displayed, or used: no
- Paid model/API/service used: no
