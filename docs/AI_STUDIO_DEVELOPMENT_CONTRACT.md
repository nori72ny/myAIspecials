# ORIGIN — Google AI Studio 開発運用契約 v0.1

Status: Draft / planning only  
Owner: ノリさん  
Canonical repository: `nori72ny/myAIspecials`  
Canonical base branch: `main`  
Baseline SHA: `274e74d887d888bd6846e1ea4a08f691c8236f27`  
Evidence date: 2026-07-23

## 1. 決定

ORIGINの今後の実装では、Google AI Studioを正式な開発・実装ワークベンチとして優先する。

ただし、成果物の唯一の正本はGitHubとする。AI Studio内の会話、プレビュー、生成コード、保存状態は正本ではない。正式な変更履歴、監査基準、リリース候補、復旧基準はGitHub上のcommit SHAで確定する。

AI Studioを開発に使用することと、Gemini APIをORIGINの本番ランタイムとして有効化することは別の判断とする。

## 2. アカウントの扱い

- ノリさんが現在正式な開発対象として指定しているGoogle AI Studioアカウントを正式アカウントとする。
- 別のAI Studioアカウントは、正式アカウントが利用できない場合の一時的・補助的な実装環境に限定する。
- 補助アカウントの会話履歴やプロジェクト状態によって、GitHubの正本、正式アカウント、設計判断を置き換えない。
- アカウント、課金、Cloud Billing、APIキー、プロジェクト所有権をAIが変更しない。

## 3. 絶対条件

1. 想定費用と実行費用は `$0.00` のみ。
2. 有料モデル、有料API、有料ツール、有料フォールバックを使用しない。
3. 無料であることを証明できないモデルや処理は実行しない。
4. APIキー、パスワード、トークン、秘密鍵を会話、コード、Git、画面へ入力しない。
5. 認証情報を使用する将来の実装では、サーバー環境変数だけを参照する。
6. AI Studioからmainへ直接変更しない。専用ブランチとDraft PRを使用する。
7. mainへのマージとデプロイは、それぞれノリさんの別個の明示承認を必要とする。
8. 未実行のテストを成功と記載しない。
9. mock、fallback、サンプルデータを実行結果として表示しない。
10. 既存のORIGIN安全境界を弱めない。

## 4. 現在のランタイム方針

一次リリースの正式チャット経路は、PR #45で確定した安全境界を維持する。

- 正式UIは `/api/chat` のみを使用する。
- 現行の直接実行は、証拠期限内の明示的な `:free` モデルだけを許可する。
- 無料状態、実行先、フォールバック不使用を確認できない場合は回答を表示しない。
- 旧Gemini/OpenRouter/Mission実行経路は、安全・無料ポリシーへ移行するまで公開経路で停止する。

Google AI Studioを正式開発基盤にしても、このランタイム境界を自動的にGemini APIへ変更しない。

## 5. Gemini APIを直ちに有効化しない理由

Google公式資料では、Google AI Studio自体の利用は利用可能地域で無料と案内されている。一方、Gemini APIのFree Tierは対象モデルとレート制限に依存し、課金を設定するとPaid Tierへ移行する。

したがって、次を同一視してはならない。

- AI Studioでコードを設計・実装すること
- Gemini APIをORIGINから呼び出すこと
- Gemini API呼び出しが必ず無料であること

直接Gemini APIの有効化は、以下をコードとテストで証明できるまで保留する。

- 正式アカウントがFree Tierである
- 使用モデルがその時点でFree Tier対象である
- 最大費用が実行前に `$0.00` と確定する
- paid/preview/automatic/`latest` aliasを選ばない
- 自動モデル切替・自動再試行・別providerへのfallbackがない
- 無料枠超過、地域対象外、証拠期限切れでfail closedする
- providerへの送信内容と保存方針が利用者表示と一致する

## 6. 現コードで移行前に修正すべき箇所

### `src/legacy/aiClient.ts`

現在の旧実装には以下がある。

- OpenRouter失敗後のGemini自動フォールバック
- 無料根拠を持たないモデル名
- providerの生エラー本文を含む可能性がある例外
- 生エラーのconsole出力

このファイルを正式経路へ再接続してはならない。

### `services/mission-engine/src/infrastructure/ai/GeminiLLMClient.ts`

現在の旧実装には以下がある。

- `FREE_ONLY`時に特定モデルへ自動置換する処理
- 置換先モデルの無料状態を証拠カタログで確認しない処理
- APIキー欠落時のfallback mock
- prompt長やproviderエラーを含み得るログ処理

このクライアントは、Free Tier証拠、fail-closed、ログallowlistを備えた新しい境界へ置き換えるまで正式経路へ接続しない。

