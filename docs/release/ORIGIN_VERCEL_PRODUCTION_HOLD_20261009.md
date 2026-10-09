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

## Mandatory first-merge bootstrap caution

Vercel may have to ingest a new `vercel.json` configuration before it becomes effective. A Git merge of this PR **must not be used as an experiment** to discover whether the first push will auto-promote. First establish and verify a **separate Vercel-side production hold** or another independently tested protection preventing domain assignment. The current API connector does not return existing `commandForIgnoringBuildStep` or effective Production Deployment Checks, so these must be inspected by an authorized release reviewer before changing settings. Do not overwrite unknown existing project configuration.

## Staged release acceptance procedure

1. Obtain nonauthor review and a scoped Owner release exception. Independently confirm GitHub branch protection and effective Vercel project settings.
2. Before any main merge, test **fail-closed** behavior against a harmless, authorized release candidate while keeping Production alias `origin-personal.vercel.app` on `dpl_EQC4xWGW9hY9SkzkxXuTwxs7uLrP`.
3. Bootstrap this configuration only after proving the first merge does not unexpectedly auto-assign domains. Record exact commit and Vercel deployment observations before/after. If uncertain, do **not** merge.
4. For every future release: build the exact approved SHA with Production variables in a protected staging flow, perform secret-safe smoke/UI/E2E, compare immutable deploy SHA, then approve and manually **promote that same production build**. Do not promote a preview build as though identical to a Production build.
5. Post-release: verify main SHA, target alias deployment ID, health, no paid fallback or features enabled without their own qualification, and rollback if a quality or safety regression is confirmed. Never automatically authorize an unknown new SHA.

**Release authorization:** None. This PR does not deploy, update Vercel project settings, change aliases, change secrets, merge other PRs, or waive Owner visual approval. See GitHub issue #942.
