# ORIGIN UI/UX Multi-AI Convergence — 2026-09-22

Status: ACTIVE DESIGN CONTRACT / PR #608 / DO NOT MERGE

Sources reviewed:
- Owner-provided Claude audit of the PR #607 visual baseline and PR #608 draft.
- Owner-provided Gemini audit of the same problem set.
- Repository implementation on PR #608.

This document records convergence, not authority. External recommendations are adopted only where they match ORIGIN product goals, runtime evidence, accessibility, and security boundaries.

## Strong agreement across Claude + Gemini + repository evidence

1. ORIGIN must be conversation-first, not dashboard-first.
2. Empty first view must expose only a small number of primary actions; target roughly 5–6 rather than the PR #607 baseline's approximately 22 apparent controls.
3. Only one product-level header should remain.
4. Model / Tools / Agent are secondary system controls and must be progressively disclosed.
5. Project Files / Tasks / Sources / Artifacts must not occupy permanent top navigation.
6. Chat / Research / Code / Create must not depend on a horizontally overflowing mobile row.
7. Artifact work must coexist with Chat on desktop through a true split view.
8. Mobile Artifact should use a temporary Conversation / Artifact segmented switch only when an Artifact exists.
9. Agent / Research / Tool / approval state belongs in the conversation timeline near the work that caused it, not in persistent global chrome.
10. Typography, spacing and answer width should be tuned only after the structural chrome is reduced.

## Adopted target information architecture

### Global header

Desktop target: one compact row around 48–56px.
Mobile target: one compact row around 44–48px.

Keep only:
- navigation/drawer trigger where needed;
- ORIGIN identity;
- current project/workspace context only when meaningful;
- one compact ORIGIN Auto/system control;
- account/share controls only when backed by live behavior.

Remove from persistent header:
- separate Model / Tools / Agent badges;
- permanent Project view tabs;
- permanent Files / Tasks / Sources / Artifacts tabs;
- multi-row Mode chrome;
- version/product metadata that belongs in Settings/About.

### Navigation

Desktop:
- collapsible left sidebar for New Conversation, History/Search, Projects and Settings.

Mobile:
- one drawer from the header.

Current history search and Knowledge Map access must remain reachable before the legacy inner App header is removed.

### Omni-Composer direction

Gemini's strongest unique recommendation is adopted as the target direction:
- Mode selection moves away from the global top area and into a composer-adjacent control.
- The default experience is ORIGIN Auto routing where runtime evidence supports it.
- Manual Research / Code / Create selection remains available as an override.
- The UI must never claim automatic routing that the server has not actually performed.

Implementation sequence:
1. introduce a single compact composer mode/tool control without changing runtime semantics;
2. route existing Chat / Research / Code / Create workspace switching through that control;
3. later surface server-proven automatic routing as a small contextual badge that the user can override;
4. remove the old top Mode row only after accessibility and navigation parity tests pass.

### Project context

Project is contextual, not a permanent dashboard.

Files / Tasks / Sources / Artifacts should appear only when grounded evidence exists. Empty unavailable views must not consume the primary first-view hierarchy.

Current PR #608 uses progressive disclosure as an intermediate step. Final direction is sidebar/drawer or contextual controls rather than a permanent top Project row.

### Execution states

Agent running, Research acquisition, Tool execution, verification, approval waiting, failure and completion should render inline in the chat timeline.

Preferred pattern:
- compact collapsible activity block;
- short plain-language state;
- expandable evidence/details;
- approval actions inline beside the exact pending operation;
- no blinking global header state and no layout-shifting persistent banner unless safety requires one.

Do not expose hidden chain-of-thought. Show task progress, tool/action status, evidence and externally observable steps only.

### Artifact coexistence

Desktop:
- Chat left, Artifact right;
- approximately balanced split by default;
- preserve real Chat width;
- close to return to full-width Chat;
- future resizable divider is preferred.

Mobile:
- Chat remains default;
- when Artifact exists, show a compact Conversation / Artifact segmented control;
- Artifact can occupy the screen when selected;
- composer/conversation state must survive switching.

## Immediate PR #608 changes adopted from the combined audits

Already implemented on the current branch:
- Model / Tools / Agent collapsed behind ORIGIN Auto settings.
- unavailable Work removed from first-view mode chrome.
- mobile Mode horizontal overflow replaced by one select.
- desktop Artifact state preserves Chat width instead of simply covering it.
- Artifact focus collapses auxiliary chrome.
- Project context uses progressive disclosure.
- stale tests that required the removed `ORIGIN mobile controls` disclosure are being replaced with the new accessibility contract.
- mobile ORIGIN Auto, Mode and Project progressive controls use at least 44px interaction height.

## Next implementation order

P0-A — CI recovery
- make current PR #608 exact-head unit tests pass without restoring the old layout;
- rerun ACOS, Production Release, hosted coding sandbox and security workflows.

P0-B — single global header
- move History / Search / New Conversation / Settings / Knowledge Map access to the new navigation surface;
- remove the duplicate inner App product header only after parity tests pass.

P0-C — composer-centric mode architecture
- introduce one compact composer-adjacent mode/tool control;
- preserve explicit Chat / Research / Code / Create semantics;
- remove persistent top Mode controls after browser evidence passes.

P0-D — project navigation removal from top chrome
- migrate Project details to sidebar/drawer/contextual surfaces;
- keep Files / Tasks / Sources / Artifacts evidence-gated.

P0-E — inline runtime state
- represent Research / Code / Tool / approval / failure states in the message timeline using observable runtime state only.

P1 — typography and spacing
- answer text around 15–16px with deliberate readable line height;
- reduce 11–12px text to metadata-only use;
- replace unnecessary borders/cards with spacing and surface hierarchy.

P1 — split view refinement
- evidence-based desktop split sizing;
- consider resizable divider after stable responsive behavior is proven.

## Acceptance criteria

Before production approval, exact-head evidence must include:
- desktop and 390px empty Chat;
- desktop and 390px active conversation;
- primary first-view interaction-count review;
- no horizontal overflow;
- composer always reachable;
- desktop Chat + Artifact split;
- mobile Conversation and Artifact states;
- Research running;
- Code/Agent running;
- Tool activity;
- approval waiting;
- error state;
- Light and Dark;
- keyboard/focus navigation;
- real Android virtual-keyboard behavior or a documented release limitation.

## Security and truthfulness boundaries

UI simplification must not weaken:
- Artifact sandbox isolation;
- server-only secrets;
- owner authorization;
- MCP permission review;
- approval gates for consequential writes;
- fail-closed behavior.

Do not display a capability, automatic routing state, verified source state, task state, approval state or Agent state unless runtime evidence supports it.

## Release boundary

PR #608 remains Draft / DO NOT MERGE until exact-head CI, browser evidence, accessibility checks, external-audit follow-up and Owner visual approval are complete.
