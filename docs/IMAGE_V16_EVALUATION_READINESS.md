# ORIGIN V1.6 image quality — safe evaluation entry gate

**Scope: preflight only.** This document is not a claim of measured image quality
or free Cloudflare account availability, nor approval to enable a Production feature.

## Current verified topology

- Image creation: 24 frozen synthetic tasks through the dedicated manually triggered
  `world-class-image-private-shards-v1.yml` workflow, **12 shards**.
- Image editing: 16 frozen image-reference/instruction tasks through
  `world-class-image-edit-private-shards-v1.yml`, **8 shards**.
- Budget rule: at most **one shard per shared Cloudflare Free account UTC day**
  (minimum **20 distinct UTC account days** assuming every shard succeeds);
  max two cases/shard, plus bounded repair attempts and reserve for semantic critic.
- Both workflows are intentionally **manual and main-only**, require a real exact
  candidate SHA, private sealed corpus ID/digest and account secrets. Do not remove
  these safeguards just to run an untrusted PR with credentials.
- Image and edit shard collection actions verify the real output bytes and GitHub
  provenance. That proof alone does not attest independent visual quality.
- Independent judges must inspect the real 24 generated and 16 edited results,
  compare against frozen baselines blind to source, and record prompt adherence,
  anatomy/geometry, text fidelity, source preservation, safety and usefulness.
- The generation comparison uses `npm run eval:image-blind-quality -- <24-case-evidence.json>`.
  The editing comparison uses `npm run eval:image-edit-blind-quality -- <16-case-evidence.json>`.
  Both commands evaluate submitted, previously collected independent blind-judge
  scores offline and return a failing exit status on a failed quality gate.
  They do **not** generate references, collect judge scores or attest their provenance.

## What this PR can prove without live inference

The `image-v16-evaluation-readiness.yml` workflow and local
`node --test scripts/check-world-class-image-evaluation-readiness-v16.test.mjs`
run a deliberately offline static evaluation. They check that:

- 24/12 generation and 16/8 editing plans, exact SHA and manual main-only
  workflow boundaries are still present;
- Free-plan preflight, cross-task UTC-day account lock and source privacy controls
  remain in the shard definitions;
- Cloudflare 9B, SHA qualification, Production Owner enablement and fail-closed
  safety mode remain in the server router;
- production post-release verification checks **both** SHA qualification and
  explicit Owner enablement;
- both 24-case and 16-case blind benchmark scorers require three fixed
  references and at least two independent source-blind judges per case,
  and the editing evaluator has an executable CLI.

Run `ORIGIN_EVAL_CANDIDATE_SHA=$(git rev-parse HEAD) node scripts/check-world-class-image-evaluation-readiness-v16.mjs`
to write `test-results/image-v16-evaluation-readiness.json`. Its status fields
**always say** `genuineQualityEvaluationExecuted=false`,
`productionQualified=false` and `productionReleaseAuthorized=false`.
Those values must not be turned true by static CI.

## Live quality qualification — still blocked

1. Freeze one exact evaluated candidate with appropriate approval and an isolated,
   secret-protected evaluation workflow at that SHA. Do not merge this Draft PR
   into `main` solely to work around the current evaluator's main-only guard.
2. Verify separately that Cloudflare account credentials, Free plan, daily
   Neurons remaining, the exact 9B model and both sealed corpora are available.
3. Commit the original candidate identity to each immutable sealed corpus/plan;
   do not reuse a held-out corpus after changing the candidate SHA.
4. Run one manual sealed shard per eligible UTC account day; preserve original
   attempt markers and failures in the denominator. The 12+8 shards are not
   complete simply because the workflow files exist.
5. Authenticate the artifacts with generation and edit collectors; verify all
   40 image byte digests, reference preservation and $0 model identity.
6. Conduct two or more independent blinded ratings with fixed references and
   predetermined acceptance thresholds; record any regressions and failures.
7. Require all exact-head CI green, successful independent technical/quality
   evidence and **Owner visual approval**, then separately enable the
   Production server release switch and UI flag. No implicit auto-promotion.

**Do not trigger** a deprecated 24-case same-day workflow; Free 9B budget makes
that unsafe. No Cloudflare token, private prompt or reference image is required
or allowed in the preflight gate.
