# Personal AI OS 機能設計仕様書

本書は、AI Workspaceを、ユーザー個人のビジネス、思考、開発、および日々のオペレーションを極限までエンパワーする**「Personal AI OS（パーソナル AI オーエス）」**へと進化させるための全体システムアーキテクチャ、データベーススキーマ、AIエージェント構成、ビジュアル画面設計を定義した最上位の製品設計仕様書です。

単なる便利ツールの集合体（SaaS）ではなく、ユーザーの過去の行動履歴、作成物、思考を暗記する「AI Memory」、自律的に目標を分解し計画を推進する「AI Planner」を脳幹に配し、6つの特化型AI役割（秘書、参謀、開発、マーケ、営業、リサーチ）が有機的に協調・連動する「自律稼働型OS」として機能します。

---

## 1. システム全体構成 ＆ AI自律調停アーキテクチャ

Personal AI OSは、最下層の永続ストレージ（データベース・ファイル）から、中核のAI Memory、自律スケジューラー、そして最上位の調停レイヤー（AI Router）を介して、各特化型AIチームへタスクを動的にルーティングする構造を持ちます。

```
                       +---------------------------------------------------+
                       |              Personal AI OS ホーム画面            |
                       | (予定、案件、通知、AI提案、タスク、市場・ニュース) |
                       +-------------------------┬-------------------------+
                                                 │ ユーザーの指示・目標
                                                 ▼
                       +---------------------------------------------------+
                       |         AI Router & Orchestrator (調停層)         |
                       |       (LLM Router: Gemini, Claude, GPT-4o)        |
                       +---------┬───────────────────────┬-----------------+
                                 │                       │
      ┌──────────────────────────┼───────────────────────┼──────────────────────────┐
      ▼                          ▼                       ▼                          ▼
+-------------+            +-------------+         +-------------+            +-------------+
|  AI Memory  |            |  AI Planner |         | Automation  |            | Project &   |
|  (過去案件/ |            |  (目標設定/ |         | Center      |            | Knowledge   |
|  レポート/  |            |  ロードMAP/ |         | (定常自律/  |            | Hub         |
|  成果物学習)|            |  実行計画)  |         | 定期監視)   |            | (ファイル)  |
+-------------+            +-------------+         +-------------+            +-------------+
                                 │
                                 ▼ 【6大特化AI役割（自律エージェント群）】
      ┌──────────────────────────┼───────────────────────┬──────────────────────────┐
      │                          │                       │                          │
      ▼                          ▼                       ▼                          ▼
+-------------+            +-------------+         +-------------+            +-------------+
|   AI秘書    |            |   AI参謀    |         |  AI開発チーム|            | AIマーケ &  |
| (スケジュール|            | (意思決定/  |         | (アプリ/Web  |            | 営業チーム  |
|  /優先順位) |            |  リスク分析)|         |  コード生成) |            | (AIO/SEO/   |
|             |            |             |         |             |            |  提案書作成)|
+-------------+            +-------------+         +-------------+            +-------------+
```

### 🧠 OSとしての自律機能連動
1.  **AI Memory（脳）**:
    Knowledge Hub、Projects System、および過去のすべてのチャット、成果物、MEO/SEO分析結果をセマンティックに記憶。エージェントが駆動する際、自動的にコンテキストをロードします。
2.  **AI Planner（自律推進役）**:
    ユーザーが設定した長期目標（例：「3ヶ月以内に新宿のカフェ集客を倍にする」）から、ロードマップと日々の実行タスクを逆算。
    「今日やるべきこと」に自動変換して、AI秘書やAutomation Centerに登録します。

---

## 2. 6大特化AIエージェント構成 (Core AI Agent Teams)

OS内部で自律稼働する6つの専門AIチームの役割、インプット、使用ツール、および最終成果物。

### ① AI秘書 (The Secretary)
*   **役割**: スケジュール管理、タスク整理、優先順位提案、期限管理。
*   **ツール連携**: Google Calendar、Google Tasks、内部タスク・プロジェクトテーブル。
*   **成果**: 「今日のタスク優先順位リマインド」「カレンダーの自動プロビジョニング・バッファ確保」「遅延タスクの警告」。

### ② AI参謀 (The Chief Strategy Officer)
*   **役割**: 意思決定支援、事業分析、リスク分析、3C/SWOT自律フレームワーク展開、競合マクロ状況の評価。
*   **ツール連携**: Deep Research Node, SWOT Generator, 財務/市場データベース。
*   **成果**: 「リスク分析書」「経営戦略シナリオ比較」「Go-To-Marketロードマップ」。

