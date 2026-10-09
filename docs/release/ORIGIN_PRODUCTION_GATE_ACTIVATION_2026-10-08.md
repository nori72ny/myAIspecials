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

## 2026-10-09: respect effective review quorum and additional required checks

- Reproduced three failing regression tests against the previous auditor: a two-reviewer rule accepted one approval, and additional enforced checks from either `contexts` or `checks` were ignored when missing.
- The audit now requires the configured count of distinct, non-author, exact-head approvals. Case variants and repeated approvals by one account count once; stale approvals do not satisfy the quorum. Outstanding change requests still block.
- The audit evaluates the union of the built-in minimum and all configured required check names. Additional checks that are missing, pending, skipped or neutral fail closed; only one completed-success record qualifies.
- Local validation: 37 tests pass across both GitHub and Vercel audit suites, including the new regressions and success controls. Targeted TypeScript checking passes. Fresh exact-head CI is still required after commit.
- This is a read-only evidence evaluator, not enforcement activation. Live branch-protection permissions, Vercel alias hold, independent model evaluation and release approvals remain unverified. No production changes.

**設定の重複検査:** Vercel Checks V2 の GET は `blocks` を省略してプロジェクトの全チェックを取得すること。最初から `blocks=deployment-alias` を指定すると、同名だが `blocks=none` のチェックがサーバー側で除外され、重複に気づかず合格する欠陥を招く。監査は**全チェックの取得後**に名前の一意性・ブロック条件・source identityを検証する。

## 承認済みVercelチェックの実行元ID固定

Vercel API が返す「チェック名」と「Webhook/連携元IDが存在する」だけで
公開許可を出すことは禁止。同じチェック名と異なるWebhook IDで偽装が可能なため、
運用者が保護された別経路で事前確認・固定した実行元IDと完全一致を必須とする。

- 保護された信頼済みCI環境に `VERCEL_RELEASE_CHECK_SOURCE_KIND` と
  `VERCEL_RELEASE_CHECK_SOURCE_ID` を設定する。
- `KIND` は `webhook`、`integration`、`git-provider` のいずれか。
  `ID` は承認したVercel側の `webhookId`、`externalResourceId`、
  またはGitHub `externalCheckName` と完全一致させる。
  GitHub外部チェックは `source.provider=github` も必須。
- 設定未投入、予期しない実行元、空値、不正値は
  `TRUSTED_CHECK_SOURCE_NOT_CONFIGURED` /
  `REQUIRED_DEPLOYMENT_ALIAS_CHECK_MISSING` で閉じる。
- この参照値は、プルリクエスト内のJSONやPRコメント、ブラウザー入力を
  そのまま信用せず、保護された独立した設定から読み込む。
  PRで変更可能なコードに高権限 `VERCEL_TOKEN` を渡してはならない。
- これは「設定照合」に限定される。必ず非合格デプロイでの
  **本番エイリアス割当拒否を実測**し、Owner exact-head承認と
  実回答の独立評価が揃うまで本番公開は停止する。

## 回答品質の評価対象SHA一致を必須化

未公開PRの回答品質に関する独立評価と、mainの既存評価を混同しない。
`OriginProgressiveReleasePreflightV1` は
`capabilityQualityQualified === true` だけでは公開を許可しない。
信頼済みサーバー側で検証済みの
`capabilityQualityEvidenceCandidateSha` が現在の
`candidateSha` と完全一致していることも必須とする。
値が空、不正、旧main SHA、別PR SHAの場合は
`QUALITY_EVIDENCE_MISSING` で公開を拒否する。
当該SHAはPR本文・ブラウザー・モデル自己申告から採用してはならない。

現行 `.github/workflows/q1-final-aq.yml` は
`CANDIDATE_SHA=${{ github.sha }}` かつ
`github.ref == 'refs/heads/main'` で動くため、
**main-only 40問比較の合格を未公開PR #930の品質合格として流用しない**。
PR headに実際に紐づいた独立40問評価と秘密48問評価の証拠が
別途必要。現在の通常技術CI成功をモデル回答品質成功と誤認しない。

