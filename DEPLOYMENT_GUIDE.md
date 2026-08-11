# Deployment Guide（準備・検証用）

最終確認日: 2026-08-11

この文書は、ORIGIN Personalのローカルビルドとデプロイ前検証を説明します。この文書の存在は、本番公開、デプロイ承認、クラウド環境、DNS、Secret設定の完了を意味しません。

## 現在の状態

```text
production deployment: NOT VERIFIED
production URL: NOT VERIFIED
deployment ID: NOT VERIFIED
deployed Git SHA: NOT VERIFIED
owner deployment approval: NOT GRANTED FOR THIS DOCUMENT UPDATE
```

GitHub `main`へのマージ承認を、デプロイ承認として扱いません。

## ランタイム

- frontend: React / Vite
- server: Express / Node.js
- build: Vite + esbuild
- package manager: npm
- optional compatibility target: Cloudflare Workers
- AI gateway: OpenRouter
- allowed model class: fixed `:free` model only
- automatic or paid fallback: prohibited

## ローカルビルド

```bash
npm ci
npm run lint
npm test
npm run test:api
npm run build
npm run test:node-production
```

出力:

```text
dist/
dist/server.cjs
dist/server.cjs.map
```

ファイル名・容量はbuildごとに変化し得るため、過去のhash付きartifact名や容量を現在値として固定しません。

## ローカル本番モード

空のテンプレートを作成します。

```bash
cp .env.example .env
```

必要な環境変数:

```env
OPENROUTER_API_KEY=""
FREE_ONLY="true"
APP_URL=""
PORT="3000"
NODE_ENV="production"
ORIGIN_RELEASE_SHA=""
```

実際のAPIキーをREADME、Issue、PR、ログへ貼り付けないでください。

buildと起動:

```bash
npm run build
npm run start
```

health check:

```bash
curl http://localhost:3000/api/health
```

期待する構造:

```json
{
  "status": "ok",
  "service": "acos-2",
  "releaseSha": "unknown"
}
```

`releaseSha`は、次のどちらかに有効な40桁Git SHAが設定された場合だけ値を返します。

```text
VERCEL_GIT_COMMIT_SHA
ORIGIN_RELEASE_SHA
```

未設定または不正形式の場合は`unknown`です。

## Docker検証

```bash
docker build -t origin-personal .
docker run --rm -p 3000:3000 --env-file .env origin-personal
```

現行DockerfileはNode.js 22 Alpineを使用し、production依存関係だけをインストールして非rootユーザーで起動します。

コンテナをbuild・起動できることは、本番環境の性能、可用性、安全性、費用を証明しません。

## Workers互換性dry run

```bash
npm run check:worker
```

このコマンドは`wrangler deploy --dry-run`を使用します。認証情報やデプロイを必要としない互換性検査です。

通常の`wrangler deploy`、Preview URL作成、Publish、Cloudflare設定変更をこのガイドの検証手順へ含めません。

## デプロイ前の必須条件

デプロイ実行前に、少なくとも次が必要です。

- オーナーによる明示的なデプロイ承認
- 承認対象となるExact main SHA
- 全必須CIの成功
- 未解決blocker 0件
- 固定無料モデルの根拠が有効
- 許容費用`$0.00`
- 有料fallback・自動切替なし
- Secretを表示しない注入経路
- rollback手順
- 配信SHAを確認できるhealth endpoint
- 対象環境の利用条件と課金状態の確認

## デプロイ後に必要な証拠

```text
production URL
deployment ID
approved Git SHA
deployed Git SHA
/api/health releaseSha
requested model
served model
actual cost USD
smoke-test timestamp
rollback result or readiness
```

次をすべて確認するまで「公開済み」「日常利用可能」「本番Ready」と記載しません。

- approved Git SHAとdeployed Git SHAが一致
- health endpointのSHAが一致
- 実AI応答が成功
- requested modelとserved modelが一致
- actual costが`$0.00`
- Secretがクライアントやログへ露出していない
- 主要画角、アクセシビリティ、offline、error boundaryが本番で機能

## 対象外

この文書では次を選定・作成・変更しません。

- Google Cloud Run、AWS Fargate、Vercel、Cloudflare等の本番環境
- DNS
- Secret
- 課金
- cloud project
- repository settings
- provider account
- enterprise key
- CPU・メモリ割当

実測なしに必要CPU、必要RAM、peak memory、同時実行性能を断定しません。
