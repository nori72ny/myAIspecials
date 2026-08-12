# ORIGIN（ACOS 2.0）ロードマップ

最終更新: 2026-08-11

## 目的

ORIGINは、ユーザーが安心して意思決定できるように、結論・根拠・検証状態・制約・次の行動を明確に示すAIオーケストレーション製品を目指します。

世界最高水準を目標にしますが、比較試験なしに「世界一」「最も高性能」「完全」とは主張しません。各段階は、実装・Exact SHA・自動テスト・手動確認・実行費用の証拠で判定します。

## 変更できない原則

- 費用は`$0.00`に限定
- 有料モデル、有料API、有料フォールバックを禁止
- 自動モデル切替を禁止
- 秘密情報はサーバー環境変数だけで扱う
- 無料根拠や提供モデルを確認できなければ安全停止
- GitHub `main`をソース・オブ・トゥルースとする
- コード変更、Draft PR、Ready化、mainマージ、デプロイを別承認にする
- Preview、Publish、Secret、DNS、課金、クラウド、リポジトリ設定を個別承認なしに変更しない
- fake dataや未実装機能を実機能に見せない

## 現在地

基準main:

```text
820389575c9a3e4f343c41b84a195fda33ba276b
```

現在確認できる範囲:

- ORIGIN PersonalのReact / Vite / Expressランタイム
- 日本語中心のチャットUI
- 権威ある単一の`POST /api/chat`境界
- OpenRouterの固定無料モデル1つ
- no fallback / fail-closed
- 無料モデル証拠の期限管理
- 要求モデルと提供モデルの一致検査
- 旧プロバイダー経路と未承認API経路の遮断
- PWAインストール境界
- Node.js本番ランタイムとWorkers互換性のdry-runゲート
- unit / API / E2E / Lighthouse / security / SBOMを含むCI

現在の固定無料モデル:

```text
google/gemma-4-26b-a4b-it:free
```

無料根拠の再確認期限:

```text
2026-08-19T23:59:59.999Z
```

## Stage 1 — 開発候補の真実性と安全性

状態: 進行中

### 完了済み

- READMEを現行実装へ整合
- 固定無料モデルを現行候補へ交換
- 4件の依存関係アドバイザリを互換範囲内で修正
- JSON以外のAPI応答をfail-closed化
- Node.jsとWorkersのcredential-freeランタイムゲートを追加
- PWAの安全境界を追加

### 残作業

- Release Notes、Changelog、Roadmapの真実性是正
- リポジトリ内に残る「公開済み」「Production Ready」「完全」「性能値」等の未証明表現を監査
- 失効前に固定無料モデルの価格・提供状況を公式情報で再確認
- 未解決Issueと現行mainの差分を再判定し、古いIssueを最新状態へ整理
- UIのコピー対象に一貫したコピーボタンを提供

### 完了条件

- 現行文書とコードに重大な矛盾がない
- 証拠のない公開・性能・品質主張がない
- 全CI成功
- Critical / Highの既知セキュリティ問題がない
- 費用`$0.00`

## Stage 2 — 個人利用向け公開候補

状態: 未完了

### 必須作業

- PC、タブレット、スマートフォンの主要画角でレンダリング確認
- 200%ズーム、キーボード操作、focus-visible、44px以上の操作領域を確認
- VoiceOver、NVDAまたはTalkBackによる手動確認
- loading / empty / success / denied / timeout / offline / malformed responseを確認
- 日本語の結論、回答、根拠、検証状態、制約、次の行動を一貫表示
- 内部モデル情報や技術詳細を回答の主役にしない
- 同じ依頼で現行UIと改善候補を比較し、混乱点を記録
- 成功条件と既知の制約をリリース判定書へ記録

### 完了条件

- Exact candidate SHAを固定
- 自動テストと手動UX・アクセシビリティ証拠が同じSHAを対象
- 未解決blockerが0件
- オーナーがReady化とmainマージを個別承認

## Stage 3 — 本番公開と真実性証明

状態: 未承認・未実施

この段階は、明示的なデプロイ承認が出るまで開始しません。

### 必須証拠

```text
production URL
deployment ID
deployed Git SHA
GitHub main Git SHA
health endpoint releaseSha
requested model
served model
actual cost USD
verification timestamp
```

### 確認項目

- 配信SHAと承認済みmain SHAが一致
- `/api/health.releaseSha`が40桁のSHAを返す
- 実AI応答が成功
- requested modelとserved modelが一致
- 実行時の実費が`$0.00`
- 有料fallbackと自動切替が発生していない
- Secretがクライアント、ログ、証跡へ露出していない
- 公開URLで主要画角・アクセシビリティ・オフライン・エラー境界を再確認

### 完了条件

- デプロイ承認と実行証跡がある
- 本番smokeが成功
- 配信SHA、モデル、費用を再現可能に確認
- 「公開済み」という表現が事実と一致

## Stage 4 — 回答品質の測定

状態: 将来工程

### 目標

- 正確性、関連性、完全性、明瞭性、安全性、日本語品質を測定
- 推測と確認済み事実を分離
- 出典が必要な回答では引用と参照先を検証
- concise / detailedの両モードを評価
- 失敗例と改善履歴を保存
- 同一条件の盲検比較で主要AIサービスとの差を測る

### 完了条件

- versioned evaluation fixture
- 採点基準と合格閾値
- 失敗例を含む再現可能な結果
- 比較対象・モデル・日時・設定の記録
- 未測定項目を明示した判定

## Stage 5 — 検索・出典・成果物

状態: 将来工程

### 候補機能

- live search
- claim verification
- 引用と出典の整合検査
- ドキュメント、表計算、プレゼンテーション等の成果物生成
- 成果物の構造・内容・視覚品質の検証
- 生成物と根拠を1つのtraceへ記録

外部サービスを利用する場合も、無料限定・秘密情報保護・個別承認を維持します。

## Stage 6 — Project / Memory

状態: 将来工程

### 前提

- ユーザーが保存対象と保存期間を理解できる
- 削除、エクスポート、保持期間、端末間同期の境界が明確
- 機密情報を自動保存しない
- 保存していない情報を「記憶している」と表示しない
- 永続化前にprivacy threat modelとデータ移行計画がある

## Stage 7 — 複数AI合議とTruth Engine

状態: 長期工程

### 目標

- provider-neutral adapter
- capability / limitation registry
- Primaryと独立Reviewerの役割分離
- 追加Reviewerの期待価値が低い場合は実行しない
- 複数回答の矛盾検出
- 根拠、実行、検証、費用、結論を1つのtraceへ統合
- 自動合議が費用・秘密情報・承認境界を迂回できない設計

### 非目標

次を証拠なしに実装済みと扱いません。

- 1,000以上の自律エージェント同時実行
- Byzantine / Raft合意
- 自己進化する組織
- 分散Knowledge DNA
- 世界規模のマルチクラスター
- sub-millisecond routing
- zero-knowledge workflow proof

## 各段階の判定形式

すべての段階で、少なくとも次を記録します。

```text
verdict
exact Git SHA
scope
automated tests
manual tests
security findings
accessibility findings
known limitations
actual cost USD
merge status
deployment status
owner approval
```

判定不能な項目は成功扱いにせず、`UNVERIFIED`または`NOT TESTED`として残します。
