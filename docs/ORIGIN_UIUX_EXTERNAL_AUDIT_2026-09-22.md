# ORIGIN UI/UX External Audit Brief — 2026-09-22

Status: ACTIVE REDESIGN / NOT FINAL / NOT PRODUCTION

## Purpose

This document is intentionally written so the Owner can hand the current ORIGIN UI/UX candidate to Claude, Gemini, Perplexity, Manus, Grok, ChatGPT or a human product designer for an independent audit.

Do not assume that passing CI, Playwright, Lighthouse or viewport tests means the visual product is complete. The current candidate solved functional regressions, but the Owner rejected the present screen hierarchy/layout as not matching the intended finished experience.

## Current evidence baseline

The original visual audit baseline is PR #607 head:

`bda457aa8c08fbc96f944127be5eef987f432311`

Observed browser evidence came from Production Release CI/CD run `35648354416`, Playwright artifact `10660654794` (Node 24). Those screenshots cover desktop/tablet/mobile widths and chat/artifact states.

PR #608 is the active redesign candidate. Current production has NOT been replaced by this candidate.

## Owner direction

ORIGIN should feel like a first-class modern AI product, not an internal control panel.

The primary interaction is the user asking ORIGIN for work. Model routing, tools, agent state, project state, files, sources, artifacts and advanced controls are important, but they must be progressively disclosed instead of occupying the primary visual hierarchy at all times.

The UI should be at least competitive with the interaction clarity of leading AI products while preserving ORIGIN's broader capability model: Chat, Research, Work, Code/Agentic Coding and Create/Visual generation.

## Current problems visible in the exact browser screenshots

1. Too many persistent horizontal layers above the conversation.
2. The interface reads as a dashboard/control surface before it reads as an AI conversation product.
3. Desktop wastes vertical space before the first useful conversation content.
4. Mobile stacks the same concepts vertically and previously allowed Mode controls to overflow horizontally.
5. Labels such as Workspace, Current workspace, Overview, Conversation, Artifacts and Mode repeat the same mental model instead of reducing it.
6. Secondary system state is visually too strong relative to the composer and answer.
7. Advanced concepts (Model / Tools / Agent) are surfaced even when the runtime manages them automatically.
8. Project views expose unavailable/empty concepts too early instead of appearing contextually when evidence exists.
9. The visual rhythm lacks a single dominant focal plane.
10. The global PR #608 shell and the shared App still contain duplicate product-level header concepts; this remains unresolved.

## Required redesign direction

### A. Conversation-first shell

The empty Chat screen should visually prioritize, in this order:
1. ORIGIN identity / minimal global controls
2. Main prompt/composer
3. concise mode/capability switching
4. contextual suggestions
5. advanced controls only on demand

The active conversation screen should prioritize:
1. answer/history
2. composer
3. lightweight context/tool state
4. project/artifact controls only when relevant

### B. Reduce permanent chrome

Target a maximum of one compact global top bar plus one context row where required.

Do not permanently stack Model + Tools + Agent + Mode + Project + Project View + Overview cards.

### C. Progressive disclosure

Model routing, connected tools, agent permissions, diagnostics, source evidence, task state and advanced project controls should move into compact menus, popovers/drawers, contextual side panels, artifact panels, or only-when-active status chips.

### D. Mode architecture

Chat / Research / Work / Code / Create remain important product modes, but switching should be concise and easy to understand.

Current PR #608 direction:
- desktop: compact backed-mode buttons;
- mobile: one Mode selector instead of a horizontally overflowing row;
- unavailable Work is not exposed as first-view chrome until backed by live capability.

### E. Project workspace

Project state should not dominate a new conversation.

Files, Tasks, Artifacts and Sources surface contextually when present. Empty/unavailable views should not consume primary navigation space.

### F. Mobile

At 390px width, ORIGIN must feel like a native mobile AI product rather than a desktop dashboard collapsed vertically.

