# ORIGIN continuation checkpoint — 2026-10-01

## Resume rule
Start by re-reading current main SHA, PR #802, PR #803, and canonical Production health. Never assume the SHAs below are still current.

## Release sequence
1. Finish PR #802 Artifact Preview-first on its exact head and require all CI green.
2. Resolve/test the code-view -> preview return path if still needed.
3. Mark #802 ready only after exact-head green; do not merge merely because it is ready.
4. Continue PR #803 Visual Design System from current main lineage. Preserve functional responsive/a11y contracts while removing only superseded visual overrides.
5. Complete typography, buttons, composer, logo, spacing, responsive and visual-accessibility passes.
6. Require exact-head build/unit/E2E/Lighthouse/security/isolation gates.
7. Make Release 2 publication decision only after Preview-first + visual baseline + production-equivalent checks are complete.
8. After Release 2, run whole-product audit and external-standard capability benchmark.

## Known state at this checkpoint
- Last verified main before this checkpoint: 7a0fa6b30d70ef8829de8bfa37faade3a8bbe8d3.
- PR #802: uiux/artifact-preview-first-v1. Candidate head previously 40502be5e0fc0da40043afb9e71b9e6075e6eb23. OpenSSF, CodeQL, ACOS and three-browser artifact isolation were green; Node 22/24 unit tests were green and E2E was still running at last observation.
- PR #803: uiux/visual-design-system-v1. Draft. This checkpoint commit is on that branch.
- PR #803 first removed the superseded visual flagship layer, then immediately restored functional add-menu/artifact responsive rules that had been co-located in the old prefix. Do not re-delete those functional rules.
- Main and Production were intentionally not changed by #802/#803 work at this checkpoint.

## Visual north star
Quiet, precise, simple, high-capability. Input/conversation first. Preview-first artifacts. Advanced controls progressively disclosed. No oversized boxes or heavy decorative shadows. Brand color and semantic status colors stay distinct. Japanese readability is independently verified.

## External evaluation framework
Keep engineering completion separate from measured capability. Use comparable task conditions and established families such as SWE-bench/Terminal-Bench for coding, BrowseComp-style research, OSWorld-style computer use, METR time-horizon concepts for long-horizon autonomy, plus ORIGIN production reliability, UX, safety/privacy, speed and zero-cost constraints. Never invent cross-model scores.

## Safety / cost invariants
$0, freeOnly, paid fallback disabled, server-only secrets, fail-closed. No paid upgrade, billing change, environment-variable change or security relaxation. Do not repeatedly retry Vercel Hobby rate limits.

## Production sync rule
If current main and canonical releaseSha already match and health/safety/CI are good, change nothing. If mismatch is caused by free-tier deployment limitations, do not pay, repeatedly retry or mutate source. Only use an already-approved free exact-main synchronization path when all conditions are satisfied.
