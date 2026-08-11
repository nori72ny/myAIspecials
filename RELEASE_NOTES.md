# ORIGIN（ACOS 2.0）開発候補ノート

最終確認日: 2026-08-11

この文書は、GitHub `main`の実装と検証証跡を説明する開発候補ノートです。正式リリース、本番公開、日常利用可能性、性能保証、競合優位性を宣言するものではありません。

## 基準となるmain

この文書更新の開始点:

```text
820389575c9a3e4f343c41b84a195fda33ba276b
```

このSHAはPR #70のREADME真実性是正を含みます。

## 現在の製品範囲

ORIGIN Personalの現在の中心は、React / Viteの日本語UIとExpressのサーバー境界を通じて、単一の固定無料モデルへ安全に要求を送ることです。

実装で確認できる範囲:

- `POST /api/chat`を権威あるチャット実行経路として使用
- `FREE_ONLY=true`を前提としたサーバー側の無料限定
- OpenRouterの固定無料モデルを1つだけ許可
- 自動モデル選択、有料フォールバック、別モデルへの自動切替を禁止
- 要求モデルと実際の提供モデルが不一致なら安全停止
- 無料根拠が期限切れなら`FREE_MODEL_EVIDENCE_STALE`で安全停止
- 旧プロバイダー経路と未承認API経路を遮断
- JSON境界、入力容量、レート制限、セキュリティヘッダーをサーバー側で適用
- PWAインストール境界と安全なオフラインナビゲーション
- Node.js本番ランタイムとCloudflare Workers互換性のcredential-free検査

## 固定無料モデル

```text
nvidia/nemotron-3-ultra-550b-a55b:free
```

無料根拠の記録:

```text
verifiedAt: 2026-08-11T00:00:00.000Z
reviewAfter: 2026-08-18T23:59:59.999Z
```

`reviewAfter`を過ぎた場合は、公式情報を再確認して証拠を更新するまで外部AI実行を停止します。

## 直近の統合履歴

| PR | mainへの統合内容 | merge commit |
|---|---|---|
| #65 | Node.js本番ランタイムとCloudflare workerd互換性ゲート | `d06550e826e7a9b17a4b9029b8e03cd6f2fb0ca1` |
| #66 | PWAインストール境界とcookie付きオフラインナビゲーション修正 | `66057b179f5800e5f1aa8c69c4a5776b2b7192fa` |
| #67 | JSON以外のAPI応答を安全側で拒否 | `458c74b305e5c31404bb0b6b66dfeb00e47150a8` |
| #68 | 廃止された固定無料モデルを現行モデルへ交換 | `1eeff53dd66bf96bef937e9a5b126c87322262a1` |
| #69 | 互換範囲内の依存関係アドバイザリ修正 | `76eef70d0076d8cf0872c78a979a7091cd0616a5` |
| #70 | READMEを現行実装と検証済み事実へ整合 | `820389575c9a3e4f343c41b84a195fda33ba276b` |

## 検証済み事実

PR #69のExact Head SHA:

```text
68cd1479b4cff1fc771a0d2231da516cc10f80e2
```

当該SHAでは次を確認しました。

- GitHub Actionsの5ワークフローが成功
- Vitest 817件成功
- APIテスト 5件成功、既存の1件をskip
- Playwright E2E 27件成功
- lint、build、Node.js本番ランタイムスモークが成功
- full / production-onlyの`npm audit`で脆弱性0件

PR #70のExact Head SHA:

```text
739c986b52e5671f4ba7a025778603730f7e47a4
```

当該SHAでは、READMEだけの変更に対して実行対象となった4ワークフローがすべて成功しました。

## ローカル検証

```bash
npm ci
npm run lint
npm test
npm run test:api
npm run build
npm run test:node-production
```

Playwrightのブラウザー環境がある場合:

```bash
npm run test:e2e
```

Cloudflare Workers互換性のdry run（デプロイなし）:

```bash
npm run check:worker
```

## 未検証・未公開

次は、このリポジトリやCI成功だけでは証明されていません。

- 本番URLへの恒久デプロイ
- 配信中のSHAとGitHub mainの一致
- 本番環境での実AI成功応答
- 実行時の実費が`$0.00`であること
- 物理スマートフォン・タブレットでの操作
- VoiceOver、NVDA、TalkBackによる手動確認
- 本番性能、可用性、回答精度
- 他製品より優れていること
- 複数AIによる自動合議、自己進化、分散メモリ
- 1,000以上の自律エージェントの同時実行

## 公開判定

現状は「GitHub上の開発候補」です。

```text
正式リリース: 未宣言
本番公開: 未証明
デプロイ: この文書更新では未実施
費用: $0.00
```

公開する場合は、コードのReady化・mainマージとは別に、オーナーの明示的なデプロイ承認と本番証拠が必要です。
