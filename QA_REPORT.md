# Quality Assurance Report

最終確認日: 2026-08-11

この文書は、ORIGIN Personalの自動検証結果と未実施項目を分離します。独立QA機関による認証、RC2認定、完全な品質保証を主張しません。

## 対象

基準main:

```text
36731864fbd4cda3947fc02dbd2e2c43eb3e029b
```

直近のコード・依存関係検証に使用したPR #69 Exact Head SHA:

```text
68cd1479b4cff1fc771a0d2231da516cc10f80e2
```

直近の文書整合PR #71 Exact Head SHA:

```text
55d9f82f4e568b98d3469e438cf38294a87d5c37
```

## 自動検証

### PR #69

| 検査 | 結果 |
|---|---|
| Vitest | 817件成功 |
| API tests | 5件成功、既存1件skip |
| Playwright E2E | 27件成功 |
| TypeScript / design-token lint | PASS |
| production build | PASS |
| Node.js production runtime smoke | PASS |
| full `npm audit` | 0 vulnerabilities |
| production-only `npm audit` | 0 vulnerabilities |
| GitHub Actions workflows | 5件success |

### PR #71

文書だけの変更に対して実行対象となった4ワークフローがsuccessでした。

```text
ACOS 2.0 Quality Gate
CodeQL Security Analysis
OpenSSF Scorecard
Production Release CI/CD
```

`Production Release CI/CD`はPR検証ワークフロー名です。この結果はデプロイ実行を意味しません。

Node 22 / 24の両matrixで確認した項目:

- clean install
- Gitleaks
- security audit
- lint
- build
- unit tests
- Playwright E2E
- Lighthouse
- test-result upload
- SBOM generation

## ローカル再現コマンド

```bash
npm ci
npm run lint
npm test
npm run test:api
npm run build
npm run test:node-production
```

Playwright環境がある場合:

```bash
npm run test:e2e
```

Workers互換性dry run:

```bash
npm run check:worker
```

## 検証対象となる主要境界

- 権威ある`POST /api/chat`
- free-only固定モデル
- automatic / paid fallback禁止
- requested / served model不一致時の停止
- 無料根拠失効時の停止
- 不正JSON・HTML API応答の拒否
- 未定義APIのJSON 404
- legacy provider経路の遮断
- PWA/offlineの安全境界
- responsive UIの主要journey

## 過去の失敗記録の扱い

旧QA Reportには、`Mission Generator` locator不一致によるPlaywright 1件失敗が現在の状態として記載されていました。

そのログは過去時点の記録であり、現行候補ではPlaywright 27件が成功しています。古い失敗を現在のrelease blockerとして扱いません。

同様に、過去のhash付きbundle名、古いViteバージョン、古いmodule数を現在値として使用しません。

## 未実施・未証明

### 実環境

- production URL
- deployed SHA
- production smoke
- 本番AI成功応答
- actual cost`$0.00`
- 長時間・高負荷・複数利用者
- provider障害時の実運用

### 物理端末

- Android phone
- iPhone
- iPad
- physical keyboard
- 実オフライン
- OS storage eviction
- PWA install / update / uninstall

### アクセシビリティ

- VoiceOver
- NVDA
- TalkBack
- switch control
- 200% / 400% zoomの全画面
- high-contrast mode
- speech input

### 品質

- 実ユーザーによるusability test
- 回答精度のversioned benchmark
- 競合との盲検比較
- 高リスク領域の専門家評価
- 最新Exact SHAの独立第三者監査

## QA判定

```text
automated source checks: PASS
known current automated E2E blocker: NONE
manual physical-device verification: NOT TESTED
assistive-technology verification: NOT TESTED
production verification: NOT TESTED
answer-quality superiority: UNVERIFIED
overall production verdict: NOT VERIFIED
```

自動テストのPASSを、完全性、Production Ready、World Class Ready、App Store Readyへ拡張解釈しません。
