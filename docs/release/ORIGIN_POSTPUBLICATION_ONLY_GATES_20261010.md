# ORIGIN: Postpublication-only live integrity checks (2026-10-10)

The release process accepts verified source code to protected GitHub `main`
separately from explicitly promoting a built Production deployment. The live
domain may deliberately serve a PREVIOUS SHA until the Owner-authorized
promotion is complete.

The following three GitHub workflows incorrectly ran on successful
`Production Release CI/CD` `workflow_run` from a main push, and therefore
failed with exact-SHA mismatch against **healthy intentionally held old
Production**:
- `Production Raster Readiness Gate` (run 37985668661)
- `Production Artifact Integrity Gate`
- `Production World-Class Image Safety Gate`

All three are now **manual postpublication only**, preserving their real
production SHA and artifact/image/fail-closed quality checks. Each requires
`workflow_dispatch` explicitly on `refs/heads/main` with a mandatory
`promoted_sha` matching the GitHub main commit selected for dispatch.
An unapproved production promotion cannot be authorized by this workflow:
it remains an independent Owner release decision.

Recommended sequence:
1. Source `main` exact-SHA CI and security scans GREEN.
2. Owner visually reviews the exact candidate and explicitly approves its
   public release, scope, domain targets and rollback.
3. Verify Vercel native Production Git/domain hold and project zero-cost
   settings. Stage a Production-environment exact-SHA candidate via a
   supported **no-alias-assignment** pathway (not a Preview env build).
4. After supported staging checks, promote the exact Production candidate
   with explicit Owner authorization; check every Production alias and SHA.
5. Run the main `Production Release CI/CD` workflow in its
   `postpublish` phase, and then manually dispatch the three separate
   image/artifact readiness workflows with `promoted_sha` set to the
   now-public exact main SHA.
6. If any quality check fails, report the specific capability as blocked and
   run a separately approved rollback. Never enable paid fallback.

This patch does not make raster/image providers ready, nor does it assert
that formerly unqualified model-image capabilities are available. The
existing strict runtime assertions remain unchanged. It only removes the
incorrect prepublication trigger.
