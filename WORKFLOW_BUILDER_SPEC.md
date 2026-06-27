# AI Workspace 「ワークフロー・ビルダー（Workflow Builder）」機能設計仕様書

本書は、AI Workspaceにおいて、複数の異なるAIモデル、特化型エージェント、検索エンジン、データ解析エンジン、および各種バイナリ成果物生成エンジン（Excel/PowerPoint/ZIP等）を自由自在にドラッグ＆ドロップで線でつなぎ、一連の業務処理パイプラインとして自律自動実行するための**「Workflow Builder（ワークフロー・ビルダー）」**の機能設計仕様書です。

ユーザーはビジュアルなNode接続型UIを用いることで、データ入力から高度な調査、思考分析、そしてドキュメントやアプリケーションコードなどの物理成果物作成までの全行程をノーコードで自動連鎖させることができます。

---

## 1. ワークフローエンジンの基本コンセプト & アーキテクチャ

ワークフローエンジンは、有向非巡回グラフ（DAG: Directed Acyclic Graph）モデルをベースに稼働し、各Node（処理ノード）に「入力」「処理（思考/行動）」「出力」の定義を持たせます。

```
                       [1. Input Node (開始)]
                                │
                                ▼
                       [2. Search/Research] ────► (リアルタイムWeb検索・引用抽出)
                                │
                                ▼
                       [3. Analysis Node] ──────► (3C/SWOT/ポジショニング分析)
                                │
                                ▼
                       [4. AI Agent Node] ──────► (特化型AI社員による意思決定・構成案構築)
                                │
            ┌───────────────────┴───────────────────┐
            ▼ (PPT / Doc / Sheet)                   ▼ (App / Code)
     +---------------+                       +---------------+
     | Document Node |                       | Web/App Node  |
     | PPTX/XLSX/PDF |                       | HTML/TS/React |
     +──────┬────────+                       +──────┬────────+
            │                                       │
            └───────────────────┬───────────────────┘
                                ▼
                       [5. Export Node (終了)] ──► (ZIP/PDF/PPTX の物理アセット保存・出力)
```

### ⚙️ ワークフローエンジンの実行パラダイム
1.  **トポロジカルソート実行**: エンジンは、Node間の依存関係（リンクの方向性）を解析し、先行ステップが正常完了するまで後続ステップの実行を待機させます。
2.  **型安全なコンテキスト・パイプライン**: 前のNodeが出力したデータ構造（例: `text/markdown`, `application/json`, `file/url`）は、後続Nodeの対応する入力ポートに正確にマッピングされます。
3.  **状態の冪等性 & 再実行**: 途中のNodeでエラー（例: API制限、型エラー）が発生した場合、最初からやり直すのではなく、エラーが発生したNodeから修正後に「再開」できるチェックポイント機構を搭載します。

---

## 2. 画面設計 (UI/UX Canvas Layouts)

すべてのビジュアルエディタ、インプットフォーム、履歴モニター画面は、モバイル完全対応（Responsive Flex）、高品質なダーク/ライトモード、および「motion/react」を利用したスムーズなノード追従トランジション（React Flowベースのドラッグ＆ドロップUI）を想定しています。

### 画面 A: ワークフロー・ビジュアルエディタ (Workflow Canvas Studio)
左側にドラッグ可能な「Nodeパレット」を配し、中央の広大な「グリッドキャンバス」上にノードをドラッグ＆ドロップして線を繋ぐメイン設計画面。

