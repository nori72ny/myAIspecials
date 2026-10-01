# ORIGIN Visual Design System V1 — Release 2 Gate

## North star
ORIGIN must feel visually quiet, precise, fast, and trustworthy while keeping advanced capability out of the primary surface until it is needed.

## Non-negotiable visual principles
- Conversation and request input are the visual center of gravity.
- Brand color is never used as a substitute for success, warning, or danger semantics.
- Japanese typography is evaluated independently from Latin typography.
- Primary actions are obvious without oversized boxes, heavy shadows, or excessive accent color.
- All interactive targets remain at least 44x44 CSS px.
- Preview is the primary artifact surface; technical source and diagnostics use progressive disclosure.
- Mobile must preserve hierarchy without horizontal overflow or keyboard/composer collisions.
- Focus-visible, Escape, backdrop close, reduced motion, and contrast remain first-class.

## CSS layer ownership
- `origin-functional-ui.css` owns preserved responsive interaction geometry, viewport containment, artifact-control layout and other behavior-sensitive contracts.
- `origin-top-ui.css` is the canonical Release 2 visual shell and loads the functional layer before visual overrides.
- `index.css` owns canonical base tokens, global typography/focus treatment, and shared semantic primitives.
- `ultra-optics.css` remains a legacy visual layer under audit. Its overlapping component styling must be retired only in bounded, evidence-backed changes.
- Functional rules must not be deleted merely because an older visual treatment is removed.

## Token hierarchy
1. Canvas / surface / elevated surface
2. Primary / secondary / placeholder text
3. Brand / brand soft / brand border
4. Success / warning / danger / focus
5. Border default / strong
6. Control / card / workspace radii
7. Compact / normal / spacious spacing
8. Body / label / section / hero typography
9. Low / medium elevation

## Component audit order
1. Logo and wordmark
2. Global Japanese/Latin font stack
3. Header
4. Home hero and supporting copy
5. Composer, textarea, plus, send, stop
6. Primary / secondary / destructive buttons
7. Conversation and markdown typography
8. Artifact workspace
9. History, settings, add menu and dialogs
10. Empty / loading / error / free-unavailable states
11. Desktop, tablet, 390px, 360px and 320px responsive passes

## Release 2 visual acceptance
- No conflicting component styling that changes hierarchy across breakpoints.
- No primary interactive target below 44px.
- No horizontal overflow at supported mobile widths.
- No brand/status semantic collision.
- No dead or decorative control that appears actionable.
- Composer remains visually primary without dominating the viewport.
- Long Japanese answers remain readable at normal zoom.
- Artifact preview is understandable without learning developer terminology.
- Keyboard-only navigation and visible focus are preserved.
- Lighthouse and existing E2E visual/interaction gates remain green.

## Responsive visual evidence
- A successful CSS build is not visual proof. Inspect representative mobile, tablet and desktop screenshots after bounded visual changes.
- Prefer removing unnecessary elevation, glow and surface boxing over adding decorative hierarchy.
- Normal assistant answers should trend toward a continuous reading surface; errors, user turns, artifacts and actionable status surfaces may remain visually bounded when that distinction improves comprehension.

## Bounded-change guard
- Before accepting a supposedly small CSS edit, inspect per-file diff size.
- If a bounded edit unexpectedly replaces a large section or whole file, do not normalize the broad diff. Restore the exact known-good blob first.
- Prove recovery with a zero-net-file-diff comparison against the last verified head before resuming visual work.
- Do not weaken tests merely to accommodate an unintended broad edit.

## Evidence policy
A visual change is not complete because CSS exists. It requires exact-head CI plus responsive interaction evidence. Production is not changed from this branch.
