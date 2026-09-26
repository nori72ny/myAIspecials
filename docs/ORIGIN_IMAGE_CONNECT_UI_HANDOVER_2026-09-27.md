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

This prevents the first real ORIGIN authorization from being performed under an ambiguous/shared provider identity.

## Current evidence boundary

The earlier exact head `e6af9653929ef69e729057ddc8266e3ab4a6a120` passed ACOS, Production Release CI/CD, CodeQL, OpenSSF, Node 22/24 build/unit/E2E/Lighthouse and three-browser Artifact isolation, and its Vercel Preview was READY.

The app-identity hardening creates a new exact head. Prior green checks are historical baseline only and must not be reused as acceptance of the new head. New exact-head CI and Preview validation are required.

## Next gate

1. Finish exact-head CI and Preview build for the app-identity hardening.
2. Configure an ORIGIN-owned Pollinations publishable App Key in Preview as `ORIGIN_POLLINATIONS_CLIENT_ID` without exposing a secret key.
3. Confirm the exact-head Preview reports `deviceAuthReady=true`.
4. Owner performs only the explicit Pollinations approval step.
5. Verify real image generation, exact post-generation `$0` usage evidence, Technical Critic, display/download/persistence and disconnect/reconnect.
6. Fresh trusted AQ/held-out coding evidence remains separate from ordinary CI.
7. Present release evidence before any main merge or Production publication.

No Production update, paid fallback, billing change or secret relaxation occurred.
