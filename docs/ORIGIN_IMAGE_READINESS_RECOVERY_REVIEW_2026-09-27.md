# ORIGIN continuation audit — 2026-09-27

Source: PR #698, continuing from the previously verified device-auth and image-connect candidate.
Owner delegated implementation and verification; main merge and Production deployment remain separate approval boundaries.

## Pollinations app-identity review

Before asking the owner to perform the first real provider consent, the device flow was compared against Pollinations' current BYOP/device-flow implementation and SDK.

The previous branch hardcoded `pk_NgBAArhUeGvSRFba`. Pollinations' own SDK currently uses that exact value as its shared default device-flow client ID. Pollinations documentation describes `client_id` as the publishable App Key used for app attribution on the consent surface. Using the shared SDK identity for ORIGIN would therefore be an ambiguous consent/attribution boundary and is not acceptable for the live owner authorization gate.

The candidate now:

- requires `ORIGIN_POLLINATIONS_CLIENT_ID` for device authorization;
- accepts only a syntactically valid `pk_` publishable App Key;
- explicitly rejects the Pollinations shared SDK default client ID;
- keeps the existing encrypted data key requirement;
- reports `deviceAuthReady=false` and fails closed before any provider request when the ORIGIN-specific client ID is missing or shared;
- seals the configured client ID into pending authorization state and requires it to remain unchanged through token exchange;
- keeps the requested least-privilege account scope at `generate usage`;
- keeps Secure + HttpOnly + SameSite=Strict sealed cookies and server-only token delivery;
- keeps server-enforced RFC 8628 polling intervals and cumulative `slow_down` handling.

Pollinations' current server implementation accepts form-encoded `/api/device/code` requests as used by ORIGIN, and the standard `/api/oauth/token` device-code exchange remains supported. The provider's device code is never returned to browser JavaScript; only the public user code and allowlisted approval URI are exposed.

## Current release boundary

Real provider consent is intentionally not started until an ORIGIN-owned Pollinations App Key is configured in Preview. No Pollinations secret key is required in the browser and no user token should be copied manually.

Still outstanding:

1. Exact-head CI and Preview build for the app-identity hardening.
2. Configure an ORIGIN-owned Pollinations publishable App Key in Preview as `ORIGIN_POLLINATIONS_CLIENT_ID` without exposing a secret key.
3. Confirm `/api/creative/v1.5/raster/connect/status` reports `deviceAuthReady=true` on the exact-head Preview.
4. Owner performs the explicit Pollinations approval step.
5. Complete live image generation, exact post-generation `$0` usage evidence, Technical Critic, display/download/persistence and reconnect checks.
6. Fresh trusted AQ/held-out coding evidence remains independent of ordinary CI.
7. Main merge and Production publication require their own approval after all release evidence is assembled.

No main merge, Production deployment, paid fallback, billing change, or secret relaxation occurred in this batch.
