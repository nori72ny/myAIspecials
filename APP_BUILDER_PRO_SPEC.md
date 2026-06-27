# AI Workspace 「App Builder Pro」機能設計仕様書

本書は、AI Workspaceに統合される最上位のアプリケーション自動構築エンジン**「App Builder Pro」**のシステム構成、データベース設計、マルチエージェント協調生成フロー、および画面設計を定義した製品仕様設計書です。

ユーザーが「作りたいアプリ（顧客管理、予約管理、AIチャットなど）」を自然言語で入力するだけで、AIが要件分析からデータベース設計、API設計、そして美しく応答性の高いフロントエンド（Tailwind CSS & shadcn/ui）およびバックエンド・インフラ接続コードまでを自律的に一気通貫で自動生成・ビルド・ZIP出力します。

---

## 1. システム構成 ＆ 対応スタック (System Architecture & Tech Stack)

App Builder Proは、生成されたコードが特定のベンダーに依存しないよう、モダンで堅牢な世界標準のフルスタックフレームワークおよびサービス構成に対応しています。

```
                                  [ ユーザーの自然言語インプット ]
                                                 │
                                                 ▼
                                     [ AI 要件整理 ＆ 構造解析 ]
                    (目的、アクター、画面一覧、リレーション、CRUD設計の自律分解)
                                                 │
                                                 ▼
                                     [ App Builder Orchestrator ]
                                                 │
            ┌────────────────────────────────────┼────────────────────────────────────┐
            ▼ (Frontend Engine)                  ▼ (Backend / DB Engine)              ▼ (Platform Config)
     +---------------------------+        +---------------------------+        +---------------------------+
     | - React 18+ / Vite        |        | - Node.js (Express / Fastify)|     | - README.md / setup docs  |
     | - Next.js (App Router)    |        | - Supabase (PostgreSQL / RLS)|     | - Dockerfile / YAML build |
     | - Tailwind CSS            |        | - Firebase Auth & Firestore|     | - .env.example / API keys |
     | - shadcn/ui / Lucide Icons|        | - Prisma ORM / SQL schemas|        | - Package.json scripts    |
     +──────────────┬────────────+        +─────────────┬─────────────+        +─────────────┬─────────────+
                    │                                   │                                   │
                    └───────────────────────────────────┼───────────────────────────────────┘
                                                        ▼
                                           [ Sandbox Builder Workspace ]
                                                        │
                                                        ▼
                                           [ 自律監査 ＆ QAテストエージェント ]
                                         (型チェック、ビルド、自己修復ループ)
                                                        │
                                                        ▼
                                   [ ZIP Packager / Projects & Knowledge コミット ]
```

---

## 2. マルチエージェント自動生成フロー (Cooperative Generation Flow)

アプリケーションの構築は、人間が手作業で行うステップを模倣し、役割の異なる3人の特化型「AIエージェント社員」がバケツリレー式に協調・検証を繰り返すことで、動作可能なバグフリーコードを担保します。

```
[1. ユーザーが作りたいアプリの要件を自然言語入力]
                       │
                       ▼
[2. AI 要件整理 (Requirement Analyzer)]
      ├─ アプリケーションの目的、想定ユーザーアクターの定義
      ├─ 必要機能、画面一覧、データ構造（テーブル、カラム、リレーション）の構築
      └─ 設計仕様書 (Markdown) として Knowledge Hub へ自動保存
                       │
                       ▼
[3. Designer Agent (UI/UX ＆ スタイル設計)]
      ├─ shadcn/ui および Tailwind CSS の配色・レイアウト定義を作成
      └─ ダッシュボード、一覧、詳細、編集、設定画面のワイヤー構成（JSON）を出力
                       │
                       ▼
[4. Developer Agent (コード・API実装)]
      ├─ フロントエンド（React / Next.js）のコンポーネントコードをフル実装
      ├─ バックエンド（Node.js）および DB（Supabase SQL / Firebaseルール）コードの記述
      └─ 環境構築手順（README.md）と環境変数ファイル（.env.example）の作成
                       │
                       ▼
[5. QA Agent (コンパイル検証 ＆ 自動修正)] ───► [ビルド/型エラー検知] ───► [Developer Agentへリテイク]
                       │ (コンパイル成功・動作確認完了)
                       ▼
[6. 成果物のパッキング ＆ コミット]
      ├─ 作成されたリポジトリ全体を ZIP アーカイブ化
      ├─ プロジェクト管理機能 (Projects System) の「Creation」フォルダへ自動保存
      └─ ユーザーの画面上にリアルタイム完了通知 ＆ インタラクティブプレビュー表示
```

