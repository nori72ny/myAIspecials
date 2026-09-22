# ORIGIN UI/UX Visual Release Gate — 2026-09-22

Status: ACTIVE / PR #608 / NOT PRODUCTION APPROVAL

This checklist is the visual acceptance gate for the conversation-first redesign. Passing unit/E2E/security CI alone does not make the UI production-ready.

## P0 rule

If any P0 item below fails, do not merge or deploy the redesign to Production.

## 1. Duplicate Header

Goal: one global product header; conversation remains the dominant plane.

- [ ] ORIGIN identity is not duplicated between outer shell and inner App.
- [ ] No `ORIGIN Personal` / `ORIGIN Personal 2.0` double branding.
- [ ] Exactly one persistent header row.
- [ ] Desktop header is approximately 48–56px high.
- [ ] Mobile header is approximately 44–48px high.
- [ ] History/Search remains reachable after consolidation.
- [ ] Settings remains reachable.
- [ ] New Conversation remains reachable.
- [ ] Knowledge Map/local-history capability is not silently deleted.
- [ ] Header does not expose more than roughly 5–6 primary targets on empty Chat.
- [ ] Header does not cover conversation content when sticky/fixed.
- [ ] No header-driven layout shift while scrolling.

## 2. Composer-adjacent Mode switching

Goal: avoid persistent top-level system-mode chrome.

- [ ] Large top Chat / Research / Code / Create controls are removed from the final layout.
- [ ] Mode control is adjacent to, or integrated with, the Composer.
- [ ] Current mode is clear without dominating the Composer.
- [ ] Mode changes require no more than two interactions.
- [ ] Changing mode preserves typed input.
- [ ] Changing mode does not cause a large Composer height jump.
- [ ] Keyboard and screen-reader operation works.
- [ ] Auto-routing is shown only when runtime evidence proves that routing decision.
- [ ] Unsupported Work mode is not exposed as available.

## 3. Project top-UI removal

Goal: Project context is secondary, not a permanent top navigation layer.

- [ ] No permanent top `Overview / Chat / Files / Tasks / Artifacts / Sources` row.
- [ ] Empty Files/Tasks/Sources/Artifacts do not consume primary navigation space.
- [ ] Project controls move to sidebar/drawer/contextual surfaces.
- [ ] Empty Chat can be used without seeing Project chrome.
- [ ] Files surface only with real coding evidence.
- [ ] Tasks surface only with a real job/status.
- [ ] Sources surface only with real research evidence.
- [ ] Artifacts surface only when an artifact exists.
- [ ] Developer-facing text such as `Grounded state only` is not persistent first-view chrome.

## 4. Artifact display

### Desktop

- [ ] Chat remains visible when Artifact opens.
- [ ] Artifact does not simply overlay and hide Chat.
- [ ] Real split-view is visible.
- [ ] Chat retains practical reading/composer width.
- [ ] Artifact receives enough width for preview/editing.
- [ ] Closing Artifact returns Chat to full width without large scroll jump.
- [ ] Composer is never covered by Artifact.
- [ ] Code/Preview/Diff controls stay within Artifact workspace.
- [ ] Secondary Artifact operations are progressively disclosed.

### 390px mobile

- [ ] No Conversation/Artifact switch when no Artifact exists.
- [ ] The switch appears only when Artifact exists.
- [ ] Conversation can be restored in one interaction.
- [ ] Artifact view introduces no horizontal page overflow.
- [ ] Artifact state does not create a second/third persistent header stack.
- [ ] Returning to Conversation preserves useful scroll/context.

## 5. Runtime state display

Goal: observable execution state belongs in the conversation timeline, not permanent header chrome.

- [ ] Agent activity is not permanently shown in Header.
- [ ] Research activity is not permanently shown in Header.
- [ ] Tool activity is not permanently shown in Header.
- [ ] Runtime state appears near the latest relevant message.
- [ ] State details are collapsible where appropriate.
- [ ] Only observable runtime state is shown; no hidden chain-of-thought is exposed.
- [ ] Planning/starting state is represented when actually observable.
- [ ] Web/source retrieval state is represented when actually observable.
- [ ] Code/tool execution state is represented when actually observable.
- [ ] Testing/verifying state is represented when actually observable.
- [ ] Approval-waiting state is represented inline.
- [ ] Approval card names the action and scope.
- [ ] Cancel/reject action is clear where supported.
- [ ] Failed state provides actionable retry/recovery guidance.
- [ ] Completed state compresses rather than permanently occupying large space.
- [ ] Appropriate `aria-live` semantics exist for important status changes.

