# ORIGIN UI/UX v3.1 — Phase 9 Accessibility

## Goal

Improve keyboard, focus, touch-target, and semantic accessibility without weakening existing safety, runtime, or UI contracts.

## Base

- Parent Phase 8 exact validated head: `7f73e5ec1a3d67eb4e712d282eca7dd48c13a357`
- Frozen main remains: `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`
- Do not merge to main before the V1.4 final unseen held-out qualification completes.

## Scope

- consistent visible focus for summary/select/input/textarea/links;
- 44px minimum interactive targets for coarse-pointer controls;
- explicit touch-target treatment for safe Research source links;
- explicit mobile Project selector target sizing;
- preserve Mode / Project / Model / Tools / Agent semantic separation;
- preserve text labels in addition to visual state;
- preserve prefers-reduced-motion behavior.

## Validation

Exact-head validation must pass Production Release CI/CD, Node 22/24 build/test/E2E/Lighthouse, production browser gates, hosted coding sandbox, ACOS 2.0, CodeQL, OpenSSF, Dependency Review, Artifact isolation Chromium/Firefox/WebKit, and Vercel preview.

Accessibility checks must not claim full WCAG 2.2 AA conformance unless supported by measured evidence.
