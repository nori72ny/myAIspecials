# ORIGIN Production Git hold — review candidate, not yet effective

**Status:** Draft PR only. Vercel project is not changed by this branch. Do not claim that the live Production is frozen from automatic Git deployments until deployment-setting readback and an authorized negative-path test prove it.

## Confirmed 2026-10-09

- Source project: `nori72ny/myAIspecials`; protected production main baseline `437f4f0a5c66c0d9add7f65e72369f9787931f7a`.
- Vercel Hobby: `origin-personal`, project ID `prj_WecnnicbGAamToppgV97rHgd8QSB`.
- `origin-personal.vercel.app` currently maps to READY deployment `dpl_EQC4xWGW9hY9SkzkxXuTwxs7uLrP`, commit `437f4f0a5c66c0d9add7f65e72369f9787931f7a`.
- The old `vercel.json` has `git.deploymentEnabled.main: true`, so current production-branch pushes can generate new Production builds and remap a domain automatically.
- Branch protection exposes 10 required check names, but no recorded nonauthor APPROVED reviews of security PR #933 or #939.
- Independent review and specific Owner approval remain mandatory. Do not trigger paid providers or sealed corpus evaluations.

## Reviewed desired state in this PR

- `git.deploymentEnabled.main: false`: disable Git-triggered deploys from main.
- Retain `release-*` preview builds and the existing disabled catchall `**`.
- `github.autoAlias: false`: add another Vercel for GitHub domain-assignment safety boundary.
- Leave API routing, security headers, build pipeline, artifacts, CSP and image flags unchanged.
- Do not add a secret or customer data to the repository.

Official Vercel documentation: https://vercel.com/docs/project-configuration/git-configuration and https://vercel.com/docs/deployments/promoting-a-deployment .

## Authenticated same-SHA production staging evidence (2026-10-09)

A new Vercel deployment `dpl_AV9BVPv2kjDcUJxHu6BoW45PGJJh` was deliberately built from **the same already-approved source** `437f4f0a5c66c0d9add7f65e72369f9787931f7a`, with target `production`, and reached READY. The primary alias `origin-personal.vercel.app` still resolved to prior current READY deployment `dpl_EQC4xWGW9hY9SkzkxXuTwxs7uLrP` after the staged build finished. This is real native staging/alias behavior, **not** a first-new-main-push simulation.

The read-only `scripts/verify-vercel-release-hold.mjs` now accepts optional `ORIGIN_STAGED_PROBE_DEPLOYMENT_ID`. A trusted, credential-protected verifier can set it to the staging deployment ID and check project, target, readiness, identical trusted SHA, distinct deployment identity, and unchanged current alias. It fails closed on missing/moved/incorrect evidence and **always** returns `firstMainPushNegativePathVerified:false`. Do not supply Vercel tokens in public PR logs; run only in a restricted approved environment. Current Vercel connector redacts the effective project auto-assign field, so no authenticated effective-setting assertion has been demonstrated via that connector.

**Still blocking main merge:** third-party exact-head APPROVED review, Owner authorization, independently verified project-level native hold and a safe approach to first NEW main commit. The staging probe strengthens evidence but does not waive any blocker.

## Three-domain alias drift and fail-closed verification

A 2026-10-09 same-SHA `production` staged deployment
`dpl_AV9BVPv2kjDcUJxHu6BoW45PGJJh` left the primary
`origin-personal.vercel.app` alias unchanged, **but did reassign**:
- `origin-personal-nori72nyprivate-6923s-projects.vercel.app`
- `origin-personal-git-main-nori72nyprivate-6923s-projects.vercel.app`

Both moved to the staging deployment even though its code SHA was unchanged.
`GET /v9/projects/{id}/domains` lists only the primary domain, so it is
**not a complete source** for Vercel default production alias inventory.
The read-only release verifier must check the explicit three protected
aliases via `GET /v4/aliases/{name}` and fail if **any** one moved.
Future alias additions require independent release inventory update.
No further `create_deployment(target:"production")` dry runs: the connector
does not provide the safe `--skip-domain` option that Vercel CLI supports.
This change is a safety gate, not proof of a safe first new-main push.

## Mandatory first-merge bootstrap caution

Vercel may have to ingest a new `vercel.json` configuration before it becomes effective. A Git merge of this PR **must not be used as an experiment** to discover whether the first push will auto-promote. First establish and verify a **separate Vercel-side production hold** or another independently tested protection preventing domain assignment. The current API connector does not return existing `commandForIgnoringBuildStep` or effective Production Deployment Checks, so these must be inspected by an authorized release reviewer before changing settings. Do not overwrite unknown existing project configuration.

## Staged release acceptance procedure

1. Obtain nonauthor review and a scoped Owner release exception. Independently confirm GitHub branch protection and effective Vercel project settings.
2. Before any main merge, test **fail-closed** behavior against a harmless, authorized release candidate while keeping Production alias `origin-personal.vercel.app` on `dpl_EQC4xWGW9hY9SkzkxXuTwxs7uLrP`.
3. Bootstrap this configuration only after proving the first merge does not unexpectedly auto-assign domains. Record exact commit and Vercel deployment observations before/after. If uncertain, do **not** merge.
4. For every future release: build the exact approved SHA with Production variables in a protected staging flow, perform secret-safe smoke/UI/E2E, compare immutable deploy SHA, then approve and manually **promote that same production build**. Do not promote a preview build as though identical to a Production build.
5. Post-release: verify main SHA, target alias deployment ID, health, no paid fallback or features enabled without their own qualification, and rollback if a quality or safety regression is confirmed. Never automatically authorize an unknown new SHA.

**Release authorization:** None. This PR does not deploy, update Vercel project settings, change aliases, change secrets, merge other PRs, or waive Owner visual approval. See GitHub issue #942.