### ③ AI開発チーム (The Development Team)
*   **役割**: アプリケーション制作、静的Webサイト構築、コード自律生成、コンパイル、QAテスト、バグ自己修復。
*   **ツール連携**: App Builder Pro, Website Builder Pro, Sandbox Compiler Engine, ESLint/TypeScript Checker.
*   **成果**: 動作保証済みのフルスタックリポジトリZIP、コンパイル完了済みのLP、DBマイグレーションSQL。

### ④ AIマーケティングチーム (The Marketing Team)
*   **役割**: AIO（AI検索）露出分析、SEO検索順位最適化、MEO地域マップ露出対策、競合動向・SNS・広告分析、CVR改善提案。
*   **ツール連携**: Search Engine Crawler, Google Maps Scraper, SNS API, SEO Content Writer.
*   **成果**: 「AIO適合レポート」「MEOキーワード診断報告書」「SNS/ブログ自動投稿用の下書き原稿」。

### ⑤ AI営業チーム (The Sales Team)
*   **役割**: 会社情報リサーチに基づく営業資料・提案スライド自動作成、営業攻略ターゲット設計、顧客心理分析、見積書・提案書構築、案件管理。
*   **ツール連携**: Presentation Builder, Proposal Document Node, kintone/HubSpot API.
*   **成果**: PowerPoint提案書 (.pptx)、PDF仕様提案書、顧客アプローチリスト。

### ⑥ AIリサーチチーム (The Research Team)
*   **役割**: 超広範囲Webクローリング、学術論文/特許/競合ニュース検索、競合価格/機能比較、調査結果のマルチアングル要約、PDF報告書出力。
*   **ツール連携**: Deep Research Web Scraper, Perplexity Router, Vector DB Indexer.
*   **成果**: 深層調査レポート、競合機能比較Excel、要約音声スクリプト。

---

## 3. 画面設計 (UI/UX Canvas Layouts)

Personal AI OSは、1画面で「現在地、直近のAIの提案、稼働中のAI社員チーム、および今日の予定」を統合的に把握できるコックピットUIを提供します。

### 画面 A: パーソナル AI OS ホーム画面 (Dashboard Desktop)
パーソナルOSのメイン画面。朝一番に起動し、ビジネス全体の動向、AIからの能動的アドバイス、進行タスク、スケジュールを一挙に俯瞰・操作するコックピット。

```
+----------------------------------------------------------------------------------------------------+
| [🧠 Personal AI OS] 📅 2026年6月25日 (木) 12:30 | 👤 山田 太郎 [管理者]                  [🔍 検索...] |
+----------------------------------------------------------------------------------------------------+
| < 🎯 AI参謀・本日の戦略提案 (Autonomous AI Suggestion Banner) >                                     |
| 📢 **AI提案**: 新宿駅南口周辺で「深夜作業カフェ」の検索需要が昨日比で+35%上昇しています。           |
|            現在プロジェクトで進行中の「La Lounge LP」に「新宿南口駅 徒歩3分」の記述を追加し、      |
|            MEO最適化を再実行することを推奨します。  [👉 AIに自動修正 ＆ LP再ビルドを指示する]        |
+----------------------------------------------------------------------------------------------------+
| < LEFT: カレンダー ＆ タスク (AI秘書エリア) >       | < CENTER: 案件進行 ＆ 稼働AI (OS Operations) >         |
|                                                    |                                                |
|  📅 今日の予定 (Schedule)                          |  🚀 進行中の重要プロジェクト (Projects)         |
|  - [13:00-14:00] La Lounge 新宿3丁目 テナント確認  |  ├─ 🚀 新宿個室カフェ La Lounge 出店計画        |
|  - [15:00-16:00] LP構成・SEO戦略 AIプレビュー      |  │  ├─ 進捗: [|||||||||||||||         ] 65%    |
|                                                    |  │  └─ 🤖 稼働AI: Marketing & Web Builder Agent|
|  ⏳ 未完了案件・タスク (Priority Tasks)            |  └─ 📊 SaaS販売営業資料・提案書作成             |
|  - [🚨] 1. LP用キャッチコピーの最終確定            |     ├─ 進捗: [||||||||||||||||||||||||] 100%   |
|  - [📅] 2. 競合14店舗の最新口コミ推移Excel化 (27日)|     └─ 🤖 稼働AI: Sales Agent (提案書生成完了)  |
|  - [ ]  3. MEO用Googleビジネスプロフィール開設     |                                                |
|                                                    |  📡 市場変化・最新トレンドニュース (MEO/SEO)   |
|  👤 AI秘書メモ:                                    |  - Google Mapsが深夜フィルターのUIを変更 (MEO)  |
|  「La Loungeテナント確認に間に合うよう、           |  - 新宿三丁目エリアの深夜人流が前月比12%増 (ニュース)|
|    12:45にスマートアラートを鳴らします。」        |                                                |
+----------------------------------------------------+------------------------------------------------+
| < RIGHT: AI Dashboard ＆ コスト ＆ ROI >                                                            |
|  🧠 **稼働中のAI社員チーム**:                                                                       |
|  [🔍 リサーチャー] (検索完了) ➔ [📊 アナリスト] (SWOT分析中) ➔ [📝 提案プランナー] (待機)             |
|                                                                                                    |
|  💸 **リソース消費 ＆ 投資対効果 (AI ROI Metrics)**:                                                 |
|  - 今月のAPIコスト: **$14.20** | 削減人工: **15.4人日** | 推定アウトソーシング削減費: **約32万円**      |
|  - AI平均成功率: **98.4%**   | 利用上位脳: Claude 3.5 (45%), Gemini Pro (30%), GPT-4o (25%)    |
+----------------------------------------------------------------------------------------------------+
```