---

## 3. データベース設計 (Database Schema Design)

App Builder Proが「生成したアプリケーション」のメタデータ、データ構造、APIエンドポイント、およびファイル世代を厳格に追跡するための管理用データベーススキーマ。

```
                  +---------------------------+
                  |    generated_applications |
                  +---------------------------+
                  | id (PK)                   |
                  | project_id (FK)           |
                  | app_name                  |
                  | app_description           |
                  | frontend_stack            |
                  | backend_stack             |
                  | current_version           |
                  | status                    |
                  | created_by (FK)           |
                  | created_at                |
                  | updated_at                |
                  +-------------+-------------+
                                | 1
                                |
                                ├─────────────────────────────┐
                                | 1..N                        | 1..N
                  +-------------v-------------+   +------------v------------+
                  |     app_data_schemas      |   |       app_endpoints     |
                  +---------------------------+   +-------------------------+
                  | id (PK)                   |   | id (PK)                 |
                  | app_id (FK)               |   | app_id (FK)             |
                  | table_name                |   | route_path              |
                  | description               |   | http_method             |
                  | columns_definition (JSON) |   | description             |
                  | relations_config (JSON)   |   | request_payload (JSON)  |
                  +---------------------------+   | response_payload (JSON) |
                                                  +-------------------------+
                                                                ▲
                                                                │ 1..N
                                                                │
                                                                │ 1
                  +---------------------------+   +-------------+-----------+
                  |       app_artifacts       |   |       app_build_logs    |
                  +---------------------------+   +-------------------------+
                  | id (PK)                   |   | id (PK)                 |
                  | app_id (FK)               |   | app_id (FK)             |
                  | version_number (INT)      |   | step_name               |
                  | zip_storage_url           |   | status                  |
                  | readme_text (TEXT)        |   | stdout_message (TEXT)   |
                  | byte_size                 |   | error_details (TEXT)    |
                  | created_at                |   | created_at              |
                  +---------------------------+   +-------------------------+
```

### テーブル定義詳細

#### ① `generated_applications` (生成アプリ基本台帳)
*   `id`: UUID (Primary Key)
*   `project_id`: UUID (Foreign Key - 所属するプロジェクトID)
*   `app_name`: VARCHAR(255) (生成アプリ名。例: 「MEO最適化タスク管理システム」)
*   `app_description`: TEXT (アプリの目的、主要要件要約)
*   `frontend_stack`: VARCHAR(100) (フロントエンド構成。例: `REACT_VITE`, `NEXTJS_APP_ROUTER`)
*   `backend_stack`: VARCHAR(100) (バックエンド/DB構成。例: `SUPABASE_POSTGRES`, `EXPRESS_NODEJS`)
*   `current_version`: INT (最新世代バージョン。例: `3`)
*   `status`: VARCHAR(50) (現在のビルド状態。`ANALYZING`, `SCAFFOLDING`, `CODING`, `BUILD_TEST`, `SUCCESS`, `FAILED`)
*   `created_by`: VARCHAR(100) (作成ユーザーのID)
*   `created_at` / `updated_at`: TIMESTAMP