## 6. Typography and reading quality

- [ ] Main answer body is approximately 15–16px.
- [ ] Main answer line-height is approximately 1.6–1.7.
- [ ] 11px text is not used for primary information.
- [ ] Metadata remains visually secondary.
- [ ] Long-answer line length is controlled.
- [ ] Heading hierarchy is clear but not oversized.
- [ ] Lists have enough vertical rhythm.
- [ ] Code blocks are visually distinct and readable.
- [ ] Sources/verification do not overpower the answer.
- [ ] Borders/cards are not used where spacing alone can express hierarchy.
- [ ] Light mode primary answer contrast is comfortable.
- [ ] Dark mode primary answer contrast is comfortable.
- [ ] Review examples include a 1-line answer.
- [ ] Review examples include ~500 Japanese characters.
- [ ] Review examples include ~3000 Japanese characters.
- [ ] Review examples include a list, table, code block and sourced Research answer.

## 7. 390px responsive/mobile

P0 unless noted otherwise.

- [ ] No horizontal page scroll.
- [ ] Header stays one row.
- [ ] Header stays approximately 44–48px.
- [ ] No horizontal Mode tab strip.
- [ ] No Project tab strip.
- [ ] Model/Tools/Agent are not permanently exposed.
- [ ] Composer is always reachable.
- [ ] Virtual keyboard does not hide Composer.
- [ ] Send remains reachable with keyboard open.
- [ ] Attach/Send/navigation controls meet approximately 44px touch target.
- [ ] Safe-area insets are respected.
- [ ] Android Chrome bottom UI does not cover Composer.
- [ ] The majority of the first view visually belongs to Chat/Composer, not controls.
- [ ] Empty state is not a giant dashboard card.
- [ ] Suggestions, if present, stay concise and limited.
- [ ] Navigation drawer prevents background scroll while open.
- [ ] Back/close behavior is predictable.
- [ ] Validate 390x844.
- [ ] Validate 390x700.
- [ ] Validate 390x600.
- [ ] Validate 390x480.
- [ ] Validate reduced available height with virtual keyboard.

## Required screenshot/evidence set

- [ ] Empty Chat desktop 1440px.
- [ ] Empty Chat desktop 1280px.
- [ ] Empty Chat tablet 768px.
- [ ] Empty Chat mobile 390px.
- [ ] Active conversation desktop.
- [ ] Active conversation mobile 390px.
- [ ] Desktop Chat + Artifact split.
- [ ] Mobile Conversation tab with Artifact available.
- [ ] Mobile Artifact tab.
- [ ] Agent/tool running.
- [ ] Research/source acquisition.
- [ ] Approval waiting.
- [ ] Error/recovery state.
- [ ] Light theme.
- [ ] Dark theme.
- [ ] Real Android virtual keyboard evidence, or explicit release limitation.

## Final release gate

All must be true:

- [ ] Duplicate header eliminated.
- [ ] Persistent top Mode row eliminated.
- [ ] Persistent top Project row eliminated.
- [ ] Empty view exposes roughly 5–6 primary interaction targets or fewer.
- [ ] Desktop Artifact split works.
- [ ] 390px Artifact switch works.
- [ ] Runtime state is inline and evidence-grounded.
- [ ] Long-form Typography passes review.
- [ ] 390px horizontal overflow is zero.
- [ ] Composer clipping is zero.
- [ ] Light/Dark are reviewed.
- [ ] 1440/1280/768/390 are reviewed.
- [ ] Real Android keyboard is reviewed or limitation documented.
- [ ] Exact-head Playwright screenshots are retained.
- [ ] Exact-head required CI/security/browser workflows are green.
- [ ] Owner gives explicit visual approval.

Until every P0 gate passes, PR #608 remains Draft / DO NOT MERGE / NOT PRODUCTION.
