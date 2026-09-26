# Image connection UI continuation — 2026-09-27

## Dependencies and authority

This branch is based on PR #696 head 5091daeb7479257867ead7ae007f640092d61289.
PR #696 remains unmerged. Its latest ACOS, CodeQL, OpenSSF, Production CI Node
22/24 and all three artifact isolation jobs passed during this session.
PR #697 (independent price arithmetic routing fix) has ACOS/CodeQL/OpenSSF success;
its Production CI must be rechecked. Main and production remain unchanged.

## Implemented

- Show a contextual image connection card only after the image endpoint reports
  POLLINATIONS_KEY_NOT_CONFIGURED.
- Explicit start, public user code, allowlisted Pollinations approval link,
  manual approval check and resumption of the original request.
- Honor the server polling interval; no automatic network retries or polling.
- Require ready + zeroCostVerified + freeOnly + no paid fallback before resuming.
- Preserve clarified prompt and variation parent metadata; avoid duplicate user
  history. New request/reset/cancel closes the card and aborts pending UI requests.
- Credentials stay in server-managed HttpOnly cookies. No token in React state,
  local storage or JavaScript-readable cookie.
- Generic failure/expiry messages, 44px controls, wrapping mobile layout.

## Evidence boundary

- Component/App tests include explicit start, URL rejection, unavailable free
  model, abort-on-cancel, and original-request resumption without duplicate history.
- Targeted tests: 64 passed. Lint and build passed before the final E2E test addition.
- New Playwright tests cover 320px/1440px layout, tap targets, screenshots and the
  connect/resume route using mocked provider responses. They are NOT live OAuth
  or actual image generation evidence. They await execution in CI.
- Full local unit run: 296 files / 2,512 tests passed. Final lint including E2E source passed.
- Local browser installation was previously blocked by certificate/download
  errors; no visual acceptance claim is made without inspecting screenshots.

## Next

1. Verify this branch's exact-head CI and inspect the new screenshots.
2. Confirm preview availability and existing encryption-key readiness without
   exposing the key. No environment changes without owner approval.
3. Complete real provider approval, zero-cost model discovery, generation,
   usage proof, technical critic, display/download, refresh and reconnect checks.
4. Add a user-facing disconnect/manage-connection path; backend disconnect exists
   but this card currently only cancels the pending UI, not an established token.
5. Continue exact-candidate AQ/coding evaluation and desktop/mobile visual review.
6. Present concrete release evidence before owner approval for merge/deployment.

No production update, paid provider, secret change or security relaxation occurred.
