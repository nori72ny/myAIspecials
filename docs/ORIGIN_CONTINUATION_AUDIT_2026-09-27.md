# ORIGIN continuation audit — 2026-09-27

## Authority and release boundary

Continue from `ORIGIN_PERSONAL_COMPLETE_HANDOVER_2026-09-27.md`.
Owner delegates implementation, verification and PR preparation; main merge,
production deployment, credentials, permissions and billing remain approval boundaries.
No main/production change was made in this batch.

## Baseline verified before the latest hardening

- Canonical main remains `564a1a144e89f2543b4f0066e2e7a6ada5e68261`.
- Production remains on that main release and keeps the existing fail-closed image path.
- PR #698 earlier exact head `e6af9653929ef69e729057ddc8266e3ab4a6a120` passed ACOS, Production Release CI/CD, CodeQL, OpenSSF, Node 22/24 build/unit/E2E/Lighthouse and Chromium/Firefox/WebKit Artifact isolation. Its Preview was READY.
- Those earlier checks are baseline only and are not acceptance evidence for the newer exact head.

## Latest app-identity hardening

Before real owner consent, Pollinations' current BYOP/device-flow implementation and SDK were checked. The previously hardcoded `pk_NgBAArhUeGvSRFba` is Pollinations' shared SDK default device-flow client ID. Pollinations uses the publishable App Key passed as `client_id` for application attribution on its authorization surface.

The candidate now requires `ORIGIN_POLLINATIONS_CLIENT_ID` and rejects that shared SDK default. Missing/shared app identity fails closed before any provider authorization request, while the configured ORIGIN client ID is sealed into pending state and must remain unchanged through token exchange.

The existing security/cost controls remain:

- encrypted Secure + HttpOnly + SameSite=Strict cookies;
- server-only credential delivery;
- server-enforced RFC 8628 polling intervals and cumulative `slow_down`;
- audited runtime image-model pin;
- `freeOnly=true`, `paidFallbackEnabled=false`;
- post-generation `$0` usage proof remains fail closed.

## Current exact candidate

Current PR #698 exact head after documentation synchronization: `3136c2a49f6644622907e9f0c61f94d8535b35d0`.

New exact-head CI and Preview validation must finish before this candidate is considered technically ready. Do not reuse the earlier green checks as acceptance for this SHA.

## Remaining ordered work

1. Finish exact-head GitHub CI and exact-head Preview build for `3136c2a49f6644622907e9f0c61f94d8535b35d0`.
2. Configure an ORIGIN-owned Pollinations publishable App Key in Preview as `ORIGIN_POLLINATIONS_CLIENT_ID`, without exposing any secret key.
3. Confirm the exact-head Preview reports `deviceAuthReady=true`.
4. Owner performs only the explicit Pollinations consent step.
5. Verify real image generation, exact post-generation `$0` usage evidence, Technical Critic, display/download/persistence and disconnect/reconnect.
6. Fresh trusted AQ and held-out coding evidence remain separate release gates.
7. Present complete evidence before main merge or Production publication.

No Production deployment, paid provider, billing change, secret relaxation or main merge occurred.