#### ② `app_data_schemas` (データモデル・リレーション設計)
アプリ内のテーブル構造、カラム定義、外部キー関係。
*   `id`: UUID (Primary Key)
*   `app_id`: UUID (Foreign Key)
*   `table_name`: VARCHAR(100) (物理テーブル名。例: `tasks`, `users`, `shop_metrics`)
*   `description`: VARCHAR(512) (テーブルの用途説明)
*   `columns_definition`: JSON (カラム一覧、データ型、制約、プライマリーキー定義。例: `[{"name":"id", "type":"serial", "pk":true}]`)
*   `relations_config`: JSON (1対多、多対多などのリレーション構成情報)

#### ③ `app_endpoints` (API/エンドポイント設計)
自動生成されたAPIルートの仕様。
*   `id`: UUID (Primary Key)
*   `app_id`: UUID (Foreign Key)
*   `route_path`: VARCHAR(255) (APIエンドポイント。例: `/api/v1/tasks`)
*   `http_method`: VARCHAR(20) (`GET`, `POST`, `PUT`, `DELETE`)
*   `description`: VARCHAR(512) (APIの挙動詳細)
*   `request_payload` / `response_payload`: JSON (リクエスト・レスポンスの構造見本データ)

#### ④ `app_artifacts` (物理コード・ZIP世代管理)
生成され、ビルドを通過した成果物の履歴。いつでも過去のZIPにロールバック可能。
*   `id`: UUID (Primary Key)
*   `app_id`: UUID (Foreign Key)
*   `version_number`: INT (世代番号)
*   `zip_storage_url`: VARCHAR(1024) (オブジェクトストレージに格納された物理ZIPアセットパス)
*   `readme_text`: TEXT (ビルド・起動・環境構築手順、テーブル構成などを網羅したREADME)
*   `byte_size`: BIGINT (ZIPファイル容量)
*   `created_at`: TIMESTAMP

#### ⑤ `app_build_logs` (ビルド・エラー修正ログ履歴)
生成中の詳細コンソール出力。エラー時の自動修復（Self-Correction）の軌跡。
*   `id`: UUID (Primary Key)
*   `app_id`: UUID (Foreign Key)
*   `step_name`: VARCHAR(100) (ビルド工程。`SCAFFOLD_VITE`, `INSTALL_SHADCN`, `TYPE_CHECK`, `COMPILED`)
*   `status`: VARCHAR(50) (`SUCCESS`, `WARN`, `FAILED`)
*   `stdout_message`: TEXT (正常出力コンソールメッセージ)
*   `error_details`: TEXT (ビルドエラー発生時のstderr、およびスタックトレース。AI修復のインプット)
*   `created_at`: TIMESTAMP

---

## 4. 画面設計 (UI/UX Canvas Layouts)

すべてのダッシュボード、コードツリー、エディタ、プレビューコンポーネントは、完全レスポンシブ、ダーク/ライトテーマ、およびインタラクティブな動き（motion/react 準拠）を基本設計としています。

### 画面 A: 要件入力 ＆ AI仕様構成 (AI Requirements Analyzer)
作りたいアプリを自然言語で伝えると、AIが瞬時に画面一覧やDB関係図をビジュアル構成して人間に提示する初期設計・検収画面。

