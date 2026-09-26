# ORIGIN continuation audit — 2026-09-27

## Authority

PR #698 is the combined candidate for device-authorized image generation and the contextual connection UI. Owner delegates implementation and verification. Main merge, Production deployment, provider consent, credentials and billing remain explicit approval boundaries.

## App-identity review

Before the first real provider consent, Pollinations' current BYOP/device-flow implementation and SDK were compared with ORIGIN's device authorization code.

The previous hardcoded client ID, `pk_NgBAArhUeGvSRFba`, is Pollinations' shared SDK default device-flow client ID. Pollinations documents the publishable App Key passed as `client_id` as the application identity used for authorization attribution. ORIGIN should not request owner consent under that shared provider identity.

The candidate now:

- requires `ORIGIN_POLLINATIONS_CLIENT_ID`;
- accepts only a syntactically valid `pk_` publishable App Key;
- rejects the Pollinations shared SDK default;
- keeps the encrypted data-key requirement;
- reports `deviceAuthReady=false` and fails closed before any provider call when the ORIGIN-specific identity is missing or shared;
- seals the configured client ID into pending authorization state and requires it to stay unchanged through token exchange;
- requests only `generate usage`;
- keeps Secure + HttpOnly + SameSite=Strict cookies and server-only token delivery;
- keeps server-enforced RFC 8628 polling intervals and cumulative `slow_down` handling.

Pollinations' current server accepts the form-encoded `/api/device/code` request used by ORIGIN, and its standard `/api/oauth/token` device-code exchange remains supported.

## Evidence boundary

Earlier exact-head CI/Preview evidence remains historical baseline only. The current PR head must always be read directly from GitHub and validated independently. Documentation intentionally does not pin a mutable candidate SHA as a permanent acceptance claim.

Real provider consent must not start until an ORIGIN-owned Pollinations App Key is configured in Preview. No Pollinations secret key should be copied into the browser or pasted manually.

## Remaining gates

1. Exact-head CI and exact-head Preview build.
2. Configure the ORIGIN-owned publishable App Key in Preview as `ORIGIN_POLLINATIONS_CLIENT_ID`.
3. Confirm `deviceAuthReady=true` on the exact-head Preview.
4. Owner performs the explicit Pollinations approval step.
5. Real image generation, exact post-generation `$0` usage evidence, Technical Critic, display/download/persistence and disconnect/reconnect.
6. Fresh trusted AQ/held-out coding evidence, independent of ordinary CI.
7. Separate owner approval for main merge and Production publication.

No main merge, Production deployment, paid fallback, billing change or secret relaxation occurred.
