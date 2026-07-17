# Sprint 8.3 Privacy and Browser Resilience Review

## Scope

Issue #36 hardens the manual Multi-AI delegation planner without adding external AI calls, paid models, telemetry, deployment, DNS changes, secret entry, or automatic merge behavior.

## Implemented safeguards

- Deterministic sensitive-input detection for representative credential terms and structured formats.
- Detection results expose categories only and never return matched secret values.
- Routing may inspect the in-memory request, but delegation instructions and audit records receive a separate safe request.
- Secret-bearing goals are replaced with `[REDACTED]` before instruction generation and persistence.
- Audit storage reads, writes, updates, and removals return typed success or failure results.
- Storage denial, quota exhaustion, invalid data, and removal failure do not crash task routing.
- The UI does not claim persistence after a failed write and displays a visible warning.
- Clipboard success and failure are communicated through accessible status or alert semantics.
- The dialog supports initial focus, visible keyboard focus, focusable instruction content, and Escape closing.

## Verification coverage

### Unit

- Representative English and Japanese credential patterns.
- Authorization headers, PEM private-key headers, provider key shapes, JWT and OAuth assignments.
- Case-insensitive matching.
- False-positive resistance for passwordless, secretary, tokenization, and explanatory OAuth or JWT text.
- Detection output does not expose the matched value.
- Audit redaction remains intact after lifecycle updates.
- Denied reads remain distinguishable from an empty history.
- Denied writes, quota failures, and denied removals return explicit failure reasons.
- Secret-bearing delegation instructions contain `Goal: [REDACTED]` and exclude the source value.

### End to end

- Desktop readability, line breaks, minimum text sizes, and WCAG 2A/2AA critical or serious violations.
- Secret warning, instruction redaction, and absence of the secret value from local audit storage.
- Continued routing with a visible warning when audit persistence is denied.
- Accessible clipboard success and failure feedback.
- Keyboard-only opening, planning, instruction focus, and Escape closing.
- 390 by 844 mobile viewport without horizontal clipping.
- Dark-mode text and surface visibility.

## Evidence filenames

- `delegation-planner-desktop.png`
- `sprint-8-3-mobile.png`
- `sprint-8-3-dark.png`
- `sprint-8-3-storage-denied.png`
- `sprint-8-3-secret-redaction.png`

The screenshots are generated as Playwright attachments in CI rather than committed binary assets.

## Security and privacy assessment

No prompt, credential, matched secret value, or external AI response is transmitted by the delegation planner. Audit records are written only after successful browser storage access. A failed write may remain in React state only for the current render path, but the interface explicitly states that persistence failed and does not label the item as saved.

## Independent review gate

Before marking PR #38 ready for review, obtain independent assessments under Issue #37 covering:

1. Code and security review.
2. Browser behavior and accessibility review.
3. Japanese wording and response-quality review.
4. Mobile, desktop, and dark-mode design review.

Claude, Manus, Grok, Gemini or AI Studio, ChatGPT, and specialist tools may be used when available, but implementation and final approval must not be performed by the same reviewer. Every recommendation must be checked against repository evidence before adoption.

## Remaining gates

- All four GitHub workflows must pass on the final head SHA.
- PR #38 must remain Draft until evidence and independent review findings are recorded.
- Merge requires explicit owner approval.
- Deployment remains a separate explicit decision and is not part of Sprint 8.3.