```
+----------------------------------------------------------------------------------------------------+
| [AI Workspace]  💻 App Builder Pro > 🆕 新規業務システムを自律ビルド                                |
+----------------------------------------------------------------------------------------------------+
|  [ 💬 新宿深夜カフェの店舗情報、MEO測定数値、日々のタスクを管理するダッシュボードと管理システム。    ] |
+----------------------------------------------------------------------------------------------------+
| < LEFT: AIが要件を自動分解 (AI Spec Breakdown) >   | < RIGHT: 自動設計されるデータ構造 (DB Relationships) > |
|                                                    |                                                |
|  📋 要件サマリー (Generated Requirements)          |  🗄️ テーブル設計プレビュー (Schemas Grid)          |
|  - **目的**: MEO/店舗数値の可視化とアクション管理  |  [ ] 1. `shops` (店舗情報)                      |
|  - **対象アクター**: 管理者, 店舗スタッフ          |         └─ id, name, area, google_profile_url  |
|                                                    |  [ ] 2. `meo_metrics` (MEO順位・口コミデータ)   |
|  🛠️ 生成される画面一覧 (Proposed Screens)          |         └─ id, shop_id(FK), rank, stars, reviews|
|  [■] 1. Dashboard (店舗数値・タスク進捗グラフ)     |  [ ] 3. `tasks` (MEO改善タスク管理)            |
|  [■] 2. Shops List (店舗一覧・新規追加)            |         └─ id, shop_id(FK), title, status, due |
|  [■] 3. Shop Detail (測定履歴推移、口コミ推移)     |                                                |
|  [■] 4. Task Board (カンバン風ステータス編集)       |  🔑 認証 ＆ 権限設計 (Authorization Layer)      |
|                                                    |  - 管理者: 全店舗データ閲覧、店舗作成、タスク削除|
|  📦 出力スタック構成 (Framework Settings)          |  - スタッフ: 自店舗データ登録、タスク更新のみ  |
|  - Front: [React 18 / Vite (Tailwind, shadcn)  ▼ ] |                                                |
|  - Backend: [Supabase (PostgreSQL / RLS)      ▼ ] |  [⭐ この設計仕様を Knowledge Hub に資産保存]   |
+----------------------------------------------------+------------------------------------------------+
| [🔥 この構成・画面設計でフルスタックアプリケーションの自動コードビルドを開始する]                   |
+----------------------------------------------------------------------------------------------------+
```

### 画面 B: 開発コックピット ＆ プレビュー (Development Workspace & Live Preview)
コードの自動生成、ファイルツリーのブラウズ、および完成した画面をその場で操作できるライブプレビューエリア。

```
+----------------------------------------------------------------------------------------------------+
| [App Builder] > 🛠️ 開発スタジオ: MEO店舗・タスク管理システム (Ver 1.0)                             |
+----------------------------------------------------------------------------------------------------+
| < LEFT: ファイルエクスプローラー >  | < CENTER: ライブ画面プレビュー (Interactive HTML Preview) >     |
|                                     | +------------------------------------------------------------+ |
|  📁 アプリ・ソースコードツリー      | | [ MEO 店舗マネージャー ]  新宿 La Lounge (55% 進捗)          | |
|  ├─ 📂 src                          | | +-------------------+ +-------------------+ +------------+ | |
|  │  ├─ 📂 components                | | | MEO検索順位: 3位   | | 口コミ数: 142件   | | 未完了:3件| | |
|  │  │  ├─ 📄 Dashboard.tsx          | | +-------------------+ +-------------------+ +------------+ | |
|  │  │  └─ 📄 TaskKanban.tsx         | |  📋 直近の改善タスク (Tasks Kanban)                        | |
|  │  ├─ 📄 App.tsx                   | |  [ 未着手 (1) ]        [ 進行中 (1) ]        [ 完了 (5) ]  | |
|  │  └─ 📄 index.css                 | |  +---------------+     +---------------+     +-----------+ | |
|  ├─ 📄 package.json                 | |  | 写真を3枚投稿 |     | 返信テンプレ  |     | プロフ設定| | |
|  ├─ 📄 supabase.sql (DB定義)        | |  +---------------+     +---------------+     +-----------+ | |
|  └─ 📄 README.md (手順書)           | +------------------------------------------------------------+ |
|                                     +----------------------------------------------------------------+
| [✏️ 画面の追加・機能追加・バグ修正 | < RIGHT: リアルタイム・ビルド＆コンソールログ >                |
|  などのリクエストを入力...] [送信]  |  [16:55:12] [QA] タイプチェック検証を開始します...             |
|                                     |  [16:55:14] [QA] エラー検知: `TaskKanban.tsx` Line 24:         |
|  [📥 フルコードZIPをダウンロード]   |            `ShopType` is not defined in shared types.          |
|  [🔄 前回コードへロールバック]      |  [16:55:16] [AI] 自動修復中... shared/types.ts に型宣言を追加。 |
|  [🚀 Cloud Run / Supabaseにデプロイ]|  [16:55:18] [QA] 再コンパイル成功。ビルド成功(0 errors)！      |
+------------------------------------+----------------------------------------------------------------+
```