### 画面 B: AI Planner & Memory コパイロット (Interactive Strategy Map)
目標を設定すると、AIが自律的にロードマップを分解し、過去の成功ナレッジや競合データを引き出しながら、実行計画をビジュアル構成する戦略室画面。

```
+----------------------------------------------------------------------------------------------------+
| [Personal AI OS] > 🧭 AI Planner & Memory コパイロット (Interactive Strategy Canvas)               |
+----------------------------------------------------------------------------------------------------+
| < LEFT: 目標設定 ＆ ロードマップ計画 >             | < RIGHT: AI Memory 過去類似アセット・ナレッジ連携 >    |
|                                                    |                                                |
|  🎯 設定目標 (Objective)                            |  🧠 連動する AI Memory (Semantic Context)       |
|  [ 3ヶ月以内に新宿エリアでの深夜カフェ検索露出を3倍 ]|  過去のレポート、他案件の成功資料から最適ナレッジを吸い出し：|
|                                                    |                                                |
|  📅 ロードマップ（AI Plannerが自動タスク分解）      |  ├─ 📄 **類似成功アセット**:                    |
|  - **Phase 1: 競合リサーチとポジショニング**       |      `渋谷深夜カフェ集客LP_SEO報告書.pdf`       |
|    ├─ [✅] 新宿周辺カフェ14店舗のMEOクローリング   |      (Altタグ徹底とFAQ Schema埋込で露出50%増)    |
|    └─ [✅] SWOT/3C競合比較マトリクス分析           |                                                |
|                                                    |  ├─ 📄 **プロジェクト関連ファイル**:            |
|  - **Phase 2: 露出チャネル構築 (Now)**              |      `新宿3丁目テナント間取り図.png`             |
|    ├─ [⏳] 防音個室・電源完備をアピールしたLP制作  |      (完全防音・電源完備は最大の訴求資産)       |
|    └─ [ ] GoogleビジネスプロフィールMEO初期登録   |                                                |
|                                                    |  └─ 📁 **Knowledge Hub フォルダ**:              |
|  - **Phase 3: 自動運用 ＆ 自律最適化**              |      `MEO対策ノウハウ・FAQ構築テンプレート`     |
|    ├─ [ ] 毎週のMEO順位クローリング自動化          |                                                |
|    └─ [ ] AIによる週次ブログ自律公開               |  [💬 過去の渋谷カフェ案件のLPデザインカラーを  |
|                                                    |    今回の新宿La Lounge LPのテーマ色に適用して」] |
+----------------------------------------------------+------------------------------------------------+
| [🔄 ロードマップに従って、Phase 2 の「LP自動制作 (Website Builder)」をエージェントに起動指示する]   |
+----------------------------------------------------------------------------------------------------+
```

---

## 4. データベース設計 (Data Schema Design)

ユーザーの予定、タスク、長期目標、ロードマップ、AI Memoryのベクトルインデックス参照、およびROIコスト管理を一元化するためのリレーショナルスキーマ。

