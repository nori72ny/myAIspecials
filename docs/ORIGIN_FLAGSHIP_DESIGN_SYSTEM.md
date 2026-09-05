# ORIGIN Flagship Design System

Status: active product standard

## Product north star

ORIGIN should feel like a calm, intelligent workspace rather than a chatbot dashboard: one obvious place to think, one obvious place to act, and progressively richer controls only when useful.

The visual language may learn from strong interaction patterns in ChatGPT, Claude, Perplexity, Linear, Arc and Apple-style product design, but ORIGIN must not become a clone of any one product.

## Experience principles

1. **Answer first** — the useful result is visually dominant; controls never compete with it.
2. **Progressive disclosure** — advanced research, artifact, coding and settings controls appear when relevant.
3. **Calm density** — generous whitespace for reading, compact utility controls, no decorative dashboard clutter.
4. **One obvious next action** — primary actions have a single visual emphasis.
5. **Touch is first-class** — interactive targets are at least 44px; mobile composer and safe areas are deliberate.
6. **Trust is visible** — provenance, verification state, cost boundary and limitations are understandable without implementation noise.
7. **No fake affordances** — an unavailable capability must not look enabled.
8. **Motion communicates state** — animation is short, purposeful and reduced when requested.
9. **Local-first continuity** — history, artifacts and settings survive navigation and hydration without surprising resets.
10. **Accessible by construction** — keyboard focus, contrast, semantic labels, reduced motion and readable line lengths are release requirements.

## Layout

- Desktop reading column: 720–860px depending on surface.
- Long-form answer measure: about 720px.
- Header: 62–72px, quiet utility bar.
- Control height: 44–48px.
- Composer: wide, rounded, visually primary but not oversized.
- Mobile horizontal padding: 14–18px.
- Desktop horizontal padding: 18–34px.
- Use spacing before borders to create hierarchy.

## Typography

Use the platform-native stack so Japanese rendering remains fast and high quality.

- UI/body: `system-ui`, `-apple-system`, `BlinkMacSystemFont`, Hiragino/Yu Gothic/Meiryo/Noto Sans JP fallbacks.
- Code: `ui-monospace`, SFMono-Regular, Menlo, Monaco, Consolas.
- Body target: 16px / 1.7–1.75.
- Composer target: 16–17px / 1.65–1.7.
- Headings: strong weight with restrained negative tracking and `text-wrap: balance`.
- Long prose: never force excessive line length.

## Color and surfaces

The existing token system remains authoritative. The flagship layer uses `--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--success`, and `--danger` instead of hard-coded brand colors.

Default light mode should read as warm-neutral paper + clean white surfaces + one controlled accent. Dark mode should be deep, low-glare and never pure-black by default.

## Components

### Header

Identity plus high-value utility actions only. Avoid a row of equally weighted buttons.

### Composer

- Largest interactive surface.
- Strong focus state.
- Clear send action.
- Attachment/research/artifact affordances remain secondary until needed.
- Never hide the text cursor or focus ring.

### Answer

- Conclusion first.
- Evidence and citations next when applicable.
- Limitations and uncertainty are explicit.
- Actions are grouped after the answer, not mixed into it.

### Research

Display source identity, title, URL/domain and freshness where available. Never imply that a snippet was independently verified when it was not.

### Artifacts

Treat generated files as deliverables, not chat decorations. Show type, filename, integrity/validation state and the next useful action (preview, edit, export).

### Settings

Group by outcome: Appearance, Language, Privacy/Safety, Data, Updates. Avoid implementation jargon unless an advanced section is explicitly opened.

## Motion

Default transition range: 160–220ms with a soft ease. Use motion for opening, focus and confirmation; do not animate every piece of content. Respect `prefers-reduced-motion`.

## Accessibility release bar

- Keyboard navigation works for every primary flow.
- `:focus-visible` is always visible.
- Touch targets are >=44px.
- Text is not conveyed by color alone.
- Dialogs trap focus and restore it correctly.
- Reduced-motion mode removes non-essential transitions.
- Error states explain what happened and what the user can do next.

## Quality bar

A screen is not flagship-complete merely because it is visually attractive. It must also be faster to understand, safer to operate, consistent with the design tokens, resilient on narrow mobile screens, honest about system state, and directly useful without requiring the user to learn ORIGIN's internal architecture.