```
+----------------------------------------------------------------------------------------------------+
| [AI Workspace]  🛠️ ワークフロー・スタジオ (Workflow Canvas)                         [▶ ワークフロー実行] |
+----------------------------------------------------------------------------------------------------+
|  [📂 テンプレートから読込] [💾 保存] [📋 複製] [⭐ お気に入り]                        [実行モード: ◉ Expert] |
+----------------------------------------------------------------------------------------------------+
| < LEFT: Node パレット >             | < CENTER: ビジュアル・キャンバス (Grid Workspace Canvas) >     |
|                                     |                                                                |
|  📥 Input (入力ノード)              |  [ 📥 店舗入力 (Input) ] ────► [ 🔍 MEO検索 (Search) ]          |
|  [📄 Text] [📂 Excel] [🌐 URL]      |  - 店舗名: 新宿La Lounge      - 範囲: 新宿駅周辺 10km         |
|                                     |  - 業種: カフェ・喫茶店        - 参照: Google BP, Maps         |
|  🔍 Intelligence (検索・調査)        |                                      │                         |
|  [🔍 Search] [📊 Deep Research]     |                                      ▼ (MEO生データ)           |
|                                     |                         [ 📊 SWOT・競合分析 (Analysis) ]       |
|  📈 Analysis (分析ノード)           |                         - 脳(LLM): Claude 3.5 Sonnet   |
|  [📈 分析] [🤖 Agent実行]            |                         - フレームワーク: 3C, SWOT     |
|                                     |                                      │                         |
|  📄 Documents (ドキュメント)        |                                      ├─────────────────────────┐
|  [📝 提案書] [📊 PPT] [📄 Word]      |                                      ▼ (戦略マークダウン)      ▼ (アセット)
|                                     |                         [ 📊 提案書作成 (Presentation) ] [ 💻 LP構築 (Website) ]
|  💻 Creation (生成制作)             |                         - 形式: PowerPoint              - 形式: Tailwind CSS
|  [💻 Webサイト] [📱 アプリ]          |                         - スタイル: コーポレートブルー   - モード: React / TS
|                                     |                                      │                         │
|  📤 Export (出力ノード)              |                                      ▼                         ▼
|  [📂 ZIP] [📄 PDF]                  |                         [ 📤 成果物パック (Export & ZIP Pack) ] ◄─────┘
|                                     |                         - 保存形式: ZIP & PDF / 自動通知
+------------------------------------+----------------------------------------------------------------+
| < BOTTOM: 実行時パラメータ構成 ＆ 選択Nodeプロパティ設定 >                                             |
|  - 選択中ノード: `SWOT・競合分析` | システム指示: 「入力された競合店舗の口コミ数と評価星から...」 |
|  - 推奨AIモデル: [ Claude 3.5 Sonnet ▼ ] | 出力ポート: [ output_markdown (JSON/TEXT) ]              |
+----------------------------------------------------------------------------------------------------+
```

### 画面 B: 実行アクティビティ ＆ 履歴モニター (Execution Run History & Metrics)
作成されたワークフローの過去の実行履歴、成功率、APIコスト、生成アセット、および現在進行中のワークフローの進捗ステータスを追跡する監視画面。

```
+----------------------------------------------------------------------------------------------------+
| [Workflow Builder] > 🕒 ワークフロー実行履歴 ＆ パフォーマンス監査                                    |
+----------------------------------------------------------------------------------------------------+
| < LEFT: 過去の実行履歴一覧 >                       | < RIGHT: 選択された実行(Run #24) の詳細・ログ監視 >    |
|                                                    |                                                |
|  [Run #24] 2026/06/25 16:50 (最新)                 |  📊 実行詳細: `新宿店舗出店 ＆ LP一挙自動生成ライン`        |
|  ├─ 状態: ✅ 成功                                  |  ├─ 実行日時: 2026/06/25 16:50 (実行時間: 1分22秒)     |
|  └─ コスト: $1.15 | 時間: 82秒                     |  ├─ 選択実行モード: Expert | 総合コスト: $1.15         |
|                                                    |  └─ 総合成功率: 100% (自動リトライ 1回)                 |
|  [Run #23] 2026/06/24 11:12                        |                                                |
|  ├─ 状態: ✅ 成功                                  |  📁 生成された成果物 (Saved Artifacts)         |
|  └─ コスト: $1.02 | 時間: 75秒                     |  ├─ 📊 [新宿深夜カフェ出店計画.pptx] (プレゼン用)      |
|                                                    |  ├─ 💻 [LaLounge_LP_Ver2.zip] (Vite/Tailwindコード)    |
|  [Run #22] 2026/06/23 09:15                        |  └─ 📄 [MEO競合調査レポート_v2.pdf] (PDF報告書)         |
|  ├─ 状態: ❌ 失敗 (API接続タイムアウト)              |                                                |
|  └─ コスト: $0.12 | 時間: 12秒                     |  ⚡ ノード別実行タイムライン (Node Timeline logs)       |
|                                                    |  - [Input Node] ➔ 完了 (0.2s)                   |
|  [🔍 期間、ステータス、利用モデル、案件名から検索]  |  - [MEO Search Node] ➔ 完了 (12.4s) | 14件の競合取得  |
|                                                    |  - [SWOT Analysis Node] ➔ 完了 (24.1s) | LLM: Claude  |
|                                                    |  - [LP Web Builder Node] ➔ 完了 (35.2s) | LLM: DeepSeek|
+----------------------------------------------------+------------------------------------------------+
| [🔄 今回と同一の入力パラメータ設定をロードし、最初から再実行する]   [📥 すべての成果物を一括ZIPエクスポート] |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. データベース・スキーマ設計 (Workflow Database Schema)

ワークフロー全体のトポロジー（Nodeとエッジ(リンク)の関係性）、各ノードに設定された個別パラメータ、実行ログ、履歴を整合性高く蓄積するリレーショナルスキーマ。

```
                  +-------------------------+
                  |        workflows        |
                  +-------------------------+
                  | id (PK)                 |
                  | name                    |
                  | description             |
                  | project_id (FK, Nullable)|
                  | author_user_id (FK)     |
                  | is_preset (Boolean)     |
                  | is_favorite (Boolean)   |
                  | created_at              |
                  | updated_at              |
                  +----+---------------+----+
                       |               |
                       | 1             | 1
                       |               |
                       | 1..N          | 1..N
                  +----v----+     +----v----+
                  | workflow|     | workflow|
                  |  nodes  |     |  edges  |
                  +---------+     +---------+
                  | id (PK) |     | id (PK) |
                  | workflow|     | workflow|
                  | _id (FK)|     | _id (FK)|
                  | node_key|     | source_ |
                  | type    |     | node_id |
                  | title   |     | target_ |
                  | config  |     | node_id |
                  |  (JSON) |     | port_   |
                  | position|     | mapping |
                  |  (JSON) |     |  (JSON) |
                  +----+----+     +---------+
                       | 1
                       |
                       | 1..N
                  +----v----+
                  | workflow|
                  | _runs   |
                  +---------+
                  | id (PK) |
                  | workflow|
                  | _id (FK)|
                  | user_id |
                  | status  |
                  | mode    |
                  | inputs  |
                  |  (JSON) |
                  | metrics |
                  |  (JSON) |
                  | started_|
                  | _at     |
                  +---------+
