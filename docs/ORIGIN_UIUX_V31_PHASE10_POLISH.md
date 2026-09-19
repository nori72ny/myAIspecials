# ORIGIN UI/UX v3.1 — Phase 10 Polish

## Goal

Finish the validated UI/UX v3.1 stack with restrained visual and readability improvements without changing model behavior, answer-generation logic, safety boundaries, or execution authority.

## Base

- Parent Phase 9 exact validated head: `3fcd560b8baae7984a887ee8fde86ac31d3b3698`
- Frozen main remains: `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`
- Do not merge to main before the V1.4 final unseen held-out qualification completes.

## Scope

- readable answer width;
- balanced headings and natural paragraph wrapping;
- improved horizontal table containment;
- restrained card state transitions;
- preserve `prefers-reduced-motion`;
- no new animations that obscure state;
- no answer-quality or model-routing changes in this phase.

## Validation

Exact-head validation must pass the same release, E2E, Lighthouse, security, hosted coding, dependency, artifact isolation, and Vercel gates used in Phases 7–9.
