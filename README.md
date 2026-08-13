# ORIGIN（ACOS 2.0）

ORIGINは、ユーザーの依頼を安全に処理し、検証状態・制約・費用を明確に示すことを目指すAIオーケストレーション製品です。

このREADMEは、GitHubの`main`に存在する現行実装だけを説明します。将来構想や未検証の性能を、実装済み・公開済みの機能として扱いません。

## 現在の状態

- 対象: ORIGIN Personalの開発候補
- フロントエンド: React 19 / Vite 6 / Tailwind CSS 4
- サーバー: Express 5 / Node.js
- パッケージ管理: npm（`package-lock.json`を正本として使用）
- AIゲートウェイ: OpenRouter
- 費用ポリシー: `$0.00`限定
- 自動モデル選択・有料フォールバック: 禁止
- 公開状態: このリポジトリだけでは、本番公開・稼働中であることを証明しません

## 実装済みの主要境界

現行のPersonalランタイムでは、`POST /api/chat`だけを権威あるチャット実行経路として扱います。

- サーバー側で`FREE_ONLY=true`を前提に無料限定を強制
- 固定された単一の無料モデルだけを許可
- OpenRouterの自動ルーティングを不使用
- 要求モデルと実際に提供されたモデルが一致しない場合は安全停止
- 無料モデルの価格根拠が期限切れの場合は`FREE_MODEL_EVIDENCE_STALE`で安全停止
- 旧プロバイダー経路と未承認API経路を遮断
- JSON以外のAPI応答や不正なJSONを安全側で拒否
- APIキーをクライアントへ埋め込まず、サーバー環境変数からのみ取得

## 固定無料モデル

現在の固定モデルIDは次のとおりです。

```text
google/gemma-4-26b-a4b-it:free
```

モデルの無料根拠は、OpenRouter公式モデルAPIで確認した記録に基づきます。

```text
verifiedAt: 2026-08-12T00:00:00.000Z
reviewAfter: 2026-08-19T23:59:59.999Z
```

`reviewAfter`を過ぎた場合、再検証されるまで外部AI実行を停止します。別モデルへの自動切替や有料モデルへの切替は行いません。

> `:free`という名前だけでは無料を保証しません。実行前の価格根拠、要求モデルと提供モデルの一致、および実行後の実費確認をすべて必要とします。

## セットアップ

### 必要環境

- Node.js 22以上
- npm
- 外部AIを実行する場合のみOpenRouter APIキー

### 依存関係のインストール

```bash
npm ci
```

### 環境変数

サンプルをコピーします。

```bash
cp .env.example .env
```

`.env`には次の形式で設定します。実際のキーをREADME、Issue、PR、ログへ貼り付けないでください。

```env
OPENROUTER_API_KEY=""
FREE_ONLY="true"
APP_URL=""
PORT="3000"
NODE_ENV="development"
```

APIキーがない状態でも、ビルドと自動テストは実行できます。外部AIへの実リクエストは行われません。

### 開発サーバー

```bash
npm run dev
```

既定のローカルURL:

```text
http://localhost:3000
```

## 検証コマンド

### 型検査・設計トークン検査

```bash
npm run lint
```

### ユニットテスト

```bash
npm test
```

### APIテスト

```bash
npm run test:api
```

### E2Eテスト

Playwrightのブラウザー環境が必要です。

```bash
npm run test:e2e
```

### 本番ビルド

```bash
npm run build
```

### Node.js本番ランタイムのスモークテスト

```bash
npm run test:node-production
```

### Cloudflare Workers互換性のdry run

次のコマンドはローカル互換性検査用です。デプロイは行いません。

```bash
npm run check:worker
```

## 実行方法

### Node.js

```bash
npm run build
npm run start
```

### Docker

```bash
docker build -t origin-personal .
docker run --rm -p 3000:3000 --env-file .env origin-personal
```

DockerイメージはNode.js 22 Alpineを使用し、production依存関係だけで非rootユーザーとして起動します。

## ヘルスチェック

```bash
curl http://localhost:3000/api/health
```

応答例:

```json
{
  "status": "ok",
  "service": "acos-2",
  "releaseSha": "unknown"
}
```

`releaseSha`は、`VERCEL_GIT_COMMIT_SHA`または`ORIGIN_RELEASE_SHA`に40桁のGit SHAが設定された場合だけ表示されます。未設定・不正形式の場合は`unknown`です。

## リポジトリの主な構成

```text
.
├── src/                 # React UI、サーバー境界、オーケストレーション
├── packages/domain/     # 共有ドメインモデル
├── tests/api/           # API結合テスト
├── tests/e2e/           # Playwright E2E
├── scripts/             # 品質検査・ランタイム検証
├── docs/                # 設計・監査・運用文書
├── server.ts            # Express / Viteエントリーポイント
├── worker.ts            # Cloudflare Workers互換エントリーポイント
├── Dockerfile           # Node.js本番イメージ
└── wrangler.jsonc       # Workers互換性設定
```

## 検証済み事実と限界

PR #69のExact Head SHA `68cd1479b4cff1fc771a0d2231da516cc10f80e2`では、次を確認しました。

- GitHub Actionsの5ワークフローが成功
- Vitest: 817件成功
- APIテスト: 5件成功、既存の1件をskip
- Playwright E2E: 27件成功
- lint、build、Node.js本番ランタイムスモークが成功
- `npm audit`およびproduction-only監査で脆弱性0件

これらは当該SHAでの検証結果です。次を証明するものではありません。

- 本番環境への公開または現在の稼働
- 物理端末での動作
- 実運用時の回答精度、性能、可用性
- すべてのアクセシビリティ要件
- 他製品より優れていること
- 将来もモデルが無料で提供され続けること

## セキュリティと費用の原則

- 秘密情報をGitへcommitしない
- APIキーをIssue、PR、スクリーンショット、ログへ表示しない
- 有料モデル、有料フォールバック、自動プロバイダー切替を追加しない
- `main`へのマージとデプロイを別々の承認として扱う
- Preview、Publish、DNS、課金、クラウド、Secret、リポジトリ設定の変更をコード変更の承認に含めない
- 検証できない状態では推測せず、安全停止する

## 関連文書

- [Release Notes](./RELEASE_NOTES.md)
- [Changelog](./CHANGELOG.md)
- [Roadmap](./ROADMAP.md)
- [License](./LICENSE)

関連文書には将来構想や過去時点の記録が含まれる場合があります。現在の実装状態は、必ず`main`のコードと直近の検証証跡を基準に判断してください。
