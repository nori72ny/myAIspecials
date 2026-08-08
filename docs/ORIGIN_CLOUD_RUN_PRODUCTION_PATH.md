# ORIGIN Cloud Run production path

Status: conditional candidate — account eligibility and deployment are not authorized

Owner: ノリさん

Source of truth: `https://github.com/nori72ny/myAIspecials`

## Decision

ORIGINの第2公開について、GitHub `main` のimmutable commitを起点にしたCloud Runコンテナを正式候補として準備する。AI Studioは開発・監査に利用できるが、AI Studio内の編集状態やGemini direct runtimeを本番ソースとして扱わない。

GitHubからAI Studioへコードを取り込む場合も、AI Studioから`main`へ直接Exportしない。コード変更は必ず作業ブランチとDraft PRを経由する。

## Feasibility boundary

AI Studio Starter TierのPublish App経路は、課金アカウント不要で利用できる場合がある一方、GitHub `COMMIT_SHA`、Docker build argument、Cloud Build substitution、Artifact Registry、Secret Managerを制御できることが公式仕様から確認できない。このため、AI Studioのワンクリック公開はExact SHA要件を満たす本番経路として現時点では`NOT ELIGIBLE`とする。

本リポジトリの`cloudbuild.production.yaml`は、GitHub source metadataを受け取れる標準Cloud Build→Cloud Run候補である。これはAI Studio Starter Tierと同じ無料経路であるとは証明されていない。既存の対象アカウントで、課金設定追加なしに必要なCloud Build、Artifact Registry、Secret Manager、Cloud Runを利用できることがEXECUTED証拠で確認できるまで`CANDIDATE / BLOCKED`とする。

## Immutable release identity

`cloudbuild.production.yaml` は、別途承認された手動実行のGitHub連携buildが提供する次の値をデプロイ前に検証する。

- `REPO_NAME` が `myAIspecials`
- `REPO_FULL_NAME` が `nori72ny/myAIspecials`
- `BRANCH_NAME` が `main`
- `COMMIT_SHA` が小文字40文字の16進Git SHA
- 実行時だけ渡す`_APPROVED_RELEASE_SHA`が同じ`COMMIT_SHA`と完全一致

検証を通過した同じ`COMMIT_SHA`を、次の3箇所へ機械的に使用する。

1. commit-specific container image tag（配布時はArtifact Registryから取得したdigestへ固定）
2. Docker build argument `ORIGIN_RELEASE_SHA`
3. Cloud Run runtime environment `ORIGIN_RELEASE_SHA`

`Dockerfile`はbuild時にSHAを検証し、Cloud Run用startup scriptはruntimeでも再検証する。空値、`unknown`、branch名、短縮SHA、大文字、不正文字、前後空白の場合はbuildまたは起動を失敗させる。人がSHAを手入力して維持する運用は禁止する。

## Secret boundary

本番AI実行に必要な秘密情報は`OPENROUTER_API_KEY`だけである。

- 値はGitHub、AI Studio、Cloud Build config、Docker build argument、container image、ログ、PRへ記録しない
- Cloud RunにはSecret Manager referenceとしてruntimeでbindする
- `GEMINI_API_KEY`、`GOOGLE_API_KEY`、`GOOGLE_GENERATIVE_AI_API_KEY`を本番要件へ追加しない
- Gemini providerやGemini modelを本番routeへ接続しない
- `.dockerignore`と`.gcloudignore`で`.env*`、`.git`、生成物を送信対象から除外する

## Free-only runtime

- Model: `inclusionai/ling-3.0-flash:free`
- `FREE_ONLY=true`
- 実費上限: `$0.00`
- provider fallback: disabled
- 自動モデル切替: disabled
- 無料証拠期限切れ、routing不一致、cost不明、provider不通時: fail-closed

Cloud Run側は`min-instances=0`、`max-instances=1`に固定する。ただし、無料枠は無条件の費用保証ではない。デプロイ前に、対象Googleアカウントで必要な標準Cloud Run経路が利用可能であり、支払方法・billing account・有料trialの追加を要求されないことを画面上で確認する。課金設定を要求された場合は停止する。

このリポジトリのdeployment configは、billing accountの作成・link、APIの有料化、予算超過時の課金継続を行わない。

`max-instances=1`と`min-instances=0`は使用量を抑える境界であり、費用`$0.00`の単独証拠ではない。実際のStarter Tier状態を確認できない限りデプロイしない。また、公開後の実測前にVercelと同等以上の遅延・可用性を主張しない。

## Required trigger configuration

以下は値をコードへ保存せず、既存の対象プロジェクトで設定済みであることだけを確認する。

- `_REGION`: AI Studio Starter Tierで既に割り当てられたregion
- `_AR_REPOSITORY`: 既存のArtifact Registry repository
- `_OPENROUTER_SECRET`: 既存Secret Manager secretの名前
- `_OPENROUTER_SECRET_VERSION`: 公開時に固定する既存secretの数値version
- `_RUNTIME_SERVICE_ACCOUNT`: 既存の最小権限Cloud Run実行service account
- `_EXPECTED_BUILD_SERVICE_ACCOUNT`: 既存の最小権限Cloud Build service account。実際の`SERVICE_ACCOUNT_EMAIL`と完全一致させる
- `_APPROVED_RELEASE_SHA`: 公開ごとに別承認されたExact SHA。triggerへ保存しない

いずれかが空ならpreflightで停止する。新しいbilling account、支払方法、DNS、repository settingを作る権限は、この実装PRに含まれない。

Secret Managerは`:latest`を使わず、別途確認した数値versionへ固定する。認証情報のrotation時は新しいversionを対象に再監査・再承認する。container imageはpush後にArtifact Registryからdigestを取得し、Cloud Runには`image@sha256:...`で渡す。`ORIGIN_RELEASE_SHA`はそのimageを作ったimmutable Git SHAへ固定する。

## Deployment approval boundary

この文書と設定ファイルはデプロイを実行しない。Cloud Build triggerの作成・有効化も本PRの承認範囲外であり、pushによる自動デプロイを設定してはならない。`_APPROVED_RELEASE_SHA`はtrigger設定へ保存せず、別承認された手動実行時だけ渡す。本番デプロイには、mainへマージされた新しいExact SHAを対象にした別の明示承認が必要である。

承認後も、実行直前に次を再確認する。

1. GitHub main Exact SHA
2. main CIにfailure/pendingがない
3. 固定freeモデルの公式証拠が期限内
4. 必要な標準Cloud Run経路が課金設定追加なしで利用できる
5. Secretは名前だけ確認し、値を表示しない

## Post-deployment verification

公開完了と判断する前に、次を確認する。

- `GET /api/health`がHTTP 200
- `releaseSha`がデプロイ対象main SHAと完全一致
- 設定画面のリリースIDも完全一致
- `/api/chat`を秘密情報を含まない日本語入力1件でsmoke test
- served modelが固定`:free`モデルと一致
- 実費`$0.00`
- fallback未使用
- 7画角で横スクロール、文字切れ、主要操作不能がない
- 不一致、`unknown`、課金要求、無料証拠失効、P0/P1があれば公開成功と扱わない
