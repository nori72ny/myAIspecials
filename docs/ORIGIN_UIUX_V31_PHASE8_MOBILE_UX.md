# ORIGIN UI/UX v3.1 — Phase 8 Mobile UX

## Goal

Make the Personal UI mobile-first instead of shrinking the desktop layout.

## Base

- Parent Phase 7 exact validated head: `ce19bc3d515acbc42a58c7a0a8bb5b84ab06100a`
- Frozen main remains: `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`
- Do not merge to main while the V1.4 final unseen held-out qualification is pending.

## Implemented mobile principles

1. Chat / Artifact switching remains tab-based rather than permanent split panes.
2. Project navigation uses a compact mobile selector rather than the desktop rail.
3. Model / Tools / Agent are collapsed into one mobile Controls disclosure instead of three desktop cards.
4. Mode remains a separate concept and remains directly reachable.
5. Active Agent work keeps a fixed bottom control with an explicit Stop action.
6. Fixed Agent controls respect `env(safe-area-inset-bottom)`.
7. No fabricated progress percentage, ETA, task, file, source, or completion state is introduced.

## Validation requirements

The exact Phase 8 head must pass:
- Production Release CI/CD
- Node 22 / 24 unit + E2E + build
- Lighthouse
- production browser release gate
- V1.4 hosted coding sandbox
- ACOS 2.0 Quality Gate
- CodeQL
- OpenSSF Scorecard
- Dependency Review
- Artifact isolation Chromium / Firefox / WebKit
- Vercel preview

Focused tests must prove:
- compact mobile Controls preserve Model / Tools / Agent semantics;
- Mode remains separate;
- mobile Agent Stop remains available during active work;
- fixed mobile controls respect device safe area;
- existing Chat / Artifact mobile switching remains intact.

## Release boundary

Phase 8 may be completed and exact-head validated on a stacked branch, but must remain unmerged/unpublished until the final unseen V1.4 qualification is complete.
