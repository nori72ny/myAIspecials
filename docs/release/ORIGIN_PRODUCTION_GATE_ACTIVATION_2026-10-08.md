# ORIGIN — 機能別公開・公開後自動更新の実強制ゲート

Status: **NOT ACTIVE / DO NOT MERGE** (2026-10-08 JST). This is an activation runbook, not evidence of completed external configuration.

## Verified current state

- Production is Vercel project `origin-personal`, with latest inspected main/deployment SHA `437f4f0a5c66c0d9add7f65e72369f9787931f7a`.
- The GitHub `main` API reported `protected: false`, and `vercel.json` enables automatic Git deployments for `main`.
- Consequently PR CI success **alone** cannot prevent Vercel from assigning the live domain to an unqualified main commit.
- PR #920 contains the PWA unsaved-edit/IndexedDB-save guard; PR #922 contains read-only release predicates and a live GitHub API auditor. Neither is deployed or has the ability to enforce Vercel settings.

## Mandatory infrastructure activation, in this order

1. **GitHub main:** configure enforceable ruleset/branch protection for `main`: block direct pushes and force-push, require approved PR review from a non-author, dismiss stale approvals on new commits, apply rules to administrators and bots without undocumented bypasses, require exact-head status checks for Node 22 and 24, all three artifact isolation browsers, lint/integration/production build, CodeQL, dependency review and ACOS. Verify **actual effective rules** after saving, not merely a ruleset's existence.
2. **Vercel production assignment:** in project Settings → Build and Deployment → Deployment Checks, require the applicable GitHub CI checks before the production deployment gets the live domain. Keep Git auto builds and domain assignment **only if** checks actually hold assignment while pending/red. Do not use Force Promote. Confirm price/plan availability before activation; ORIGIN must not silently introduce a paid feature.
3. **If Deployment Checks are unavailable at zero cost:** do not claim this path is operational. Instead configure a protected `production` GitHub environment with required owner reviewer, GitHub required checks, securely provision Vercel CLI credentials in protected environment only, **stage** a production deployment without assigning domain (`--prod --skip-domain`), test that exact build, and `vercel promote` only after all approvals. Do not disable existing Git auto-production until the replacement has been tested and approved; never expose bypass/production secrets to PR code.
4. **Trusted evidence adapter:** read fresh GitHub PR SHA, branch protection, effective required checks/reviews, Vercel project Deployment Checks, owner approval bound to `featureId + exact SHA + release kind`, independent feature-specific held-out/device tests, real zero-cost evidence and rollback readiness. All missing, unreachable, stale or unknown evidence is BLOCKED. PR body text, user/browser-submitted booleans and skipped jobs never count as verified proof.
5. **Negative-path proof:** red/queued/missing CI, a new head SHA, main moving after approval, stale review, owner UI signoff missing, secret/provider error, unknown cost, staged-build mismatch, blocked GitHub branch protection, Vercel check failure and canceled release must all remain **off the live domain**.
6. **One qualified release at a time:** acquire owner approval on exact candidate, enforce checks before production assignment, record deployment SHA and READY, test health/security, mobile/desktop browser, real artifacts/histories, and PWA update under active Japanese IME, ongoing Direct Touch edits, IndexedDB error and saved-revision acknowledgement. Roll back only the failed feature when possible.

## Read-only GitHub live audit

The repository includes a read-only CLI. It calls GitHub's official endpoints for current PR, main branch, check runs and submitted reviews. It does **not** mutate GitHub, Vercel, production or tokens:

```sh
GITHUB_REPOSITORY=nori72ny/myAIspecials ORIGIN_AUDIT_PR_NUMBER=920 \
  GH_TOKEN="${GITHUB_TOKEN_FROM_PROTECTED_CI_ENV}" \
  npx tsx scripts/audit-progressive-release-github.ts
```

Token must be provisioned directly in trusted CI; do not paste it into a PR or command history. Incomplete API pages, unprotected main, missing required checks, stale SHA reviews or draft PR all return **BLOCKED** (nonzero). Passing this **GitHub-only inspection still does not authorize release**. It deliberately returns `finalProductionAuthorization: false` because Vercel checks, authenticated owner approval, independent quality, measured zero cost and postrelease evidence require separate attestations.

## Production stop rule

Do not merge PR #920 or #922, change secrets/DB/providers, make production public, or enable paid plans solely from passing PR checks or this runbook. Their Draft state is intentional until external settings and release-level evidence are independently verified.