## Vercelチェック監査APIの受信サイズ上限と削除済み設定

本番公開に関するChecks V2の読み取り専用レスポンスは、取得先が公式APIでも無条件に信頼しない。監査では、生JSONをパースする**前**に宣言されたContent-Lengthと実際の受信バイト数を独立して検証し、256 KiBを超えるレスポンス、異常なContent-Length、JSON不正を`VERCEL_CHECK_READBACK_UNAVAILABLE`として拒否する。トークンやレスポンス生データはログに出さない。

APIが返した同名の公開チェックでも、`deletedAt`が非NULLなら、過去の設定として公開制御証拠に数えない。同名チェックの全件重複検査は維持する。実環境から取得した設定・承認済み実行元ID・不合格時の本番エイリアス保留の3点が揃わない限り公開許可は出さない。これらはソースコードテストだけで実証されたとは言わない。

## GitHub必須チェックの実行アプリID照合

GitHubのbranch protectionが必須チェックにアプリID (`required_status_checks.checks[].app_id`) を指定した場合、チェック名が一致して成功していても十分ではない。
実際の `check-runs[].app.id` が承認済み `app_id` と完全一致することを監査する。異なる実行元、appの欠落、`app_id: -1`（any app）、不正値、同一チェック名で矛盾する複数app指定は、`REQUIRED_CI_NOT_GREEN` とする。
GitHubのbranch protectionの**実データ**取得権限がなければ`BRANCH_RULES_UNVERIFIED`のまま。PRコメントや同名のチェック表示から実行元を推測して解除しない。

## 必須CIすべての実行アプリIDを明示的に固定する

GitHub保護ルールの required_status_checks に名前だけの contexts があり、対応する checks[].app_id が欠落した場合、同名のCI実行結果が成功でも公開可能とはしない。必須のチェックすべてについて、正の安全な整数のアプリIDと実際の check_runs[].app.id の一致を要求する。app_id=-1（any app）、未設定、重複した check 名、矛盾したアプリIDはすべて `BRANCH_RULES_UNVERIFIED` と `REQUIRED_CI_NOT_GREEN` の対象とする。

GitHubの /branches/main 概要レスポンスで取得済みの現行設定には、10件すべてで実行アプリIDが明示されている（CodeQL=57789、その他9件=15368）。これは同名CIの偽装対策を検証する参考情報だが、詳細なレビュー強制・管理者例外・本番Vercel alias-hold を証明するものではなく、単独で公開権限を付与しない。

## 独立48問の使い捨てコーパスを古いmain候補に消費しない

48問の非公開評価は原則一度きりのコーパス予約を伴う。セキュリティ修正 #933・公開制御 #922 の統合前に回答精度 #930 を評価してしまうと、必須main更新後の新SHAで再評価が必要となり、貴重な非公開問題を消費する。

信頼済みmain上の `trusted-answer-quality-v2.yml` は、秘密情報や非公開コーパスにアクセスする**前**と、評価実行・予約の**直前**の2地点で `assert-trusted-answer-candidate-topology-v2.ts` を実行する。GitHubの実際の現在main HEADを `github.sha` に照合し、`compare/mainSha...candidateSha?per_page=1` の base / merge_base と behind_by を検証する。PR候補は最新mainの子孫（ahead、behind=0）以外を拒否する。mainと同一SHAで測定する特別な PR_NUMBER=0 パスだけ identical を受理する。

手順：安全な独立レビューとOwner exact-SHA承認→依存する #933 と #922 を適切な順序でmainに統合→#930を最新mainへ更新→exact-head全CI/実機レビュー→48問予約・実モデル評価。評価の前にlatest mainが動けば拒否し、保護された評価器を再起動して新SHAを再確定する。実際にmainが古い候補より先に進んだ場合の拒否はテストされているが、現在このワークフローをまだmainへ反映していないため、実運用への適用は未完了である。