```
                  +---------------------------+
                  |         os_users          |
                  +---------------------------+
                  | id (PK)                   |
                  | name                      |
                  | user_role                 |
                  | base_preference_json(JSON)|
                  | created_at                |
                  +-------------+-------------+
                                | 1
                                |
                                ├─────────────────────────────┐
                                | 1..N                        | 1..N
                  +-------------v-------------+   +------------v------------+
                  |         os_goals          |   |       os_schedules      |
                  +---------------------------+   +-------------------------+
                  | id (PK)                   |   | id (PK)                 |
                  | user_id (FK)              |   | user_id (FK)            |
                  | title                     |   | title                   |
                  | target_description        |   | start_time              |
                  | target_date               |   | end_time                |
                  | progress_percent (INT)    |   | description             |
                  | created_at                |   | status                  |
                  +-------------+-------------+   +-------------------------+
                                | 1
                                |
                                | 1..N
                  +-------------v-------------+   +-------------------------+
                  |      os_roadmap_steps     |   |      os_ai_memories     |
                  +---------------------------+   +-------------------------+
                  | id (PK)                   |   | id (PK)                 |
                  | goal_id (FK)              |   | user_id (FK)            |
                  | step_name                 |   | memory_key (VARCHAR)    |
                  | order_num (INT)           |   | source_table (VARCHAR)  |
                  | status (PENDING/ACTIVE/ok)|   | source_id (UUID)        |
                  | action_type               |   | summary_tokens (TEXT)   |
                  | action_ref_id (UUID)      |   | vector_index_id         |
                  +-------------+-------------+   | last_accessed_at        |
                                | 1               +-------------------------+
                                |
                                | 0..N
                  +-------------v-------------+   +-------------------------+
                  |         os_tasks          |   |     os_ai_roi_logs      |
                  +---------------------------+   +-------------------------+
                  | id (PK)                   |   | id (PK)                 |
                  | step_id (FK, Nullable)    |   | run_id (UUID)           |
                  | project_id (FK, Nullable) |   | agent_type (VARCHAR)    |
                  | title                     |   | api_tokens_used (INT)   |
                  | priority (LOW/MED/HIGH)   |   | execution_cost_usd      |
                  | due_date                  |   | manual_saved_hours      |
                  | status (TODO/DOING/DONE)  |   | created_at              |
                  +---------------------------+   +-------------------------+
```

### テーブル定義詳細

#### ① `os_users` (OSユーザー基本台帳)
*   `id`: UUID (Primary Key)
*   `name`: VARCHAR(255) (ユーザー名)
*   `user_role`: VARCHAR(100) (管理者、一般等)
*   `base_preference_json`: JSON (UIテーマ、好みのフォント、自動実行の承認ポリシーなど)

#### ② `os_schedules` (カレンダー予定管理テーブル)
AI秘書が監視・調整するカレンダーの基本。
*   `id`: UUID (Primary Key)
*   `user_id`: UUID (Foreign Key)
*   `title`: VARCHAR(255) (予定タイトル。例: 「新宿3丁目 テナント確認」)
*   `start_time` / `end_time`: TIMESTAMP (予定の開始、終了時刻)
*   `description`: TEXT (予定の詳細、場所、リンク)
*   `status`: VARCHAR(50) (`CONFIRMED`, `TENTATIVE`, `AI_BUFFER` (AIが自動確保した作業集中用の空き時間枠))

#### ③ `os_goals` (AI Planner 長期目標)
*   `id`: UUID (Primary Key)
*   `user_id`: UUID (Foreign Key)
*   `title`: VARCHAR(255) (目標名。例: 「3ヶ月以内に新宿深夜カフェ検索露出を3倍」)
*   `target_description`: TEXT (目標の定性・定量的な成功定義)
*   `target_date`: DATE (目標達成期限日)
*   `progress_percent`: INT (目標全体の完了進捗率。0〜100%)

#### ④ `os_roadmap_steps` (ロードマップ・Phase分解テーブル)
AI Plannerが目標から逆算して自動生成したロードマップの各Phase。
*   `id`: UUID (Primary Key)
*   `goal_id`: UUID (Foreign Key)
*   `step_name`: VARCHAR(255) (Phase名。例: 「Phase 2: 露出チャネル構築 (LP制作等)」)
*   `order_num`: INT (ステップ順序。`1`, `2`, `3`...)
*   `status`: VARCHAR(50) (状態。`PENDING`, `ACTIVE`, `COMPLETED`)
*   `action_type`: VARCHAR(100) (紐付ける自動処理形式。`WORKFLOW_RUN`, `AGENT_RUN`, `WEBSITE_BUILD`)
*   `action_ref_id`: UUID (紐付け先アセットのレコードID)

