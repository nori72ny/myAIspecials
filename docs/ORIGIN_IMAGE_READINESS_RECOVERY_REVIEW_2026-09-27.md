# ORIGIN continuation audit — 2026-09-27

Source: PR #698 exact head `6eed2e02634a055c0aadeca64ca27f5c974e2ef7`.
This is a local candidate; no remote write, workflow dispatch, merge, deployment,
provider authorization, secret or billing change was performed.

## Implemented correction

An approved image connection whose free-model readiness check failed previously
returned to the start-authorization screen. A regression test failed against the
original implementation, proving the misleading state.

- Retain the approved state when readiness is unavailable.
- Explicitly recheck readiness without creating another device authorization.
- Resume only after ready, zeroCostVerified, freeOnly and no-paid-fallback checks.
- Offer browser-local disconnect while waiting for readiness; only report success
  after the server confirms connected=false. Failure retains the approved state.
- Closing an in-flight readiness check cannot resume the image request.
- Added 320px/1440px mock-provider browser regression coverage.

Scope limit: this is recovery-card connection management, not a persistent global
settings page. Real OAuth, live image generation and paid-usage accounting remain
unverified. Existing image provider/credential policy is unchanged.

## Verification

- Regression reproduced before the fix (1 failed, 4 passed).
- Related Vitest suites: 97 tests passed (App, connection UI, response policy).
- TypeScript/design-token lint: passed.
- Production build: passed before final explanatory-copy/browser-test additions.
- New browser regressions: authored/typechecked, not executed. Playwright browser
  download returned truncated/non-ZIP data; no browser pass is claimed.
- Production desktop UI was directly inspected in the browser: initial composer
  and expanded additional-actions menu render within the observed desktop view.
  This is not mobile acceptance or a preview of this local change.

## CI routing blocker

PR #698 targets `feat/raster-device-auth-v15`. The CI, ACOS, CodeQL and Scorecard
pull_request triggers match only `main`. Its zero workflow runs are explained by
this configuration, not by a queue. Recommended next approval: push this reviewed
candidate to #698 and retarget #698 to main to validate the combined #696/#698
change. Retargeting can trigger CI and preview builds; approval is required.
Do not merge #696 and #698 blindly as separate overlapping candidates.

## Primary GitHub evidence

- #696 head 5091daeb7479257867ead7ae007f640092d61289: CI success, run 36262442127.
- #697 head ab70918a0fb4f9f13f209cf6807cecc714e5e101: CI success, run 36262651692.
- main 564a1a144e89f2543b4f0066e2e7a6ada5e68261: Production CI 36242866320;
  job 108407795966 passed exact production SHA, live upstream stream and multiturn
  context. Log reports streamChunkCount=35, streamSource=upstream,
  contextVerified=true. PWA/history/failure recovery used three mocked chat calls.
- Scheduled held-out run 36256641941: workflow success, but benchmark and aggregate
  jobs skipped. Preflight log: final prerequisites not configured, no provider call.
- Scheduled AQ run 36255503270: actual comparison and aggregate skipped. Log says
  live AQ skipped until 2026-09-26T21:38:40Z. Do not treat timer expiry as execution.
- AQ V2 run 36242866308: skipped.
- Coding production smoke 36230284373 on older SHA e1fdd172...: failed while waiting
  for exact main in production; authenticated coding smoke was skipped. This does
  not establish a coding-model failure or a current-SHA coding pass.

## Remaining gates

1. Approved remote candidate update and main-target exact-head CI.
2. Inspect browser reports/screenshots at 320/390/1440px; verify controls, clipping,
   keyboard/focus, history preservation, image display/download and persistence.
3. Separate owner provider consent; real zero-cost image end-to-end evidence.
4. Fresh trusted held-out/AQ evidence for the final candidate, with independent
   scoring and one-shot corpus isolation; ordinary CI is not quality qualification.
5. Controlled comparative evidence before any world-best or competitor-superiority
   claim. No such claim is established by this audit.
6. Separate owner approval for main merge and production publication, followed by
   exact released-SHA checks and real coding/answer verification.
