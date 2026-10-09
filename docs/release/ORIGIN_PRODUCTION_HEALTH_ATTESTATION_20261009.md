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
