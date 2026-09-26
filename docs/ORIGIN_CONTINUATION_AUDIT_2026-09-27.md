# ORIGIN continuation audit — 2026-09-27

## Authority and release boundary

Continue from `ORIGIN_PERSONAL_COMPLETE_HANDOVER_2026-09-27.md`.
Owner delegates implementation, verification and PR preparation; main merge,
production deployment, credentials, permissions and billing remain approval boundaries.
No main/production/configuration change was made in this batch.

## Baseline verified in this session

- Canonical main: `564a1a144e89f2543b4f0066e2e7a6ada5e68261` (remote Git ref).
- Production `/api/health`: same release SHA, status=ok, freeOnly=true,
  costUsd=0, paidFallbackEnabled=false, secretDelivery=server-only.
- Production raster status: HTTP 503, POLLINATIONS_KEY_NOT_CONFIGURED,
  ready=false. Real image generation is NOT operational in production.
- PR #696 prior head: `7a94af7b43c289dda1654be73ae0f3a4f92ffbea`.
  GitHub confirmed ACOS/production CI failed; CodeQL/OpenSSF passed.
- First repair committed to PR: `38f488c30e2e396d957948f708d07193485ccafe`.
  Its CI was running during the additional protocol review. Do not use that
  earlier commit's checks as acceptance of a later head.

## Changes

1. Explicitly transport encrypted Secure cookies in the HTTP-only Supertest
   harness. Assert Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain.
   Production cookie protection is unchanged.
2. Replace the outdated narrow-model-scope fixture with rejection cases for
   publishable credentials, missing usage permission and excluded audited model.
   Broad/null/omitted model scopes must still select only the audited model.
3. Add denied/expired provider response and tampered-cookie regression cases.
   Tampered state must not cause a provider request.
4. Fix a protocol bug found during review: slow_down must cumulatively add five
   seconds and persist that interval in the encrypted pending cookie without
   extending the authorization expiry. Missing initial interval defaults to five.
   Reference: https://www.rfc-editor.org/rfc/rfc8628.html#section-3.5
   This is interval advice for the forthcoming UI, not a server-side replay-proof
   rate limiter. The UI must honor it and stop on terminal failures.

## Validation and limits

- First repair: 295 test files / 2,506 tests passed locally; lint and build passed.
- Additional protocol fix: three relevant files / 38 tests passed; lint passed.
- Full post-fix local validation: 295 files / 2,507 tests passed; build passed.
  Exact final-head CI must be checked before release. Local test success is not
  evidence of real provider availability.
- Production security middleware applies API no-store, origin/content-type
  validation and rate limiting to the creative routes; reviewed in source.
- Browser visual inspection: NOT VERIFIED. agent-browser could not start; Chrome
  installation failed certificate validation; Playwright download returned an
  invalid/truncated archive. Certificate checks were not disabled.
- UI device-connect controls, real authorization, image generation, USD 0 usage
  verification, display/download and reconnect are still outstanding.
- Answer quality and held-out coding superiority: NOT VERIFIED for this head.
  Existing Q1/AQ documents describe gates and earlier missing evidence. They are
  historical guidance, not proof of the current deployment's measured quality.
- No claim of world-best quality, Claude Code parity or completed image delivery.

## Ordered next work

1. Finish exact-head GitHub CI; repair genuine failures without weakening gates.
2. Review remaining device-flow security and preview configuration. Confirm the
   existing encryption key is available without reading or exposing its value.
3. Implement contextual image-connect UI: start, show user code, explicit provider
   approval link, return/confirm, preserve original request, resume generation.
   Honor polling intervals, stop on denial/expiry/timeout; never expose tokens.
4. Verify the preview in desktop, tablet and 320/390px mobile viewports. Check
   screenshots, accessibility, keyboard/tap targets, no horizontal overflow,
   image display/download, failure messages and disconnect/reconnect.
5. Obtain real zero-cost image execution evidence after provider authorization.
   Do not substitute prompts or mock output for an actual generated image.
6. Locate/re-run authorized trusted AQ and held-out coding evidence for the exact
   candidate. Preserve sealed-corpus rules and zero-cost execution boundaries.
7. Present changes, evidence and unresolved risks to owner before main/production.

The owner should only need to approve a concrete provider authorization or release;
key copying, terminal commands and implementation work remain the agent's job.
