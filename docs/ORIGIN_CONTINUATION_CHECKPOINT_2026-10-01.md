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
- PR #803: branch `uiux/visual-design-system-v1`. Draft. Visual work is verified incrementally; use the newest continuation update below rather than this historical paragraph for current SHA/status.
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

## Night continuation update — 2026-10-02
- Re-verified current main remains `7a0fa6b30d70ef8829de8bfa37faade3a8bbe8d3` at this checkpoint.
- PR #802 exact head `39678dbf105be6c1b472c068284df5dbd15e0d9f`: open/ready/clean; OpenSSF, ACOS, CodeQL and Production Release CI/CD green.
- PR #803 prior exact head `6e61500e84281fb69d9b43dba8b840d42167333b`: all four top-level workflows green; Node 22/24 and Chromium/Firefox/WebKit artifact-isolation jobs green. Continued bounded cleanup removed residual legacy composer ownership from ultra-optics.css and repaired the legacy-section comment boundary. New branch head is `2c5376b344876660bb3c773f7484b488b64107ad`; require its natural exact-head CI before further structural cleanup.
- PR #804 exact head `818fdb0db509c7deb4275b75d7cb5d1f1d9966eb`: open/draft/clean; all four top-level workflows green.
- Main/Production were not changed in this continuation step.

## Morning continuation update — 2026-10-02
- Current `main` was re-read from GitHub primary evidence and remains `7a0fa6b30d70ef8829de8bfa37faade3a8bbe8d3`.
- Production was not changed. The latest known canonical Production remains the matching READY `main` release and no synchronization action is warranted.
- PR #802 remains frozen at verified exact head `39678dbf105be6c1b472c068284df5dbd15e0d9f`, Ready for Review and unmerged.
- PR #804 remains the frontier-evaluation workstream; measured-vs-unmeasured truthfulness rules remain unchanged.
- PR #803 completed a bounded quiet-elevation pass for splash/logo/composer/settings/history/workspace surfaces. Exact code head `345cef3d0c2d1176b1d6dcc9b3b7c3a2429c38b1` passed ACOS, CodeQL, OpenSSF, Production Release CI/CD, Node 22/24 build+unit+E2E, Node 22 Production-browser release gate, Node 22/24 Lighthouse, and Chromium/Firefox/WebKit artifact isolation.
- Successful Playwright evidence from that exact head was inspected at 320, 390, 768, 834, 844, 1280 and 1440px viewport captures. The home surface is calm and input-first; the quiet elevation change preserved responsive containment and artifact behavior.
- Visual audit identified one remaining candidate: normal assistant answers still read more like a white card than a continuous reading surface on 390px. A follow-up experiment was started, but a diff-size guard caught an unintended broad `index.css` replacement before acceptance. The experiment and its temporary regression assertion were then fully restored using the exact pre-experiment blobs.
- Repair head `9b8845afdbd7e87d38ad8415d635c94ad05749a5` is three commits ahead of `345cef3d...` but has **zero net file differences** versus that verified all-green head. This preserves the known-good code while documenting the safety recovery.
- Visual design spec now includes an explicit bounded-change guard: unexpectedly broad CSS diffs must be restored to the exact known-good blob and proven zero-net-diff before new work resumes.
- Current branch head after documentation updates is `92791d79c9419987a759c3de8206f284e7d995aa` before this checkpoint commit. Code content remains the verified quiet-elevation implementation; subsequent changes are documentation only.
- No provider, billing, environment-variable, model-routing, authentication/secret, permission, security-boundary, `main`, or Production changes were made.

### Current safe next work
1. Let the documentation-only exact head run naturally; never force-rerun.
2. Revisit the assistant-answer card reduction only with a full-file-safe patch path or a tiny tree/blob patch; enforce a diff-size guard before moving the branch.
3. After that, inspect new 390/360/320 and desktop screenshots, then audit settings/history/dialog and empty/loading/error states.
4. Complete Production-equivalent functional/visual audit before considering #803 Ready for Review or Release 2 integration.


## 2026-10-02 Release 2 visual lane blocker

PR #803 exact head 01b14fd0cb558704b20c306d7b40e361bf490457: ACOS, CodeQL and OpenSSF succeeded. Production Release CI/CD failed only in Node 22 production-browser verification because the saved-session control knowledge-map-session-0 was covered by the fixed header during a pointer click. The intended narrow test fix is to bring that control into view, focus it, and activate it through its keyboard contract before waiting for restored content. A repository write attempt was blocked by the execution safety layer, so no forced workaround was used. Resume by applying that narrow verification-script fix, then validate the new exact head before any merge or production change. main and Production were not changed in this run.