```

### テーブル定義詳細

#### ① `workflows` (ワークフロー定義マスター)
ワークフロー設計自体の全体設定。
*   `id`: UUID (Primary Key)
*   `name`: VARCHAR(255) (ワークフロー名。例: 「競合調査 ＆ 提案書自動作成ライン」)
*   `description`: TEXT (ワークフローの目的、想定する成果物などの説明)
*   `project_id`: UUID (Foreign Key, Nullable - 特定プロジェクト専用フローの場合のみ紐付け)
*   `author_user_id`: VARCHAR(100) (作成者ユーザーID)
*   `is_preset`: BOOLEAN (最初から登録されているプリセット定義かどうか)
*   `is_favorite`: BOOLEAN (お気に入り登録フラグ)
*   `created_at` / `updated_at`: TIMESTAMP

#### ② `workflow_nodes` (配置されたNodeデータ)
キャンバスに配置された、個別の処理ノードの定義と配置座標。
*   `id`: UUID (Primary Key)
*   `workflow_id`: UUID (Foreign Key)
*   `node_key`: VARCHAR(100) (ノード識別用のキー名。例: `analysis_node_1`)
*   `type`: VARCHAR(100) (ノード種別。例: `INPUT`, `SEARCH`, `ANALYSIS`, `AGENT_RUN`, `PPT_GEN`, `EXPORT_ZIP`)
*   `title`: VARCHAR(255) (キャンバス上の表示名。例: 「SWOT・競合分析」)
*   `config`: JSON (ノード特有の設定値。使用モデル、プロンプトテンプレート、出力指定ファイル等)
*   `position`: JSON (キャンバス上のX, Y座標表示位置情報)

#### ③ `workflow_edges` (Node接続リンクデータ)
ノード同士を結ぶ線（トポロジー）と、データの流れ（ポートマッピング）を定義。
*   `id`: UUID (Primary Key)
*   `workflow_id`: UUID (Foreign Key)
*   `source_node_id`: UUID (Foreign Key - 接続元ノードのID)
*   `target_node_id`: UUID (Foreign Key - 接続先ノードのID)
*   `port_mapping`: JSON (どの出力データポートを、どの入力ポートに紐付けるかの定義。例: `{"source_output": "競合比較リスト", "target_input": "分析対象テキスト"}`)

#### ④ `workflow_runs` (ワークフロー実行履歴マスター)
ワークフローが実行された際の実績・ログ・メトリクスを記録。
*   `id`: UUID (Primary Key)
*   `workflow_id`: UUID (Foreign Key)
*   `user_id`: VARCHAR(100) (実行ユーザーのID)
*   `status`: VARCHAR(50) (ステータス: `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`)
*   `mode`: VARCHAR(50) (実行モード: `FAST`, `BALANCED`, `EXPERT`)
*   `inputs`: JSON (開始時に手動入力または流し込まれた初期パラメータ群)
*   `metrics`: JSON (消費トークン、実コスト、総処理時間、成果物保存パスなどの統計。例: `{"total_cost_usd": 1.15, "execution_time_sec": 82}`)
*   `started_at` / `completed_at`: TIMESTAMP

---

## 4. 詳細なNode設計仕様 (Node Types & Schema Rules)

ワークフロー上で利用可能な全11個の主要Nodeのインプット・アウトプットポート定義と、その処理仕様。

### ① Input Node (ユーザー入力・素材流し込み)
*   **用途**: ワークフローの起点。手動テキスト、CSV、Excel、PDF、ウェブURL、ファイルのアップロードポートを提供。
*   **インプット**: なし（または外部APIトリガー）
*   **アウトプット**: `raw_text (String)`, `file_buffer (Binary)`, `file_url (String)`

### ② Search Node (一般検索・AI検索)
*   **用途**: 最新のWebファクト、店舗、ブログ情報などをリアルタイム検索・クローリング。
*   **インプット**: `query (String)`
*   **アウトプット**: `search_results (JSON-Array)`, `integrated_sources (Markdown)`

### ③ Research Node (Deep Research・詳細調査)
*   **用途**: バックグラウンドで複数の自律クローリングステップを実行。業界レポート、技術動向の徹底網羅。
*   **インプット**: `research_theme (String)`
*   **アウトプット**: `detailed_report (Markdown)`, `sources_evidence (JSON)`

### ④ Analysis Node (多角分析)
*   **用途**: 3C, SWOT, 5Forceなどの経営・市場分析。
*   **インプット**: `analysis_target (String)`, `context_data (JSON)`
*   **アウトプット**: `analysis_markdown (String)`, `structured_metrics (JSON)`

### ⑤ AI Agent Node (エージェント自律実行)
*   **用途**: 定義された「AI社員エージェント（またはチーム）」をデプロイし、インプットに対して自律的な意思決定をさせる。
*   **インプット**: `task_instruction (String)`, `input_context (JSON)`
*   **アウトプット**: `agent_decision (String)`, `final_deliverables (JSON)`

### ⑥ Document Node (文書自動作成)
*   **用途**: レポート、要件定義書、議事録などの清書Markdown作成およびWord(docx)レンダリング。
*   **インプット**: `source_markdown (String)`, `template_style (String)`
*   **アウトプット**: `cleaned_document (Markdown)`, `docx_file_url (String)`

### ⑦ Presentation Node (PowerPoint自動生成)
*   **用途**: PptxGenJSなどを裏側で実行し、指定テーマカラーに基づくスライド（スライドショー）作成。
*   **インプット**: `slide_structures (JSON)`, `color_palette (String)`
*   **アウトプット**: `pptx_file_url (String)`

### ⑧ Spreadsheet Node (Excel自動集計)
*   **用途**: 構造化データ（JSON）から、フィルタ・グラフ付きのxlsxデータシートを構築。
*   **インプット**: `data_array (JSON-Array)`, `sheet_format_config (JSON)`
*   **アウトプット**: `xlsx_file_url (String)`

### ⑨ Website Node (LP・コーポレートWebサイト生成)
*   **用途**: Tailwind CSS / Reactで構成された審美性の高い静的・動的Webページコードの自動執筆。
*   **インプット**: `design_specifications (JSON)`, `app_features (String)`
*   **アウトプット**: `source_code_files (JSON-Array)`, `preview_url (String)`

### ⑩ App Node (Web/AIアプリ・システム生成)
*   **用途**: CRUD対応管理画面、顧客管理システム、AIツールSaaSなどのフロント/バックエンドフルコード生成。
*   **インプット**: `database_schema (JSON)`, `functional_requirements (String)`
*   **アウトプット**: `full_stack_repository (JSON-Array)`

### ⑪ Export Node (成果物・ZIP圧縮エクスポート)
*   **用途**: ワークフローで作成された全物理ファイル（Excel, PPT, HTMLコード等）を1枚のZIPファイルへパッキング・保存。
*   **インプット**: `input_files (JSON-Array/Urls)`
*   **アウトプット**: `packed_zip_url (String)`, `notification_sent (Boolean)`

---

## 5. プリセット・ワークフロー・テンプレート

ユーザーがマーケットプレイスから1クリックでロードして使える、10の超強力な「自動連携パッケージ」。

1.  **一般検索 & 統合回答フロー**
    *   `Input (質問)` ➔ `Search (Web/AI検索)` ➔ `Analysis (要約＆コンセンサス)` ➔ `Export (PDF出力)`
2.  **Deep Research 市場調査・比較報告ライン**
    *   `Input (業界名)` ➔ `Research (業界調査)` ➔ `Analysis (比較マトリクス)` ➔ `Spreadsheet (Excel料金比較)` ➔ `Presentation (PPTスライド作成)`
3.  **AIO / AI検索最適化診断フロー**
    *   `Input (自社URL)` ➔ `Search (AI検索露出調査)` ➔ `Analysis (AI引用確率・改善分析)` ➔ `Document (改善定義書PDF)`
4.  **SEO診断・コンテンツ自動量産ライン**
    *   `Input (対象KW)` ➔ `Search (競合上位SEOサイトクローリング)` ➔ `Analysis (KWギャップ分析)` ➔ `Document (高品質SEO記事構成案Wordファイル)`
5.  **MEO最適化・星評価改善ロードマップ**
    *   `Input (店舗名/業種/地域)` ➔ `Search (Maps順位＆競合口コミ抽出)` ➔ `Analysis (センチメント・課題診断)` ➔ `Document (MEO改善ロードマップ＆返信テンプレPDF)`
6.  **営業提案書 ＆ 競合分析一挙自動作成フロー**
    *   `Input (クライアント会社情報)` ➔ `Research (顧客課題調査)` ➔ `Analysis (SWOT/強み定義)` ➔ `Presentation (営業提案スライドPPTX)`
7.  **アプリ要件定義 ＆ データベーススキーマ設計ライン**
    *   `Input (アプリ要件)` ➔ `Analysis (アクター/CRUD設計)` ➔ `Document (要件定義書PDF)` ➔ `App (データベース定義SQL & CRUDモックコード生成)`
8.  **Webサイト（LP）プロトタイプ自動検証ライン**
    *   `Input (LP制作仕様)` ➔ `Website (Tailwind対応HTMLコード生成)` ➔ `Agent (自己修復型コンパイル検証QA)` ➔ `Export (LP_Ver3.zip成果物出力)`

---

## 6. 将来拡張設計 (Future Extensibility Plan)

ワークフロー・ビルダーが、企業の基幹RPA、エンタープライズオートメーション、および外部SaaS接続のハブとなるためのロードマップ。

### ① 外部SaaS・Webhooksトリガーとの双方向連携
*   **API / Webhook 受信 Node (Incoming Webhooks)**:
    ユーザーが画面上で実行ボタンを押さなくても、外部のSalesforce、kintone、HubSpotなどの顧客ステータスが「商談化」に変更されたことをWebhook検知してワークフローを自動起動。
*   **外部通知・保存 Node (Slack / Teams / Google Drive)**:
    ワークフローの最後に「Export Node」から直接「Google Driveの指定フォルダへ自動アップロード」「社内Slackのプロジェクトチャンネルに完了報告とPDFリンクをAIが自動投稿」といったエンタープライズな同期処理をシームレスに行えるように設計します。

### ② 条件分岐（If-Else Node）および繰り返し（Loop Node）の追加
*   **条件分岐 (Branch Node)**:
    「MEO検索 Node」で自社店舗のMEO評価が「競合平均より低い（If-Else）」と判定された場合のみ、「改善提案PPT生成」に進み、評価が「正常」な場合は「定期MEO監視Excel出力」に進むといった、複雑なロジカル分岐をビジュアルに構築可能にします。
*   **バッチ繰り返し (Foreach Loop Node)**:
    「100店舗分のExcelリスト」を入力し、各店舗名に対して「MEO診断 Node」「改善PDF生成 Node」を1店舗ずつループで並行実行（最大20並行）し、最終的に100件のPDFを1枚のZIPにまとめて出力するような、超大規模バッチ並行処理エンジンへの拡張を見据えたアーキテクチャ設計を行います。
