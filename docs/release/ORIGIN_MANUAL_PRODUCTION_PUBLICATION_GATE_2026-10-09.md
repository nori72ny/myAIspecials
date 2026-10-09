# ORIGIN Manual Production Publication Gate (2026-10-09)

**Status:** Proposed only; protected `main` and live Production unchanged. Do not treat this document or green CI as release approval.

## Why a separate manual gate is necessary

Current `vercel.json` on `main` has `git.deploymentEnabled.main=true`. Vercel Git integration can deploy Production automatically on a main push. Meanwhile `DEPLOYMENT.md` and the Owner contract require an independently approved Production action after Git source acceptance. These conditions conflict.

The reviewed fix changes `main` to `false` while preserving `'**': false` and `'release-*': true` in `vercel.json`. The production CI's automatic push hook is also moved to a post-publication manual `workflow_dispatch`. Tests in `scripts/verify-manual-production-hold.test.mjs` reject accidental reversal.

Source: https://vercel.com/docs/project-configuration/git-configuration

## Stage 0 — bootstrap hold, BEFORE merging this gate

Changing the tracked Vercel config **may not prevent the very first merge from triggering a production build**, because the old main had auto-deploy enabled. Do not assume the new config alone creates a safe one-step migration.

1. Preserve immutable evidence of current `main` SHA, current Production deployment ID/SHA, protected canonical domain aliases, and a verified rollback deployment.
2. Determine the effective Vercel production Git trigger and whether this project/Hobby tier can temporarily refuse **Git-triggered Production** while preserving explicit approved REST/CLI deployment capability. If a suitable no-charge policy control cannot be confirmed, **STOP** and use an Owner-approved maintenance/release procedure; never risk unreviewed alias reassignment.
3. Obtain independent nonauthor review on the source and the security-only dependency bootstrap PR #933; record the exact SHA, reviewer, and final Owner authorization. Do not weaken branch protections or publish a bypass token.
4. Change the reviewed Vercel project-level admission control only after explicit authority for that precise setting change. Read the setting back and test a safe negative path before touching `main`.
5. If any stage cannot be proven, remain in HOLD; no main merge or direct Production promotion.

## Stage 1 — acceptance of trusted source

- Merge the reviewed security-only PR #933 first. This phase may itself be coupled to Production by the **current main config**; do not merge until Stage 0 has prevented accidental promotion.
- Merge the exact tested manual publication gate only after dependency, security, release, and change-scope checks are green.
- Verify the merged main SHA and that its `vercel.json` has `main:false` and secure release-preview mapping.
- Protected release previews may continue. PR-only previews are manually deployable from pinned SHA through authenticated Vercel REST.

## Stage 2 — explicit Production publication

1. Obtain separate Owner authorization naming **exact candidate SHA**, intended capability/flag scope and rollback deployment.
2. Build/stage a Production-environment candidate **without assigning public aliases**; validate the exact SHA and unmodified/no-billing provider configuration. If the available Vercel tools cannot safely stage without alias assignment, halt and use the officially supported staged CLI pathway with explicit approval.
3. Run authenticated staging health and smoke checks, browser accessibility/390px/mobile verification, zero-cost/fail-closed provider checks, security and sensitive-data review. Keep the same exact SHA in all attestations.
4. Promote the staged verified deployment to Production via an explicit approved action; never promote a preview built against different environment variables as though it were identical to a Production build.
5. Verify the canonical Production domain's `/api/health` reports the exact merged-main `releaseSha`, response 200, free-only runtime and correct feature flags. Run live provider test(s) if permitted and prove actual provider/model/price in server-owned evidence.
6. Dispatch `Production Release CI/CD` manually on **main** to execute the post-promotion `production-smoke` job. Treat degraded provider availability as a distinct supported failure state, never a paid fallback.
7. If the SHA, identity, execution, interface, or zero-cost boundary fails, rollback to the already verified prior deployment by a separately approved rollback action; record immutable post-rollback proof.

## Non-goals and mandatory blockers

- Do not merge Agent→Coding PR #925 based only on green offline tests. Preview `/api/agent/v3/status` returned `ready:false`; independent provider-backed live coding and held-out evidence are missing.
- Do not claim model world-class superiority without current-SHA comparative evidence.
- Do not deploy or enable image generation, paid models, new DB migrations, unapproved access, new billing, public Vercel share links, or autonomous releases as part of this change.
- Do not claim independent reviewer authorization until a real nonauthor GitHub review exists.
- Do not claim this deployment restriction has already been applied; the current Production setting remains unchanged while this PR is Draft.