---

## 5. ナレッジ・プロジェクト・エージェント連携 (Integrated Workspace)

App Builder Proは、単体で動作するのではなく、AI Workspace内の他のコアシステムとデータ・知能をシームレスに同期します。

1.  **プロジェクト連携 (Projects System)**
    *   ユーザーが App Builder Pro を起動すると、自動的に所属する「プロジェクト（例：新宿カフェプロジェクト）」のメタデータや、そこにアップロードされている店舗用ロゴ画像、間取り図、仕様書PDFなどを自律的に読み込みます。
    *   生成されたコード（ファイル群）や最終ZIPは、プロジェクトワークスペースの「Creation（開発制作）」ドメインへバージョン履歴（Ver1, Ver2...）とともに自動コミットされ、プロジェクト全体の進捗率に反映されます。
2.  **ナレッジハブ連携 (Knowledge Hub)**
    *   要件定義段階で作成された「要件仕様書（目的、必要機能、DB設計、API設計を網羅したMarkdown）」は、自動要約されてKnowledge Hubの対応フォルダに「資産（アセット）」として同期保存されます。
    *   これにより、ユーザーはナレッジコパイロット（RAGチャット）を使い、「新宿カフェプロジェクトで自動生成された管理システムのDBリレーション構造を分かりやすく説明して」といった自然言語での問い合わせが常時可能になります。
3.  **エージェント・ビルダー連携 (Agent Builder)**
    *   コード生成のプロセスには、Agent Builderで雇用（またはプリセット）されている「Developer Agent (プログラミング担当)」「Designer Agent (UI配色・コンポーネント構成担当)」「QA Agent (バグチェック＆自己修復担当)」の特化AIチームが自動的に割り当てられます。
    *   各エージェントの処理ログやトークンコストは「Agent Dashboard」で確認でき、社内AIリソースとしての稼働率・成功率が定量トラッキングされます。

---

## 6. 将来拡張設計 (Future Extensibility Plan)

今後、App Builder ProをよりエンタープライズなNo-Code/Low-Code開発の中心地へと成長させるための拡張開発計画。

### ① ビジュアル型ノーコードDB設計エディタ (Visual Database Designer)
*   AIによる自動生成だけでなく、ユーザー自身がGUI上でテーブル同士をマウスドラッグでリレーション接続（1:N、N:Nなど）したり、カラムの型（VARCHAR, INT, UUID等）を追加・変更できる「ビジュアルスキーマ設計コンポーネント」を搭載。
*   GUI上での変更は、即座に裏側のPrisma SchemaやSupabase SQLへと自動反映され、移行（Migration）コードが自律ビルドされます。

### ② 本番サーバーへのワンクリックホスティングデプロイ (Instant Production Deployment)
*   開発・テストを完了したアプリケーションを、ZIPダウンロードするだけでなく、ワンクリックで、Vercel (フロントエンド)、Cloud Run (Expressバックエンド)、およびSupabase / Firebase (本番データベース)のクラウドインフラに、AIが本番用APIキーやSSL証明書を自動プロビジョニングしてデプロイ。
*   「https://app-yourdomain.run.app」のような動作確認済みの本番公開URLを瞬時にユーザーへ払い出す、完全セルフホスト自動ホスティングパイプラインへと拡張します。
