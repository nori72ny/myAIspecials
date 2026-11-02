# ORIGIN UX Journey Coverage Audit V1

Audit date: 2026-11-02
Reference source: main SHA a43e91cbe96f07b8743735534c0d76ebd63f76df
Scope: static inspection of Playwright E2E specifications and the CI workflow. This is a coverage map, not a claim that every journey was executed on a physical device.

## Executive finding

ORIGIN already has meaningful browser-level UX coverage. It is not accurate to describe the product as having no usability tests. Existing suites cover responsive surfaces, composer placement, menus, settings, history, artifact previews, keyboard interaction, accessibility scans, storage recovery, transport failure, streamed Japanese text, and multiple workspaces.

However, current evidence does not yet constitute a complete independent usability certification. Tests are mostly deterministic browser automation with mocked provider responses. The CI Playwright project runs Chromium; Firefox/WebKit jobs exercise artifact isolation rather than the full 12-journey task suite. No physical-device execution, representative-user study, task-time baseline, click/turn count, or independent preference panel is established by these files.

## Journey-to-evidence matrix

| Required journey | Existing evidence inspected | Coverage judgement | Remaining evidence |
|---|---|---|---|
| 1. First use and first successful task | `origin-personal-navigation.spec.ts`, `full-interaction-release-gate.spec.ts` | PARTIAL — surface and interaction checks; no first-time user task success/time study | First-run task protocol; success/time/action count; novice participants |
| 2. New conversation and resume | `storage-reload.spec.ts`, `origin-personal-navigation.spec.ts` | PARTIAL — durable session and reload are covered | Explicit create-new/resume task, data-integrity assertions across full journey |
| 3. Primary navigation discovery | `origin-personal-navigation.spec.ts`, `full-interaction-release-gate.spec.ts` | PARTIAL — routes and menu actions tested | Unprompted discoverability and navigation error rate |
| 4. Compose, edit, submit, recover | `mobile-composer-layout.spec.ts`, `origin-personal-navigation.spec.ts` | STRONG browser coverage for composer geometry, typing, submission, transient failure | Quantified effort and physical keyboard/IME verification |
| 5. Attach and inspect a file | Existing full-interaction coverage and attachment controls | PARTIAL — control presence/interaction does not prove end-to-end file semantics | File-type, size, parse, preview, cancellation, retry and data-loss journeys |
| 6. Secondary action/menu | `full-interaction-release-gate.spec.ts`, `mobile-composer-layout.spec.ts` | STRONG browser coverage for menu bounds, touch sizes, Escape and dismissal | Physical touch reachability and assistive-technology semantics |
| 7. Research and source inspection | `full-interaction-release-gate.spec.ts` | PARTIAL — mocked research result and evidence link | Real retrieval quality, source correctness/freshness and citation support |
| 8. Create and reopen artifact | `creative-workspace-v15.spec.ts`, `sprint-8-4-responsive-v2.spec.ts`, `image-history-reload.spec.ts` | STRONG local/browser artifact persistence and export coverage | Independent visual/content quality and real provider output where applicable |
| 9. Network/provider failure recovery | `origin-personal-navigation.spec.ts`, `assistant-reading-surface.spec.ts` | PARTIAL — transient transport failure and fail-closed UI | Provider outage matrix, recovery time, duplicate/side-effect audit |
| 10. Cancel running operation and verify no side effect | No complete end-to-end journey identified in inspected files | GAP | Deterministic long-running operation, cancel race, server-side no-late-write proof |
| 11. Long answer on mobile (tables/code/citations) | `origin-personal-navigation.spec.ts`, `assistant-reading-surface.spec.ts` | PARTIAL — structured answer readability and multiple viewport captures | Long-form table/code/citation stress fixture and scroll/focus/selection assertions |
| 12. Keyboard and assistive technology | `sprint-8-3-accessibility.spec.ts`, `sprint-8-4-responsive-v2.spec.ts` | PARTIAL — focus, Escape, live regions, axe WCAG 2 A/AA checks | Screen-reader manual runs, keyboard-only complete task, WCAG 2.2 AA full review |

## Cross-cutting findings

### Positive evidence

- Responsive viewport coverage includes 320, 360, 390, 412-class mobile constraints in relevant specs, tablet and desktop sizes; several key checks assert no horizontal overflow.
- The mobile composer has explicit width, lower-screen placement, button size, and long-input/menu collision checks.
- Settings focus trapping and focus restoration are tested; automated axe checks exist.
- Local history persistence and recovery after storage read failures are tested.
- Tests explicitly prevent automatic retry on a transient transport failure and test fail-closed zero-cost waiting UI.
- Artifact workspace tests validate actual local SVG/PNG bytes, export, history restoration, and reload behavior.

### Gaps that prevent a usability superiority claim

1. No physical Android/iOS device run is evidenced by the inspected CI configuration.
2. No representative-user or blind usability study is evidenced.
3. No common metric ledger records task success, time-on-task, user actions, turns, error recovery, or user rework across systems.
4. Full 12-journey coverage is not yet implemented as one traceable, independently scored suite.
5. Cancellation with a proven absence of late side effects is not covered as a complete E2E journey in the inspected specifications.
6. Attachment semantics need stronger file-content, failure, cancellation, and persistence cases.
7. Research UI tests use mocked evidence; they do not certify answer correctness or source quality.
8. Accessibility automation is useful but does not replace manual screen-reader and keyboard-only testing.

## Required next work

1. Preserve current E2E suites; do not replace existing narrow regression tests with one broad happy-path test.
2. Add a versioned journey manifest with stable journey IDs, preconditions, steps, success criteria, failure taxonomy, and evidence fields.
3. Add deterministic browser tests for the identified cancellation, attachment, long-answer, and create/resume gaps.
4. Emit machine-readable per-journey results: candidate SHA, viewport, browser, result, duration, action count, turn count, failure code, and trace/screenshot references. Do not collect personal content.
5. Run the full journey suite on Chromium and at least smoke-critical paths on Firefox/WebKit.
6. Arrange physical Android and iOS checks when devices are available; label emulator runs as emulation.
7. Conduct a small, blinded, task-based usability study before claiming lower friction or superiority. Record sample size and uncertainty; do not generalize beyond the tested population.

## Release and claim decision

- Browser-level regression coverage: **EXISTS**.
- Complete 12-journey independent usability certification: **NOT YET**.
- Physical-device usability evidence: **UNVERIFIED**.
- Comparative usability superiority over ChatGPT, Claude, Gemini, or other systems: **NOT MEASURED**.
- Any claim that ORIGIN is easier to use than competing systems: **NOT APPROVED** until matched task-based comparative evidence exists.

This audit is static inspection of the exact listed source revision. It must be rerun against the exact candidate SHA before release acceptance.