## 7. AI Studioでの標準開発フロー

1. 作業開始時にGitHub `main` の最新SHAを確認する。
2. 依頼に記載されたexact base SHAへ作業を固定する。
3. 専用ブランチを作成する。
4. 実ファイルを監査し、推測で存在しない機能を前提にしない。
5. 変更範囲と禁止事項を最初に確定する。
6. 実装単位ごとにlint、関連テスト、buildを実行する。
7. mock成功、未測定、未実行を成功扱いしない。
8. commit SHAを提示する。
9. Draft PRを作成する。
10. GitHub Actionsと外部監査をexact candidate SHAで確認する。
11. ノリさんの明示承認後だけmainへマージする。
12. デプロイは別の明示承認まで行わない。

## 8. AI Studioへ渡す標準プロンプト

```text
Repository:
nori72ny/myAIspecials

Product:
ORIGIN

Exact base SHA:
<GitHub mainの最新SHA>

あなたはGoogle AI Studio上の正式な実装担当です。
GitHubを唯一のソース・オブ・トゥルースとして扱ってください。
AI Studio内の過去会話や保存状態より、指定SHAの実コードを優先してください。

絶対条件:
- 想定費用・実行費用は$0.00のみ
- 有料モデル、有料API、有料fallbackは禁止
- 無料であることを証明できない実行はfail closed
- APIキーや秘密情報を要求、表示、保存、コミットしない
- 認証情報は将来のサーバー環境変数参照以外に実装しない
- mainへ直接変更しない
- マージ、デプロイ、DNS、Cloudflare、billing、アカウント設定を変更しない
- mockやサンプルデータを実データとして表示しない
- 未実行テストをPASSと記載しない

最初に行うこと:
1. exact base SHAの確認
2. 対象ファイルの実在確認
3. 既存テストと安全境界の確認
4. 変更予定ファイルと非変更範囲の提示
5. 想定費用$0.00の確認

作業後に必ず報告:
- branch
- 変更ファイル
- 変更理由
- commit SHA
- 実行したテストと結果
- 未実行項目
- 残るP0/P1/P2
- マージ未実施
- デプロイ未実施
```

## 9. 次の実装フェーズ

### Phase AS-1: 既存Gemini経路の隔離証明

- 旧Geminiクライアントが正式 `/api/chat` から到達不能であることをテストする。
- すべての公式サーバーentrypointでlegacy provider guardが先に評価されることを確認する。
- worker経路で直接Gemini実行が存在しないことを確認する。

### Phase AS-2: AI Studio向け実装境界

- provider固有情報をdomainと一般UIへ漏らさない。
- direct Gemini adapterはfeature flag既定OFFで追加する。
- Free Tier証拠がない場合は起動時・実行時とも停止する。
- `generateContent`を無条件で再利用せず、採用APIを公式仕様に基づき決定する。
- Interactions APIを採用する場合は、保存を必要としない処理で`store=false`を既定とする。
- stableな明示モデルIDだけを許可し、preview、experimental、`latest` aliasを拒否する。

### Phase AS-3: 無料・安全性の負のテスト

- billing/free tier不明
- free対象モデル不明
- rate limit超過
- region対象外
- provider timeout
- unexpected upstream body
- Authorization header
- prompt/conversation logging
- automatic retry
- model/provider fallback
- evidence期限切れ

### Phase AS-4: Owner acceptance

- APIキーなしのoffline testを全成功させる。
- exact candidate SHAのCIを全成功させる。
- 無料枠の実リクエストは、正式アカウント復旧後かつノリさんの別途承認後に1回だけ行う。
- 実リクエスト前に想定費用 `$0.00` を再確認する。

## 10. 完了条件

AI Studio基盤への移行完了を宣言できるのは、次をすべて満たした場合だけとする。

- GitHub mainとAI Studio作業対象SHAが一致
- 旧provider経路が正式経路から隔離
- direct Gemini adapterが既定OFF
- Free Tier証拠と期限がコード化
- paid/preview/latest/fallbackが拒否される
- secret、trace、provider errorがsanitized
- unit/integration/E2E/security checksが成功
- 正式アカウントでの$0.00確認
- ノリさんの明示的なマージ承認
- ノリさんの別個のデプロイ承認

## 11. 公式根拠

確認日: 2026-07-23

- Gemini API key security: https://ai.google.dev/gemini-api/docs/api-key
- Gemini API billing: https://ai.google.dev/gemini-api/docs/billing
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API models and lifecycle: https://ai.google.dev/gemini-api/docs/models
- Interactions API overview: https://ai.google.dev/gemini-api/docs/interactions-overview

公式仕様は変更され得るため、モデル、無料枠、rate limit、保存方針は実装時に再確認する。
