# ORIGIN continuation checkpoint — 2026-10-01

## Resume rule
Start by re-reading current main SHA, PR #802, PR #803, PR #804, and canonical Production health. Never assume the SHAs below are still current.

## Release sequence
1. Keep PR #802 Artifact Preview-first frozen at its verified exact head unless new evidence requires a repair. Do not merge merely because it is ready.
2. Continue PR #803 Visual Design System. First restore green CI by aligning regression tests to the canonical Release 2 visual contract.
3. Separate functional responsive/a11y rules from visual styling before removing further legacy rules.
4. Complete typography, buttons, composer, logo, spacing, responsive, dialogs/history/artifact, and visual-accessibility passes.
5. Require exact-head build/unit/E2E/Lighthouse/security/isolation gates.
6. Run Production-equivalent functional audit.
7. Make Release 2 publication decision only after Preview-first + visual baseline + Production-equivalent checks are complete.
8. After Release 2, run whole-product audit and external-standard capability benchmark.

## Verified state
- Current main: `7a0fa6b30d70ef8829de8bfa37faade3a8bbe8d3`.
- Canonical Production `/api/health`: HTTP 200; `releaseSha` = current main; `costUsd=0`; `freeOnly=true`; `paidFallbackEnabled=false`; `secretDelivery=server-only`; `cache-control=no-store`. No Production sync is required.
- PR #802: head `39678dbf105be6c1b472c068284df5dbd15e0d9f`. Open, mergeable, Ready for Review, not merged. OpenSSF, CodeQL, ACOS and Production Release CI/CD are green; Node 22/24 unit+E2E, Lighthouse, Production-browser release gates and three-browser artifact isolation are green. The stale legacy `コードを表示` E2E was replaced with the verified `詳細 -> コードを見る -> 詳細 -> プレビューに戻る` round trip.
- PR #803: branch `uiux/visual-design-system-v1`. Draft. Previous exact head `31fa5d9584d25e919eb39bfe03d3905596a87d48` failed because two unit regression assertions still required visual CSS intentionally removed by this PR. Functional responsive rules are preserved but still co-located with visual rules; separation remains required. `ultra-optics.css` also contains legacy UI 2.0 visual rules that overlap the canonical shell and must be retired carefully rather than deleted wholesale.
- PR #804: head `818fdb0db509c7deb4275b75d7cb5d1f1d9966eb`. Open/draft; OpenSSF, CodeQL, ACOS and Production Release CI/CD are green.
- Main and Production were intentionally not changed by #802/#803 work in this checkpoint.

## Visual north star
Quiet, precise, simple, high-capability. Input/conversation first. Preview-first artifacts. Advanced controls progressively disclosed. No oversized boxes or heavy decorative shadows. Brand color and semantic status colors stay distinct. Japanese readability is independently verified.

## External evaluation framework
Keep engineering completion separate from measured capability. Use comparable task conditions and established families such as SWE-bench/Terminal-Bench for coding, BrowseComp-style research, OSWorld-style computer use, METR time-horizon concepts for long-horizon autonomy, plus ORIGIN production reliability, UX, safety/privacy, speed and zero-cost constraints. Never invent cross-model scores. Unmeasured items remain `NOT MEASURED`.

## Safety / cost invariants
$0, freeOnly, paid fallback disabled, server-only secrets, fail-closed. No paid upgrade, billing change, environment-variable change or security relaxation. Do not repeatedly retry Vercel Hobby rate limits.

## Production sync rule
If current main and canonical releaseSha already match and health/safety/CI are good, change nothing. If mismatch is caused by free-tier deployment limitations, do not pay, repeatedly retry or mutate source. Only use an already-approved free exact-main synchronization path when all conditions are satisfied.

## Next safe work
1. Make #803 regression tests assert the canonical Release 2 visual contract, not deleted legacy strings.
2. Let exact-head CI run naturally; do not spam manual retries.
3. Once green, separate Functional responsive/a11y rules from Visual rules in the CSS layer while preserving current mobile/artifact behavior.
4. Continue visual-system cleanup, especially remaining legacy overlap in `ultra-optics.css`, in bounded commits with exact-head evidence.
