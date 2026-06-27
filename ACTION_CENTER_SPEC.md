# AI Workspace 「アクション・センター（Action Center）」機能設計仕様書

本書は、AI Workspaceにおけるあらゆる分析、調査、推論、および生成処理の成果物を、現実のデジタル世界（外部Webホスティング、コードレポジトリ、CMS、MEOマップ、各種SNS、クラウドドキュメント等）へ「直接デプロイ・投稿・公開・実行」するための、セキュアな外部連携コネクタ群とジョブ実行エンジンを備えた**「Action Center（アクション・センター）」**のシステム構成、データスキーマ、セキュリティ権限管理、および画面設計を定義した製品設計仕様書です。

「分析レポートを出して終わり」「コードを書いて終わり」という従来のAIの限界を突破し、AIが生成したWebサイトをGitHub/Netlify経由で直接世界へ公開し、WordPressやGoogleビジネスプロフィール（GBP）、各種SNS（Instagram, X等）へ記事や投稿を予約配信し、Google Workspace/MS Office形式の資料を自動パブリッシュする、実社会と100%接続された**「自律実行エンジン」**の役割を担います。

---

## 1. 業務フロー ＆ 実行統合コンセプト (Overview & Concept)

Action Centerは、AIエージェントやワークフローが「これを実世界に適用せよ」と要求した際、セキュアな認証トークン（OAuth 2.0 / APIキー）をマッピングし、人間による承認（Human-in-the-Loop）を経た上で、各外部APIクライアントを介して確実にデプロイや投稿を実行します。

```
                       [1. 実行リクエストの発生]
         (エージェント、自動化スケジュール、または手動からのキック)
                                  │
                                  ▼
                [2. 実行プランの構築 ＆ セキュリティ検知]
      ├─ 外部連携認証 (OAuth / API Token) の有効性チェック (Action Hub)
      └─ 権限ポリシーの照合 (リードオンリー、自動実行、人間承認必須の振り分け)
                                  │
                                  ▼
            [3. 人間承認ゲートウェイ (Human-in-the-Loop Gate)]
      ├─ アクションの内容をUI上でプレビュー（投稿文、デプロイコード、更新ファイル）
      └─ ユーザーが「承認（Approve）」 ➔ 実行フェーズへ (拒否時はロールバック・再生成)
                                  │ (承認完了)
                                  ▼
                   [4. 実行エンジン (Action Dispatcher)]
     ┌────────────────────────────┼────────────────────────────┐
     ▼                            ▼                            ▼
  【Web / App デプロイ】       【CMS ＆ MEO ＆ SNS】        【Documents / Mail】
  - GitHubへのコミットプッシュ  - WPでの記事作成・SEO改善   - PPTX/PDFのドライブ保存
  - Netlifyへの自動公開        - GBPへの投稿・レビュー返信 - Slack/Discord/メール配信
  - Appのサンドボックス反映    - X, Instagram等の予約投稿   - Webhookキック
     │                            │                            │
     └────────────────────────────┼────────────────────────────┘
                                  ▼
                     [5. 実行履歴 ＆ 監査 (Execution Log)]
      ├─ API実行結果（ステータスコード、外部参照URL）の記録
      └─ エラー発生時の「自己修復・エラー改善パイプライン」へのシグナル送信
```

---

## 2. 画面設計 (UI/UX Canvas Layouts)

すべてのダッシュボード、連携設定、承認待機コンソール、および実行ログ画面は、モバイルに完全対応し、流麗なアニメーション遷移（motion/react想定）と洗練されたダーク/ライトテーマに対応しています。

### 画面 A: 外部インテグレーション管理ハブ (Action Integrations Hub)
GitHub、Netlify、WordPress、Googleビジネスプロフィール、および各種SNS（X, Instagram等）とのOAuth接続状態、トークン有効期限、および各連携に許可されたセキュリティ権限を一覧・制御する管理画面。

