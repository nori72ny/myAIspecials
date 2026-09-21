# ORIGIN UI/UX Claude Audit Action Ledger — 2026-09-22

Source: Owner-provided external Claude audit of PR #607 baseline screenshots plus PR #608 draft excerpts.

This file is an implementation ledger, not a claim that the audit is automatically correct. Each item is checked against repository code and classified as adopted, already resolved, in progress, pending, or evidence-required.

## P0

### 1. Multi-row chrome before conversation
Status: IN PROGRESS

Confirmed on PR #607 baseline. PR #608 already collapsed Model / Tools / Agent into `ORIGIN Auto`, removed always-visible mode descriptions, hid unavailable Work, and collapsed Project navigation.

Remaining: duplicate inner App header still exists below the global workspace shell. It must be consolidated before production approval.

### 2. Duplicate Conversation / Artifacts / Mode statistics
Status: ALREADY RESOLVED IN PR #608

The old overview statistics cards are no longer rendered by `OriginProjectWorkspaceV31`. Grounded project state is behind progressive disclosure.

### 3. Mobile Mode overflow
Status: IMPLEMENTED ON CURRENT PR #608 HEAD

At mobile widths the horizontal Mode button row is replaced by one native Mode selector containing only backed modes: Chat / Research / Code / Create. Unavailable Work is not exposed in the first-view chrome. Desktop retains compact mode buttons.

Acceptance evidence still required: Playwright 390px screenshot and horizontal-overflow assertion on exact head.

### 4. Artifact open state crushes conversation
Status: IMPLEMENTED / NEEDS VISUAL EVIDENCE

The Personal shell now marks `origin-personal-artifact-open` explicitly. Desktop keeps Chat mounted and reserves up to 60vw / 860px for the Artifact panel, while Project context and duplicate Artifact status chrome collapse during artifact focus. Mobile keeps the existing Conversation / Artifact tab pattern and hides Chat only while the Artifact tab is selected.

Inner App-generated Artifact panels also reserve desktop conversation width through scoped CSS.

Acceptance evidence still required: desktop Chat+Artifact screenshot, mobile Conversation tab screenshot, mobile Artifact tab screenshot.

## P1

### 5. Duplicate branding / duplicate headers
Status: CONFIRMED / PENDING STRUCTURAL REFACTOR

The global PR #608 shell renders ORIGIN / Personal, while the shared `App` still renders its own ORIGIN / Personal 2.0 header with History / Settings / New Conversation. This is a real duplication, not just a screenshot artifact.

Planned direction: global shell becomes the only product header. History / Settings / New Conversation move into one navigation surface; version moves to Settings/About. Do not hide the legacy header until all current controls remain reachable.

### 6. Left navigation / history discoverability
Status: PENDING

External audit recommends a collapsible desktop sidebar and mobile drawer for New Conversation, history/search, Projects and Settings. This is adopted as the preferred design direction, but implementation must preserve current local history search and knowledge-map access before the old header is removed.

### 7. Density / spacing
Status: PARTLY RESOLVED

Most density came from stacked chrome. Re-evaluate only after the structural reductions above are visible in exact-head screenshots; do not compensate with tiny typography.

## P2

### 8. Agent state labels
Status: PENDING COPY REVIEW

Current labels are `通常応答` and `実行可能`. Before production, align execution states with one vocabulary shared by Code / Research / tool activity (for example idle, planning, running, waiting-for-approval, testing, verifying, failed, complete) without implying states that runtime cannot prove.

### 9. Grounded Project state
Status: KEEP

Files / Tasks / Artifacts / Sources remain unavailable unless backed by actual evidence. This progressive-disclosure boundary is intentional and should not be weakened for visual completeness.

## Evidence required before UI approval

1. Empty Chat desktop screenshot.
2. Empty Chat 390px screenshot.
3. Active conversation desktop screenshot.
4. Active conversation 390px screenshot.
5. Desktop Artifact split-view screenshot.
6. Mobile Conversation tab with Artifact available.
7. Mobile Artifact tab.
8. Code / Agent running with actual progress evidence.
9. Research running / source acquisition state.
10. Approval-waiting state.
11. Error state.
12. Light and dark theme for the primary Chat surface.
13. Real Android keyboard behavior or an explicit release limitation.

## Quantitative target adopted from the audit

The empty first-view surface should expose roughly 5–6 primary interaction targets rather than the PR #607 baseline's approximately 22 apparent controls. This is a product-density target, not a requirement to remove capabilities. Secondary features should remain available through progressive disclosure.

## Release boundary

PR #608 remains Draft / DO NOT MERGE. No Production release is authorized by this ledger. Exact-head CI, visual evidence, accessibility checks, external audit follow-up and Owner visual approval remain required.
