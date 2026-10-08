# ORIGIN — 機能別公開・公開後自動更新の実強制ゲート

Status: **NOT ACTIVE / DO NOT MERGE** (2026-10-08 JST). This is an activation runbook, not evidence of completed external configuration.

## Verified current state

- Production is Vercel project `origin-personal`, with latest inspected main/deployment SHA `437f4f0a5c66c0d9add7f65e72369f9787931f7a`.
- Earlier on 2026-10-08, GitHub `main` reported `protected: false`; a subsequent read at ~13:34 JST reported **`protected: true`**, with the same production SHA. The effective rules are **NOT VERIFIED**: `GET /branches/main/protection` returned HTTP 403 `Resource not accessible by integration`, and the available rulesets listing exposed no enforceable details. Do not infer required status checks, non-author review, stale-review dismissal, admin enforcement or direct-push prevention from `protected: true` alone. `vercel.json` still enables automatic Git deployments for `main`.
- Consequently PR CI success **alone** cannot prevent Vercel from assigning the live domain to an unqualified main commit.
- PR #920 contains the PWA unsaved-edit/IndexedDB-save guard; PR #922 contains read-only release predicates and a live GitHub API auditor. The auditor now independently fetches protection details, and **denies approval when the endpoint is missing, 403, incomplete or lacks exact enforced checks and reviews**. Neither is deployed or has the ability to enforce Vercel settings.

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

## Vercel本番エイリアス・チェックの読み取り専用監査

Vercel公式の `GET /v2/projects/{projectIdOrName}/checks` API で
`blocks=deployment-alias` を絞り込み、名前が
`ORIGIN Exact-SHA Release Gate` の信頼済みチェックがただ1件存在することを検査する
`scripts/audit-progressive-release-vercel.ts` を追加した。

* 実行先は信頼済み・保護された環境のみ。PR checkoutやブラウザーで
  `VERCEL_TOKEN` を使わない。
* 予め必要な `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, `VERCEL_TOKEN`
  はCI保護環境から与える。ログにはトークンやAPI生応答を出さない。
* 監査コマンド（保護されたCIからのみ）:
  `node --import tsx scripts/audit-progressive-release-vercel.ts`
* 出力 `configuredBlockingCheckFound` は設定検出に過ぎず、
  `releaseAuthorized` は常に `false`。404/401/403、空応答、違う
  `projectId`、間違ったチェック名、ブロックなし、同名重複は失敗扱い。
* 設定検出の次に必須なのは**本番エイリアスの負経路テスト**。CI失敗や
  レビュー未承認のデプロイが本番URLへ切り替わらないことを、
  本番SHAの実観測で証明する。ログ/PR本文/ヘルスAPIの `costUsd=0`
  だけを根拠に公開を許可しない。
* 本スクリプトはチェック作成やProductionへの書き込みを実行しない。

Vercel参考: https://vercel.com/docs/rest-api/checks-v2/list-all-checks-for-a-project


## 2026-10-09 continuation: duplicate evidence and dependency repair

- Reproduced a configuration-audit false positive: a valid named blocking check plus a same-name nonblocking or incomplete-source check was incorrectly reported as unambiguous. Count all same-name records before configuration validation. Three regression cases now reject these payloads; the valid single-check control still passes and release authorization remains false.
- Exact previous head `fecc9a399d1698b7d0dc98bdaaee9b75b7ffd8cd` failed Production CI run 37838178444 on both Node 22/24 at the all-dependency security audit. The build/unit/E2E steps in those jobs were skipped, not successful. ACOS, CodeQL, OpenSSF and the three artifact-isolation jobs succeeded.
- Failure log identifies development dependency Handlebars 4.7.9 as critical (GHSA-xw65-4hp5-5hc7, GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f). Update only the Handlebars lock entry to upstream 4.7.10, including its published integrity and minimist range. Do not lower the audit threshold or use audit fix --force.
- These edits require fresh exact-head CI; previous results do not qualify the new commit. PR #930 remains at `fa12767533462baa3a0e8cd75804f746acf2774d`, with four successful engineering workflows, but its skipped live AQ workflow does not constitute measured answer quality.
- Remaining release blockers are unchanged: real candidate/baseline model-output evaluation, independent exact-head review and applicable owner approval, effective GitHub/Vercel enforcement and a negative-path proof, and actual zero-cost evidence. No main merge, production alias change, secret changes or paid model execution is authorized by these repairs.
- Local verification: all 18 Vercel-audit unit tests pass; npm ci succeeds; all-dependency audit exits 0 at the unchanged high threshold (0 high/critical, 21 existing moderate findings remain). The pre-fix module reproduced all three duplicate false positives.