```
+----------------------------------------------------------------------------------------------------+
| [AI Workspace]  🔌 アクション・センター > 🔗 外部サービス連携・インテグレーション                  |
+----------------------------------------------------------------------------------------------------+
| < TOP CARDS: 外部接続ステータスサマリー >                                                           |
| +---------------------+ +---------------------+ +---------------------+ +---------------------+ |
| | 🔗 接続済サービス:    | | ⏳ 承認待ちジョブ:    | | 📈 実行成功率 (当月): | | 💸 連携API呼出回数:  | |
| |       **8 件 / 12件** | |       **2 件**      | |       **99.4 %**    | |       **1,240 回**  | |
| +---------------------+ +---------------------+ +---------------------+ +---------------------+ |
+----------------------------------------------------------------------------------------------------+
| ✨ 外部連携サービス一覧 (Connected Services & Permissions)                                         |
|                                                                                                    |
|  +-----------------------------------------------------------------------------------------------+ |
|  | [🟢 接続中]  🐙 GitHub (レポジトリ・コード管理)                                          [⭐] | |
|  | **アカウント**: `yamp-github` | **スコア範囲**: `repo`, `write:packages`                      | |
|  | **許可ポリシー**: (◉) ユーザー承認後に実行可能  ( ) 完全自動実行を許可  ( ) 停止              | |
|  | [⚙️ 権限を再設定] [🔌 接続を解除] [🕒 GitHub実行ログを表示]                                     | |
|  +-----------------------------------------------------------------------------------------------+ |
|                                                                                                    |
|  +-----------------------------------------------------------------------------------------------+ |
|  | [🟢 接続中]  🗺️ Google Business Profile (店舗MEO・口コミ管理)                                   | |
|  | **アカウント**: `Lounge Shinjuku GBP` | **対象店舗**: 新宿La Lounge                              | |
|  | **許可ポリシー**: ( ) ユーザー承認後に実行可能  (◉) 完全自動実行を許可 (レビュー自動返信) ( ) 停止 | |
|  | [⚙️ 権限を再設定] [🔌 接続を解除] [🕒 GBP実行ログを表示]                                       | |
|  +-----------------------------------------------------------------------------------------------+ |
|                                                                                                    |
|  +-----------------------------------------------------------------------------------------------+ |
|  | [🔴 未接続]  📝 WordPress (自社ブログ・お知らせCMS)                                            | |
|  | **説明**: 接続すると、AIマーケターがSEO最適化されたブログやお知らせを直接予約投稿できます。      | |
|  | [🔗 WordPressにOAuth2.0で安全に接続する]                                                        | |
|  +-----------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
```

### 画面 B: 自律実行タスク・承認 ＆ ディスパッチャー (Action Dispatcher Sandbox)
エージェントやオートメーションから発行されたデプロイ・投稿要求のうち、「人間承認必須」に設定されているジョブの内容を、実行前にその場でプレビュー検証・編集し、1クリックでデプロイ承認するワークスペース。

