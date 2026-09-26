# Image connection UI continuation — 2026-09-27

## Dependencies and authority

PR #698 is the combined image-provider candidate and includes the unmerged backend from #696. Do not merge the overlapping PRs independently. Owner delegates implementation and verification; main merge and Production publication remain separate approval boundaries.

## Implemented

- Contextual image connection card after `POLLINATIONS_KEY_NOT_CONFIGURED`.
- Explicit start, public user code, allowlisted Pollinations approval link, manual approval check and original-request resumption.
- Server-enforced device polling interval, `Retry-After`, cumulative RFC 8628 `slow_down`, denial/expiry handling and encrypted pending state.
- Secure + HttpOnly + SameSite=Strict sealed cookies; provider token never enters React state, local storage, response JSON or a JavaScript-readable cookie.
- Free-model readiness requires ready + zeroCostVerified + freeOnly + no paid fallback before resuming generation.
- Browser-local disconnect/recovery and no duplicate user history on resume.
- 320px / 390px / 1440px mocked-provider browser coverage and prior visual inspection.

## ORIGIN app identity hardening

Before real owner consent, the device-flow `client_id` was compared with Pollinations' current SDK and BYOP documentation. The previously hardcoded `pk_NgBAArhUeGvSRFba` is Pollinations' shared SDK default device-flow client ID, while Pollinations uses a publishable App Key as `client_id` for application attribution on the authorization surface.

PR #698 now requires an ORIGIN-specific publishable App Key through `ORIGIN_POLLINATIONS_CLIENT_ID` and rejects the shared SDK default. Missing or shared identity reports `deviceAuthReady=false` and fails closed before contacting the provider. The configured client ID is sealed into the pending session and must remain unchanged through token exchange.

## Evidence boundary

Earlier green CI/Preview evidence is historical baseline only. The current PR head from GitHub is the source of truth. Every release decision must bind CI, Preview and live-provider evidence to that exact SHA; this handover intentionally avoids embedding a mutable candidate SHA.

## Next gate

1. Finish exact-head CI and Preview build for the current PR head.
2. Configure an ORIGIN-owned Pollinations publishable App Key in Preview as `ORIGIN_POLLINATIONS_CLIENT_ID` without exposing a secret key.
3. Confirm the exact-head Preview reports `deviceAuthReady=true`.
4. Owner performs only the explicit Pollinations approval step.
5. Verify real image generation, exact post-generation `$0` usage evidence, Technical Critic, display/download/persistence and disconnect/reconnect.
6. Fresh trusted AQ/held-out coding evidence remains separate from ordinary CI.
7. Present release evidence before any main merge or Production publication.

No Production update, paid fallback, billing change or secret relaxation occurred.