#### ⑤ `os_tasks` (タスク管理テーブル)
ロードマップの各Phase、または個別のプロジェクトに所属する「行動タスク」。
*   `id`: UUID (Primary Key)
*   `step_id`: UUID (Foreign Key, Nullable - ロードマップのPhaseに属する場合に紐付け)
*   `project_id`: UUID (Foreign Key, Nullable - プロジェクト管理機能に属する場合に紐付け)
*   `title`: VARCHAR(255) (タスク内容。例: 「防音個室をアピールした集客LP制作」)
*   `priority`: VARCHAR(50) (優先度。`LOW`, `MEDIUM`, `HIGH`)
*   `due_date`: DATE (タスク期限)
*   `status`: VARCHAR(50) (`TODO`, `DOING`, `DONE`)

#### ⑥ `os_ai_memories` (AI Memory セマンティック参照インデックス)
過去の成果物やレポートを、いつ、だれが、どのように参照したか、およびベクトルDBへの接続キー。
*   `id`: UUID (Primary Key)
*   `user_id`: UUID (Foreign Key)
*   `memory_key`: VARCHAR(255) (セマンティックキー。例: `shibuya_cafe_seo_success`)
*   `source_table`: VARCHAR(100) (参照元データベーステーブル名。例: `website_pages`, `knowledge_entries`)
*   `source_id`: UUID (参照元レコードID)
*   `summary_tokens`: TEXT (データの要旨を事前に要約した高密度コンテキストトークン)
*   `vector_index_id`: VARCHAR(255) (ベクター検索インデックス用のID)
*   `last_accessed_at`: TIMESTAMP

#### ⑦ `os_ai_roi_logs` (AI ROI ＆ APIコストログ)
*   `id`: UUID (Primary Key)
*   `run_id`: UUID (Nullable - 実行されたオートメーションやエージェントのUUID)
*   `agent_type`: VARCHAR(100) (稼働エージェント役割。`SECRETARY`, `STRATEGIST`, `DEVELOPER`, `MARKETER`)
*   `api_tokens_used`: INT (使用したAPI合計トークン数)
*   `execution_cost_usd`: DECIMAL(10,4) (米ドル換算の概算消費コスト)
*   `manual_saved_hours`: DECIMAL(6,2) (人間が手動で行った場合にかかっていたはずの想定時間。ROI算出用)
*   `created_at`: TIMESTAMP

---

## 5. 将来拡張設計 (Future Extensibility Plan)

Personal AI OSが、真の自律型オペレーティングシステムとしてパーソナルビジネスの主権を完全にサポートするためのロードマップ。

### ① 音声双方向Live API ＆ リアルタイム音声AI秘書 (Interactive Voice OS Agent)
*   **ハンズフリー対話インターフェース**:
    ブラウザやスマートフォンのマイクを通じた、超低遅延（~100ms）の音声Live API接続を確立。
*   歩きながら、または移動中に「今日のLa LoungeプロジェクトのMEO順位を口頭で教えて」「今日のカレンダーの空き時間に、MEO対策を考える時間を1時間自動で入れておいて」と話しかけるだけで、AI秘書が音声を解釈、カレンダー調整やデータ読み出しを完全自律実行し、耳元のイヤホンで自然な音声合成（TTS）で回答する「常時接続音声OS」を構築します。

### ② 自律経済・セルフ決済連携 (Autonomous Wallet Integration)
*   **AIによるAPI利用やドメイン購入のセルフ自律決済**:
    AI開発チームやWebサイトビルダーが、新しくWebサービスを構築した際、ドメイン（.com等）の空き状況確認、インフラ（ホスティング）のプロビジョニングを自律実行するために、OS内に暗号資産やクレジットカードの安全なプリペイドチャージウォレットを連携。
*   AIが「月額1,500円のホスティング料金の自動引き落とし」を自身で行い、ROIコスト（`os_ai_roi_logs`）と連動して「今月の売上利益からホスティング費用を差し引いた実質ROI」を自律評価し続ける「経済活動能力付き自律AI OS」へと拡張します。
