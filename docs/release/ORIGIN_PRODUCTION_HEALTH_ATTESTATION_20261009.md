# ORIGIN Production health attestation — additive security candidate

This change is intentionally rebased onto the **new protected main** `0240d00827930c49e08b0863265ea98b25f8282f`,
which already merged the security lock patch and manual release gate.
Do **not** merge the earlier divergent PR #943 wholesale: it overlaps
`vercel.json`, the lockfile, manual publication tests and workspace guard.

The attached command is **read-only**, requires no bearer token, and does not
change GitHub branches, Vercel project settings, deployments, aliases or billing:

```text
ORIGIN_EXPECTED_HEALTH_SHA_MAP_JSON='<owner-reviewed JSON map of all three production domains to their previously approved full SHAs>' node scripts/verify-origin-production-health.mjs
```

Store the expectation snapshot in a trusted reviewer environment. Do not
blindly regenerate expectations from live aliases after a rollout, as doing
so hides unauthorized movement. Every production hostname is fixed in
reviewed code, not taken from untrusted CLI input.

The script fails on mismatching HTTP status, release SHA, fee policy,
browser-delivered secrets, malformed JSON and incomplete snapshots.
It deliberately returns `firstMainPushNegativePathVerified:false` and
`productionPromotionAuthorized:false`; the test is not a release gate
bypass or a substitute for owner visual or native Vercel policy proof.

## Observed deployment discrepancy (2026-10-09)

- New main: `0240d00827930c49e08b0863265ea98b25f8282f` (manual publication-gate merge).
- Primary alias: existing deployment `dpl_EQC4xWGW9hY9SkzkxXuTwxs7uLrP`,
  SHA `437f4f0a5c66c0d9add7f65e72369f9787931f7a`.
- Vercel's two default secondary alias **metadata**: deployment
  `dpl_B2RjFGaDhb8JCfHLrGaV8yNR7Xxh`, SHA `0240d00827930c49e08b0863265ea98b25f8282f`.
- Actual HTTP GET /api/health through both **secondary domains**
  still returned the prior SHA `437f4f0a5c66c0d9add7f65e72369f9787931f7a`
  in our check, while the new deployment's **immutable deployment URL**
  returned `0240d00827930c49e08b0863265ea98b25f8282f`. Alias metadata and observed bytes therefore
  disagree and must be independently reconciled before promotion.
- Do not reassign either alias without verified previous deployment and
  explicit scope approval. Do not claim that source-code Git hold
  prevents an initial built-in Vercel domain assignment.

This standalone PR carries only missing read-only runtime validation,
not the overlapping bootstrap configuration or other unfinished features.
Review it as a single isolated candidate. The original release-control
tracking issue is [#942](https://github.com/nori72ny/myAIspecials/issues/942).

## Follow-up audit — 2026-10-10 JST

The authoritative Vercel user-event endpoint was queried read-only for this
project, event type `deployment`, from `2026-10-09T13:00:00Z` through
`2026-10-09T14:40:00Z`. Unlike the normalized deployment listing, its records
identify the application through which the two relevant builds were created:

| Event ID | Deployment ID | Exact source SHA | Event attribution |
| --- | --- | --- | --- |
| `uev_rOPxbiHHSrI1etO4imVaosMC` | `dpl_B2RjFGaDhb8JCfHLrGaV8yNR7Xxh` | `0240d00827930c49e08b0863265ea98b25f8282f` | Production deployment via ChatGPT |
| `uev_FbFlusx7TNnDngdP6ZL1tCiJ` | `dpl_Cy9SjFuE8M5KWHYbXUhDHMtfixXN` | `b8a702287815207166974c580f06f4df76973d41` | Production deployment via ChatGPT |

Both matching records have `via.name=ChatGPT` and `payload.target=production`.
Consequently these builds must not be reported as proof that a Git webhook
ignored `git.deploymentEnabled.main:false`. They are attributed to the app
deployment path; this observation does not establish why the caller chose
Production, the request's domain-assignment options, or durable platform hold.
The earlier secondary-alias movement remains a real incident. Future release
audits must distinguish Git admission controls from explicit API/CLI deployment
and promotion controls. Source Git configuration alone does not attest the latter.

Read-only alias checks at this checkpoint still found the primary domain on
`dpl_EQC4xWGW9hY9SkzkxXuTwxs7uLrP` and both secondary domains on
`dpl_AV9BVPv2kjDcUJxHu6BoW45PGJJh`. The normalized project response still omitted
effective native source/alias admission controls. No new Production deployment,
promotion, alias reassignment, or main merge was performed in this audit.

### Bounded live-health reads

The checker now limits bytes **while consuming** the response stream and cancels
it immediately after exceeding 4096 bytes. Previously `response.text()` consumed
the entire response before applying the limit. It also requests no cached response
and validates the actual JSON media type instead of accepting a substring inside
another content type. Regression tests cover cancellation without end-of-stream,
the exact byte boundary with split UTF-8 characters, and misleading media types.
These are monitoring hardening changes, not an authorization to publish.
