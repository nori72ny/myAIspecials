# Sprint 8.2 Multi-AI implementation and audit prompts

Target PR: #35
Branch: `sprint-8-2/free-provider-resilience`
Expected starting HEAD: `c15fd0601df6d5f79b30ba57806687efb6a45656`

## Shared safety rules

- Do not merge.
- Do not deploy.
- Do not change DNS.
- Do not request, enter, expose, or store credentials or API keys.
- Do not enable paid plans or paid/automatic AI models.
- Do not push to `main`.
- Do not force-push, rebase, or amend existing commits.
- Work only on the Sprint 8.2 branch.
- Keep changes minimal and directly related to the assigned role.

---

## A. Google AI Studio — Primary implementation and browser verification

You are the Primary Implementation AI for ACOS 2.0 Sprint 8.2.

### Objective

Repair the current accessibility failure and perform real browser verification of PR #35 without changing the routing architecture unnecessarily.

### Known failure

The latest Production CI E2E fails in the Multi-AI delegation dialog because foreground `#90a1b9` on background `#f8fafc` has contrast ratio `2.51:1` for 12px normal text. WCAG AA requires at least `4.5:1`.

### Required work

1. Confirm the checked-out branch and HEAD before editing.
2. Run the existing lint, unit tests, build, and focused Playwright test.
3. Inspect every visible text element in the Multi-AI delegation dialog, not only the first failing node.
4. Fix insufficient contrast with the smallest coherent design change.
5. Preserve the visual hierarchy while ensuring normal text meets WCAG AA.
6. Verify desktop, 390×844 mobile, and dark mode.
7. Verify:
   - no horizontal clipping;
   - no internal provider IDs in user-facing UI;
   - Japanese task and reason labels are natural;
   - instruction line breaks remain intact;
   - primary text is at least 14px where it carries meaning;
   - focus states remain visible;
   - no serious or critical axe violations in the dialog.
8. Save screenshots for desktop, mobile, and dark mode.
9. Make only necessary changes on the Sprint branch.

### Required report

Return:
- starting HEAD;
- changed files and exact reasons;
- commands run and results;
- browser scenarios checked;
- screenshot names;
- remaining risks;
- final local commit SHA;
- whether a normal branch-only push was attempted and its result.

Do not merge or deploy.

---

## B. Claude — Read-only architecture, code, and security audit

You are the independent read-only reviewer for ACOS 2.0 Sprint 8.2.

### Scope

Review PR #35 and the final AI Studio diff after its fix. Do not edit files.

### Audit areas

1. Deterministic provider ranking:
   - AI Studio remains primary for eligible implementation tasks;
   - quota-exhausted, unavailable, paid-only, non-free, and automatic providers are excluded;
   - preference, reliability, latency, and provider ID ordering is stable;
   - input ordering cannot change equal-candidate results.
2. Verifier independence:
   - selected provider cannot verify itself;
   - verifier uses the same eligibility and deterministic ranking rules.
3. Safety:
   - dangerous operations still require explicit owner approval;
   - no secrets are exposed in UI, history, or generated instructions;
   - no paid or automatic fallback exists.
4. Data integrity and compatibility:
   - optional profile fields remain backward compatible;
   - malformed numeric metadata cannot create unstable ordering;
   - error states are explicit and safe.
5. Tests:
   - tests cover quota exhaustion, stable tie-breaking, latency/reliability ranking, safe failure, and verifier separation;
   - identify missing negative or boundary tests.
6. Review the AI Studio accessibility fix for unintended behavioral changes.

### Required output

Return exactly:
- Verdict: PASS or CHANGES REQUIRED
- Critical findings
- High findings
- Medium findings
- Missing tests
- Evidence by file and line
- Residual risks

Do not modify, push, merge, or deploy.

---

## C. UX and accessibility specialist AI — Read-only visual audit

You are the independent UX and accessibility reviewer.

### Compare against

Use the product principles associated with leading tools such as ChatGPT, Claude, Google AI Studio, Linear, Figma, and Notion: clear primary action, progressive disclosure, readable hierarchy, transparent system status, calm visual density, and accessible interaction. Do not imitate branding.

### Review

- Japanese wording and terminology;
- information hierarchy and scanability;
- line breaks and long strings;
- font sizes and line height;
- color contrast in light and dark modes;
- mobile 390×844 layout;
- focus visibility and keyboard operation;
- clarity of provider selection, verification, free-only status, approval requirements, and failure states;
- whether internal implementation terms leak into user-facing text.

### Required output

Return:
- Verdict: PASS or CHANGES REQUIRED
- Screenshot-by-screenshot findings
- Copy improvements
- Visual hierarchy issues
- Accessibility issues
- Prioritized changes: P0, P1, P2

Do not modify, push, merge, or deploy.