Required:
- composer always reachable
- no unnecessary duplicated labels
- no multi-level persistent control stack
- thumb-friendly targets where controls exist
- no undiscoverable horizontal Mode overflow
- Conversation / Artifact tab switching when an artifact exists
- virtual keyboard behavior validated separately on real devices before release

### G. Desktop

At 1280–1440px:
- conversation column should have deliberate readable width
- side/context panes should be used only where they improve actual work
- Artifact view should preserve a real conversation pane rather than cover/crush it
- current PR #608 reserves desktop conversation width while Artifact is open and collapses auxiliary Project/Artifact status chrome

## Owner-supplied Claude audit checkpoint

An external Claude audit of the PR #607 baseline screenshots and PR #608 draft excerpts was received on 2026-09-22. Its implementation status is tracked in:

`docs/ORIGIN_UIUX_CLAUDE_AUDIT_ACTIONS_2026-09-22.md`

Key adopted conclusions:
- PR #608's progressive-disclosure direction is correct but incomplete;
- the PR #607 baseline exposed roughly 22 apparent interaction targets in the first view;
- target approximately 5–6 primary interaction targets in the empty first-view surface without deleting capability;
- mobile Mode switching must not depend on horizontal overflow;
- desktop Artifact use should retain an actual Chat pane;
- duplicate global/inner product headers remain a real unresolved issue;
- a collapsible desktop navigation/sidebar and mobile drawer are the preferred next structural direction, provided current local history/search/knowledge access remains reachable.

## External auditor questions

Please review the screenshots/code and answer these without assuming the current design is correct:

1. What are the five biggest hierarchy/usability problems?
2. Which persistent controls should disappear from the main viewport?
3. What should remain in the global header?
4. How would you redesign Chat empty state and active conversation state?
5. How should Chat / Research / Work / Code / Create switching work on desktop and mobile?
6. Should Project views be tabs, a side panel, contextual chips, command palette entries, or another structure?
7. How should artifacts coexist with chat on desktop and mobile?
8. Which parts feel like internal developer UI rather than a consumer/professional AI product?
9. Where is terminology duplicative or confusing?
10. What spacing/typography/content-width changes are needed?
11. What accessibility problems do you see beyond simple target size?
12. What interaction states are missing (loading, streaming, tool use, agent running, approval required, failure, reconnect, artifact edit, source verification)?
13. What would you borrow conceptually from current leading AI interfaces, and what should ORIGIN deliberately do differently?
14. What would prevent you from calling this UI production-quality?
15. Provide a proposed information architecture and wireframe-level layout for desktop and 390px mobile.

## Evidence still required

Do not infer missing states. Before final visual approval, evidence should include:
- desktop and 390px empty Chat;
- desktop and 390px active conversation;
- desktop Artifact split view;
- mobile Conversation tab and Artifact tab;
- Code/Agent running;
- Research running;
- approval waiting;
- error state;
- light and dark themes;
- real Android virtual-keyboard behavior or an explicit limitation.

## Audit constraints

- Do not recommend exposing secrets or provider credentials in the client.
- Do not weaken current Artifact sandbox/security isolation.
- Do not assume unsupported runtime features are already live.
- Distinguish implemented capability from placeholder/status UI.
- Do not optimize only for aesthetics; judge speed, clarity, cognitive load, progressive disclosure, accessibility and task completion.
- Prefer evidence and concrete recommendations over generic UI advice.

## Release gate

UI/UX is NOT considered complete merely because responsive E2E tests pass.

Before production release, the redesign must have:
- explicit Owner visual approval,
- independent audit feedback reviewed,
- exact-head desktop/tablet/mobile screenshots,
- no composer clipping at supported viewport sizes,
- real Android/iOS keyboard verification or explicitly documented limitation,
- dark/light consistency,
- artifact/chat navigation verification,
- accessibility checks,
- no regression to security/agent approval boundaries,
- production smoke after merge.