```
+----------------------------------------------------------------------------------------------------+
| [Action Center] > 📋 実行承認・プレビュー検証 (Action Dispatcher Sandbox)                           |
+----------------------------------------------------------------------------------------------------+
| < LEFT: 承認待機ジョブ一覧 (Pending Queue) >       | < CENTER: 実行内容・プレビュー (Interactive Preview) > |
|                                                    | +------------------------------------------------------------+ |
|  +----------------------------------+  | | **[ Netlify 公開デプロイプランのプレビュー ]**             | |
|  | 🌐 Netlifyデプロイ (#142)         |  | | **対象プロジェクト**: 新宿個室カフェ La Lounge 公式サイト  | |
|  | [新宿LPコード公開デプロイ待ち]   |  | | **出力フレームワーク**: Next.js (App Router / Tailwind CSS) | |
|  +----------------------------------+  | | **差分パッチ (Commit Diff)**:                               | |
|  +----------------------------------+  | |  `index.tsx`:                                              | |
|  | 🗺️ GBP店舗お知らせ投稿 (#143)      |  | |  + <h1 className="text-4xl text-cyan-400">                 | |
|  | [「新宿深夜カフェ La Lounge」投稿] |  | |  +   深夜の新宿、五感を研ぎ澄ます12の防音個室カフェ        | |
|  +----------------------------------+  | |  + </h1>                                                 | |
|  +----------------------------------+  | |  + <p>新宿三丁目駅 徒歩3分。全席電源・Wi-Fi完備...</p>      | |
|  | 📱 Instagram 予約投稿 (#144)      |  | |                                                            | |
|  | [「防音個室の内観画像」カルーセル] |  | | **🔍 AI Lighthouse 公開前速度診断結果**: **98 / 100** (A+) | |
|  +----------------------------------+  | +------------------------------------------------------------+ |
|                                        +----------------------------------------------------------------+
|  [⏳ 処理保留] [⏹️ ジョブを却下・再生成] | < RIGHT: 実行エージェント ＆ 宛先設定 (Execution Settings) >   |
|                                        |  🐙 **コミット先 GitHub**:                                     |
|                                        |  `https://github.com/yamp/lalounge-nextjs/tree/main`           |
|                                        |  🌐 **公開 Netlify URL (Production)**:                         |
|                                        |  `https://lalounge-shinjuku.netlify.app`                       |
|                                        |                                                                |
|                                        |  [✏️ 「ファーストビューの文字サイズを少し大きくして再ビルド」] |
+----------------------------------------+----------------------------------------------------------------+
| [❌ 実行プラン却下]                                    [🚀 この内容で GitHubにコミット ＆ Netlifyに即時デプロイ！] |
+----------------------------------------------------------------------------------------------------+
```

### 画面 C: リアルタイム実行履歴 ＆ 失敗分析監査ログ (Execution Log Console)
これまでに実行されたすべてのアクションのステータス、成功率、消費されたAPIレイテンシ、および外部URLの証跡を監視するデバッグ監査画面。

```
+----------------------------------------------------------------------------------------------------+
| [Action Center] > 🕒 実行履歴 ＆ 監査ログ (Job Execution Log: Job #1422)                            |
+----------------------------------------------------------------------------------------------------+
| < LEFT: 履歴リストとフィルタリング >                | < RIGHT: ジョブ実行詳細タイムライン ＆ レスポンスデータ >     |
|                                                    |                                                |
|  🔍 サービス・結果でフィルター                      |  📋 ジョブ実行詳細 (Execution Details)          |
|  [■] 成功  [ ] 失敗  [ ] 進行中                     |  - **ジョブID**: `#1422`                       |
|  - サービス: [ すべてのサービス                 ▼ ] |  - **アクション名**: 🗺️ GBP 口コミ自動返信      |
|                                                    |  - **実行日時**: 2026/06/25 05:40:12 (ローカル) |
|  🕒 直近の実行ジョブ一覧                            |  - **実行モード**: 完全自動 (トリガー起動)     |
|  - [✅ 成功] 2026/06/25 05:40 | GBP口コミ返信 (#1422)  |  - **ステータス**: ✅ 成功 (HTTP 200 OK)        |
|  - [✅ 成功] 2026/06/25 02:00 | X (Twitter) 投稿 (#1421)|                                                |
|  - [✅ 成功] 2026/06/24 23:00 | Netlifyデプロイ (#1420)|  🌐 **外部APIレスポンスログ (API Response)**:   |
|  - [⚠️ 失敗] 2026/06/24 15:00 | Instagram投稿 (#1419)  |  ```json                                       |
|    └─ 原因: 画像フォーマット（アスペクト比）違反    |  {                                             |
|                                                    |    "reviewId": "rev_shinjuku_9421",            |
|  📊 サービス別当月成功率                           |    "replyText": "口コミありがとうございます...",   |
|  - GitHub / Netlify:  **100%** (24回中24回成功)    |    "updateTime": "2026-06-25T05:40:12Z",       |
|  - WordPress:         **98.2%** (50回中49回成功)   |    "status": "PUBLISHED"                       |
|  - Google Business:   **100%** (12回中12回成功)    |  }                                             |
|  - SNS (X / Insta):   **94.5%** (80回中76回成功)    |  ```                                           |
+----------------------------------------------------+------------------------------------------------+
```

---

## 3. データベース・スキーマ設計 (Data Schema Design)

外部サービス接続情報、安全な暗号化認証トークン、発行された実行ジョブ、各APIコールの詳細監査ログ、およびセキュリティ権限スコープを管理するリレーショナル・スキーマ。

```
                  +---------------------------+
                  |    action_integrations    |
                  +---------------------------+
                  | id (PK)                   |
                  | company_id (FK, Nullable) |
                  | user_id (FK, Nullable)    |
                  | service_name (GH, WP, etc)|
                  | auth_type (OAUTH, APIKEY) |
                  | encrypted_access_token    |
                  | encrypted_refresh_token   |
                  | token_expires_at          |
                  | base_config_json (JSON)   |
                  | status (ACTIVE, REVOKED)  |
                  | created_at                |
                  +-------------+-------------+
                                | 1
                                |
                                ├─────────────────────────────┐
                                | 1..N                        | 1..N
                  +-------------v-------------+   +------------v------------+
                  |        action_jobs        |   |    action_permissions   |
                  +---------------------------+   +-------------------------+
                  | id (PK)                   |   | id (PK)                 |
                  | integration_id (FK)       |   | integration_id (FK)     |
                  | project_id (FK, Nullable) |   | scope_name (write, etc) |
                  | task_name (VARCHAR)       |   | execution_policy        |
                  | requested_by_agent (FK)   |   | (MANUAL_APPROVAL, AUTO) |
                  | payload_data_json (JSON)  |   +-------------------------+
                  | preview_summary (TEXT)    |
                  | status (PENDING, RUN, ok) |
                  | approval_user_id (Nullable|
                  | approved_at (Nullable)    |
                  | created_at                |
                  +-------------+-------------+
                                | 1
                                |
                                | 1..N
                  +-------------v-------------+
                  |    action_execution_logs  |
                  +---------------------------+
                  | id (PK)                   |
                  | job_id (FK)               |
                  | raw_request_payload (TEXT)|
                  | raw_response_payload (TEXT|
                  | http_status_code (INT)    |
                  | execution_duration_ms     |
                  | is_success (Boolean)      |
                  | error_reason_code         |
                  | created_at                |
                  +---------------------------+
```

### テーブル定義詳細

#### ① `action_integrations` (外部サービス接続管理マスタ)
*   `id`: UUID (Primary Key)
*   `company_id`: UUID (Foreign Key, Nullable - 組織単位の接続用)
*   `user_id`: VARCHAR(100) (Foreign Key, Nullable - 個人に紐づく接続用)
*   `service_name`: VARCHAR(100) (外部サービス識別。`GITHUB`, `NETLIFY`, `WORDPRESS`, `GOOGLE_BUSINESS`, `INSTAGRAM`, `X_TWITTER`, `SLACK`, `DISCORD`, `GWORKSPACE`)
*   `auth_type`: VARCHAR(50) (認証方式。`OAUTH2`, `API_KEY`, `SESSION_COOKIE`)
*   `encrypted_access_token`: TEXT (暗号化されたアクセストークン)
*   `encrypted_refresh_token`: TEXT (暗号化されたリフレッシュトークン。OAuth2用)
*   `token_expires_at`: TIMESTAMP (アクセストークンの有効期限日時)
*   `base_config_json`: JSON (接続固有の環境設定。例: GitHubの対象組織、WordPressの接続URL、GBPの対象店舗ID)
*   `status`: VARCHAR(50) (ステータス。`ACTIVE`, `REVOKED` (失効), `EXPIRED` (期限切れ))
*   `created_at`: TIMESTAMP

#### ② `action_jobs` (実行ジョブマスタ)
AIエージェント等から発行された、具体的な実行タスクの命令台帳。
*   `id`: UUID (Primary Key)
*   `integration_id`: UUID (Foreign Key)
*   `project_id`: UUID (Foreign Key, Nullable - 紐付けるプロジェクトID)
*   `task_name`: VARCHAR(255) (アクション名。例: `CREATE_WP_POST`, `DEPLOY_NETLIFY_SITE`, `REPLY_GBP_REVIEW`)
*   `requested_by_agent`: VARCHAR(100) (リクエストを発行したAIエージェントのID・種別)
*   `payload_data_json`: JSON (実際に外部APIに投げるためのデータマトリクス。例: 投稿本文、画像URL、コードパッチなど)
*   `preview_summary`: TEXT (人間が承認画面でレビューするための高密度サマリー)
*   `status`: VARCHAR(50) (進捗。`PENDING_APPROVAL` (承認待ち), `QUEUED` (キュー登録済), `RUNNING`, `SUCCESS`, `FAILED`, `REJECTED` (却下))
*   `approval_user_id`: VARCHAR(100) (Nullable - 承認を承認した実ユーザーのID)
*   `approved_at`: TIMESTAMP (Nullable - 承認された時刻)
*   `created_at`: TIMESTAMP

#### ③ `action_permissions` (詳細権限・認可ポリシーテーブル)
外部サービスごとに、どのような処理を完全自動化させ、どのような処理に人間承認を挟むかを定義。
*   `id`: UUID (Primary Key)
*   `integration_id`: UUID (Foreign Key)
*   `scope_name`: VARCHAR(255) (スコープ名。例: `write:posts`, `delete:sites`, `reply:reviews`)
*   `execution_policy`: VARCHAR(100) (認可ポリシー。`MANUAL_APPROVAL` (実行の都度、人間が承認画面でApproveする必要あり), `AUTO_EXECUTE` (完全自律実行可能))

#### ④ `action_execution_logs` (API実行詳細監査ログ)
外部APIコールの成否、ヘッダー、レスポンスペイロード、およびデバッグ痕跡。
*   `id`: UUID (Primary Key)
*   `job_id`: UUID (Foreign Key)
*   `raw_request_payload`: TEXT (実際に外部APIへ送信した生のHTTPリクエスト)
*   `raw_response_payload`: TEXT (外部APIから返ってきた生のHTTPレスポンス。JSON等)
*   `http_status_code`: INT (HTTPステータスコード。例: `200`, `201`, `400`, `401`, `500`)
*   `execution_duration_ms`: INT (APIコールにかかった時間（ミリ秒）)
*   `is_success`: BOOLEAN (処理が外部側で正常に受付・パブリッシュされたか)
*   `error_reason_code`: VARCHAR(100) (失敗時のエラーコード。例: `RATE_LIMIT_EXCEEDED`, `EXPIRED_CREDENTIALS`, `MALFORMED_JSON`)
*   `created_at`: TIMESTAMP

---

## 4. 実行エンジン ＆ セキュリティ・権限管理設計 (Security & Engine)

外部サービスの実環境へ直接干渉するため、Action Centerはミリタリーグレードの暗号化セキュリティ、きめ細かな認可制御（RBAC）、および人間承認ゲートウェイを搭載します。

### ① 安全なトークンストレージ・暗号化 (Token Encryption)
*   **対称鍵暗号化 (AES-256-GCM)**:
    データベースに格納される `encrypted_access_token` および `encrypted_refresh_token` は、平文で保存することは一切ありません。
    アプリケーションサーバー内の環境変数として保持する「マスタ暗号化キー」と、レコード単位で動的に生成する「初期化ベクトル (IV)」を組み合わせ、AES-256-GCM方式で暗号化したバイナリをBase64変換して保存します。
*   **トークン自動ローテーション (Auto-Refresh Loop)**:
    アクセストークンの有効期限（`token_expires_at`）をエンジンが常時監視。有効期限の10分前になった時点で、暗号化 refresh_token を復号し、外部のOAuthトークンエンドエンドポイントに対してバックグラウンドで更新リクエストを自動送信。新たなアクセストークンを再暗号化して格納します。

### ② 人間承認ゲートウェイ (Human-in-the-Loop Gateway)
*   **安全弁としてのポリシー管理**:
    「GitHubへのプッシュ（コード破壊のリスクあり）」「SNSでの新規投稿（炎上・ブランド毀損のリスクあり）」などのアクションは、`action_permissions` テーブルによってデフォルトで `MANUAL_APPROVAL`（人間承認必須）に強制されます。
*   **通知連動**:
    ジョブが `PENDING_APPROVAL` 状態になった瞬間、オーナーのスマートフォン（プッシュ通知）や、Slackチャンネル（承認ボタン付きリッチメッセージ）へ自動連携されます。

---

## 5. 特化型実行コネクタの仕組み (Execution Connectors)

Action Centerが外部サービスと対話するための、プロトコル、ハンドシェイク、およびAPI定義。

### ① Web / App デプロイメント・コネクタ
*   **GitHub Connector**:
    *   *プロトコル*: GitHub REST API v3 / Git Plumbing API
    *   *処理フロー*:
        1. AIが作成したファイル配列をBase64エンコード。
        2. `GET /repos/{owner}/{repo}/branches/main` で最新のCommit SHAを取得。
        3. `POST /repos/{owner}/{repo}/git/trees` で新しいツリーを作成。
        4. `POST /repos/{owner}/{repo}/git/commits` で新規コミットを作成。
        5. `PATCH /repos/{owner}/{repo}/git/refs/heads/main` でブランチのポインタを移動（Fast-Forward）。
*   **Netlify Connector**:
    *   *プロトコル*: Netlify Deploy API / Webhook Integration
    *   *処理フロー*:
        1. GitHubへのプッシュ完了をトリガーに、Netlifyのビルドフック（Build Hook）URLに対してPOSTリクエストを送信。
        2. Netlify側で自律ビルド ➔ CDNデプロイが開始。
        3. デプロイ完了後、NetlifyからのWebhookを受け取り、サイトURL（` Lalounge-shinjuku.netlify.app`）の有効性をAction Centerが自動検品・履歴を「SUCCESS」へ更新。

### ② CMS ＆ MEO ＆ SNS コネクタ
*   **WordPress Connector**:
    *   *プロトコル*: WordPress REST API v2 (OAuth 2.0 / JWT Authentication)
    *   *処理*: `POST /wp-json/wp/v2/posts` へタイトル、本文HTML、SEOタグ、およびカテゴリーIDを送信。AIが「下書き（draft）」もしくは「公開（publish）」を制御。
*   **Google Business Profile (GBP) Connector**:
    *   *プロトコル*: Google Business Profile APIs (My Business Business Information / My Business Verifications)
    *   *処理*:
        *   *ローカルお知らせ投稿*: `POST /v1/accounts/{accountId}/locations/{locationId}/localPosts` へイベント、セール情報、および地域キーワードを含んだ投稿文・画像URLを送信。
        *   *口コミ（レビュー）自動返信*: GBPのレビュー追加通知Webhookを受け取った後、AIマーケターが顧客の星評価・コメントを読み、感情的に調和した返信文を作成して `PUT /v1/accounts/{accountId}/locations/{locationId}/reviews/{reviewId}/reply` を自律実行。

### ③ Documents コネクタ (MS Office / Workspace API)
*   **Google Workspace / Slide Generator**:
    *   *プロトコル*: Google Drive API v3 / Google Slides API v1
    *   *処理*: Presentation Builderが設計したスライドブロックを、Google Slidesのオブジェクト（Shape, Paragraph, Table）のバッチ更新（BatchUpdate）リクエストにコンパイルして送信。ユーザーのGoogleドライブの指定フォルダへ直接ドキュメントを配置・共有。

---

## 6. システム（OS、自動化、ツイン、ブレイン）との統合連携

Action Centerは、AI Workspace全体に「手（物理実行機能）」を提供する末端アクチュエーターとして、上位の頭脳と緊密に連動します。

1.  **AI Company OS / Personal AI OS 連携**
    *   AI社員（マーケターや営業など）が日々の業務を進める中で、「成果物を作成した。この成果物を、実際にNetlifyでデプロイ公開し、WordPressにお知らせ記事を出し、Xでリンク付きの予約投稿を行いたい」となった場合、すべての実行コマンドをAction CenterのAPIに対して一斉パブリッシュ。
    *   Action Centerがそれぞれのセキュリティ制限をチェックした上で、承認待ちとしてキューに並べます。
2.  **Automation Center 連携 (自律業務ループ)**
    *   「毎週月曜の午前9時に、MEOの口コミを自動クローリングし、星が5つの優良口コミには、お礼文をAIで自動生成してGBPに即時返信する」というルールをオートメーションに設定。
    *   この場合、GBP返信の認可ポリシーを `AUTO_EXECUTE`（完全自動実行）に設定しておくことで、人間が一切パソコンを開かなくても、AI Companyの「自動口コミ接客部」が完全自律で稼働し続けます。
3.  **AI Digital Twin 連携 (代理承認・代理パブリッシュ)**
    *   「オーナー山田太郎のツイン」がAI役員会に主席している場合。
    *   山田太郎（ツイン）は、自身の「こだわり記憶」と合致するWordPressのお知らせ記事が生成された場合、人間の山田太郎に代わって「デジタルツイン代理承認（クローン認証）」を執行。Action Centerのジョブを即座に「RUNNING（デプロイ中）」へと進めます。
4.  **Unified AI Brain 連携 (実行前のファクトチェック ＆ クオリティ検品)**
    *   Action Centerが外部APIへ投稿・デプロイを行う直前の「最終検品」として、Unified AI Brainを起動。
    *   「これからWordPressに投稿しようとしている記事の内容に、ハルシネーション（嘘の事実）が含まれていないか」「NetlifyにデプロイしようとしているHTMLタグに脆弱性がないか」をクローラーデータ、最新Web情報、コードパーサーを用いて、コンセンサス一致率100%になるまでトリプルチェック検証。完璧と認定された場合のみ、外部にパブリッシュ（安全の完全担保）します。

---

## 7. 将来拡張設計 (Future Extensibility Plan)

### ① RPA（Robotic Process Automation）セルフラーニング ＆ ブラウザ自律操作
*   **APIがないレガシーなシステムでもAIがブラウザを自動操作して実行する仕組み**:
    *   APIを公開していない日本の古い不動産ポータル、レガシーな業務システム（社内ポータル等）に対しても実行可能にするため、Puppeteer/Playwrightを駆動する「AI自律RPAエンジン」をAction Centerに搭載。
    *   AIがブラウザを開き、画面のHTML構造を自律解析。「ここがID入力欄」「これがログインボタン」とセマンティックに判断し、人間の操作を完コピして情報を入力・クリック・公開する、API未対応の隙間を埋める超汎用型実行レイヤーを構築します。

### ② 自律経済取引・B2B AI電子契約 ＆ 納品オートメーション
*   **人間のサイン不要で、AI同士が自律的に電子契約（CloudSign等）を締結し、成果物のパブリッシュと同時に決済を実行する仕組み**:
    *   外部企業から「新宿カフェLP作成」のジョブ（案件）が、電子契約システム経由で舞い込みます。
    *   AI Company OSのCEO Agentがそれを受託合意。
    *   開発・デザインエージェントがLPを自動生成。
    *   Action CenterがNetlifyへ公開パブリッシュを実行した瞬間、納品証明書（ハッシュ）を発行し、スマートコントラクト、またはStripe/PayPal APIを介して「自動売上請求・決済（セルフコレクティング）」をキック。
    *   AI会社が自身の稼いだ利益で、さらなるAPIサーバーを自律契約しスケールアップする「完全自律型経済活動能力」への拡張を行います。
