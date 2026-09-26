# ORIGIN continuation audit — 2026-09-27

## Authority and release boundary

Continue from `ORIGIN_PERSONAL_COMPLETE_HANDOVER_2026-09-27.md`.
Owner delegates implementation, verification and PR preparation; main merge,
production deployment, credentials, permissions and billing remain approval boundaries.
No main/production change was made in this batch.

## Verified baseline

An earlier PR #698 candidate passed ACOS, Production Release CI/CD, CodeQL, OpenSSF,
Node 22/24 build/unit/E2E/Lighthouse and Chromium/Firefox/WebKit Artifact isolation,
and its Vercel Preview was READY. Those checks are baseline only.

Never treat a historical SHA in this document as acceptance of the mutable PR head.
For release decisions, read the current PR head directly from GitHub and require CI and
Preview evidence for that exact SHA.

## Latest app-identity hardening

Before real owner consent, Pollinations' current BYOP/device-flow implementation and SDK
were checked. The previously hardcoded `pk_NgBAArhUeGvSRFba` is Pollinations' shared SDK
default device-flow client ID. Pollinations uses the publishable App Key passed as
`client_id` for application attribution on its authorization surface.

The candidate now requires `ORIGIN_POLLINATIONS_CLIENT_ID` and rejects that shared SDK
default. Missing/shared app identity fails closed before any provider authorization
request, while the configured ORIGIN client ID is sealed into pending state and must
remain unchanged through token exchange.

The existing security/cost controls remain:

- encrypted Secure + HttpOnly + SameSite=Strict cookies;
- server-only credential delivery;
- server-enforced RFC 8628 polling intervals and cumulative `slow_down`;
- audited runtime image-model pin;
- `freeOnly=true`, `paidFallbackEnabled=false`;
- post-generation `$0` usage proof remains fail closed.

## Remaining ordered work

1. Finish exact-head GitHub CI and exact-head Preview build for the current PR head.
2. Configure an ORIGIN-owned Pollinations publishable App Key in Preview as
   `ORIGIN_POLLINATIONS_CLIENT_ID`, without exposing any secret key.
3. Confirm the exact-head Preview reports `deviceAuthReady=true`.
4. Owner performs only the explicit Pollinations consent step.
5. Verify real image generation, exact post-generation `$0` usage evidence,
   Technical Critic, display/download/persistence and disconnect/reconnect.
6. Fresh trusted AQ and held-out coding evidence remain separate release gates.
7. Present complete evidence before main merge or Production publication.

No Production deployment, paid provider, billing change, secret relaxation or main merge occurred.
