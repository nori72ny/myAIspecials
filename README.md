# ORIGIN - Mission Intelligence Operating System

> 世界最高品質のAIネイティブOS「ORIGIN」の開発基盤（Foundation）へようこそ。
> 本リポジトリは、将来的に100種類以上のAIモデルとの連携、イベント駆動、スケーラブルなマイクロサービス構成に耐えうる頑健なモノレポ（Monorepo）構成として設計されています。

---

## 🌌 設計思想

### 1. Mission-First Architecture
本OSは、一過性のチャット回答を生成するシステムではありません。ユーザーが設定した「ミッション（Mission）」の達成を究極の目的とし、そのための計画策定、自律的なAI Company編成、エビデンス収集、自己監査（UQI 95%超）、およびナレッジのDNA育成をイベント駆動で実行します。

### 2. Microservices & Cloud-Native
各サービスは完全に疎結合なマイクロサービス構成（Monorepoワークスペース内での隔離およびDocker化）をとっており、スケーラブルかつ耐障害性に優れたイベントストリーミング基盤によってリアルタイムに連携されます。

---

## 📂 ディレクトリ構成（Monorepo Workspace）

```bash
ORIGIN-OS/
├── apps/                    # フロントエンドアプリケーション（Next.js App Router）
│   └── web/                 # メインユーザーインターフェース
├── packages/                # 共有コアパッケージ群（Types、UI Components等）
│   ├── ts-config/           # 共有TypeScript設定
│   ├── eslint-config/       # 共有ESLint設定
│   └── ui/                  # 共有コンポーネントライブラリ (Storybook管理)
├── services/                # バックエンド・マイクロサービス群
│   ├── orchestrator/        # Intelligence Orchestrator
│   ├── mission-engine/      # Mission Engine Core
│   └── knowledge-dna/       # Knowledge DNA Manager
├── docs/                    # 各種仕様書・アーキテクチャバイブル・設計図
├── infra/                   # Terraform等、インフラストラクチャ定義
├── scripts/                 # ビルド・デプロイ自動化スクリプト
├── .github/
│   └── workflows/           # CI/CD自動化（Lint、Type Check、Test、Build）
├── .storybook/              # UIコンポーネント開発のためのStorybook構成
├── e2e/                     # PlaywrightによるE2E統合テストスイート
├── .devcontainer/           # Dev Container開発環境定義
├── Dockerfile               # 本番デプロイ用マルチステージDockerfile
├── docker-compose.yml       # ローカル開発用Docker Compose構成
├── pnpm-workspace.yaml      # pnpmワークスペース定義
└── turbo.json               # Turborepoビルドパイプライン定義
```

---

## 🚀 開発の開始方法

### 前提条件
- **Node.js**: `v20` 以上推奨
- **pnpm**: `v9` 以上推奨
- **Docker & Docker Compose** (ローカルでコンテナ環境を稼働する場合)

### 1. 依存関係のインストール
本リポジトリはpnpmワークスペースを使用しています。ルートディレクトリで以下を実行すると、すべてのアプリ・サービスの依存関係がリンクされながら一括インストールされます。

```bash
pnpm install
```

### 2. ローカル開発サーバーの起動
Turborepoにより、すべての依存関係を解決した状態で高速に開発サーバーが起動します。

```bash
pnpm dev
```

### 3. 本番用ビルドの実行
キャッシュを最適に活用してビルドを行います。

```bash
pnpm build
```

---

## 🧪 テスト・品質保証

### 1. ユニットテスト (Vitest)
高可用性、高信頼性を担保するため、すべての共通関数およびビジネスロジックはVitestにより検証されます。

```bash
pnpm test
```

### 2. E2Eテスト (Playwright)
ブラウザ実動作のシナリオベース検証を行います。

```bash
npx playwright test
```

### 3. ESLint & Type Check
静的解析と型検査を一括で実行します。

```bash
pnpm lint
```

---

## 🎨 UIコンポーネントの管理 (Storybook)
共有UIパッケージおよびアプリケーション内のコンポーネントをStorybookでビジュアルテスト・カタログ化します。

```bash
# Storybookの起動
pnpm run storybook
```

---

## 🐳 Docker環境での開発・本番デプロイ

### 1. ローカル開発環境の起動 (Docker Compose)
Redisキャッシュなどのインフラを含めた環境を、ワンクリックでローカルに起動できます。

```bash
docker-compose up -d
```

### 2. Visual Studio Code Dev Container
`.devcontainer` 内の定義に沿って、VS Codeで「Reopen in Container」を選択するだけで、Node.jsやpnpm、Docker-in-Dockerが自動構成された統一的な開発コンテキストが立ち上がります。

---

## 🛡️ セキュリティ & 環境変数

秘匿性の高いAPIキー（Gemini API Key等）は、`.env.example` を参考にローカルファイル `.env` に定義することで、リポジトリにコミットされるのを防ぎ、安全に外部化されます。

```env
# .env.example
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
NODE_ENV=development
```

---

## 📋 CI/CD自動化フロー
GitHub Actions (`.github/workflows/ci.yml`) により、プルリクエストおよびブランチのPush時に以下の検証が自動実行され、Q5品質を満たさない成果物のマージをシャットアウトします。

1. **Checkout & Cache**: 依存キャッシュを復元し環境を高速展開。
2. **Install**: 厳格な `pnpm-lock.yaml` に基づいて依存インストール。
3. **Lint & Check**: ESLint + Type Check の自動実行。
4. **Test**: ユニット/インテグレーションテストを実行。
5. **Build**: 本番環境向けコンパイルの適合性を検証。
