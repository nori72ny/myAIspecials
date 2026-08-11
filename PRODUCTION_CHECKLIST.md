# Production Readiness Checklist

最終確認日: 2026-08-11

## 判定

```text
source candidate status: PASS WITH UNVERIFIED PRODUCTION ITEMS
production ready: NOT VERIFIED
deployed: NOT VERIFIED
store ready: NOT VERIFIED
actual production cost: NOT VERIFIED
```

このチェックリストは、GitHub上の開発候補と本番運用を分離します。CI成功だけで本番Readyと認定しません。

基準main:

```text
36731864fbd4cda3947fc02dbd2e2c43eb3e029b
```

## Source / CI Gate

| 項目 | 状態 | 証拠・制約 |
|---|---|---|
| 指定8文書以外の変更なし | 検証予定 | この文書PRのcompareで確認 |
| TypeScript / design-token lint | PASS | 直近PR #71 Quality Gate |
| production build | PASS | PR #71 Node 22 / 24 |
| unit tests | PASS | PR #71 Node 22 / 24 |
| API tests | PASS | 直近統合候補のCI |
| Playwright E2E | PASS | PR #71 Node 22 / 24 |
| Lighthouse CI | PASS | PR #71 Node 22 / 24 |
| dependency review | PASS | PR #71 |
| npm security audit | PASS | PR #71 Node 22 / 24 |
| Gitleaks | PASS | PR #71 Node 22 / 24 |
| CodeQL | PASS | PR #71 |
| OpenSSF Scorecard | PASS | PR #71 |
| SBOM生成 | PASS | PR #71 Node 22 / 24 |
| Node.js production runtime smoke | PASS | mainにgateを統合済み |
| Workers compatibility dry run | PASS on applicable code PR | credential-free、デプロイなし |

GitHub Actions名`Production Release CI/CD`は、PR上では検証ワークフローとして実行されます。名前だけでデプロイ済みとは判断しません。

## Zero-Cost AI Gate

| 項目 | 状態 | 証拠・制約 |
|---|---|---|
| `FREE_ONLY=true` | 実装確認済み | サーバー境界 |
| 固定モデル | 実装確認済み | `OriginFreeModelCatalog` |
| automatic routing禁止 | 実装・テスト確認済み | fail-closed |
| paid fallback禁止 | 実装・テスト確認済み | no fallback |
| requested / served model一致 | 実装・テスト確認済み | 不一致時停止 |
| 無料根拠期限 | 有効期限あり | 2026-08-18T23:59:59.999Z |
| 本番実行時actual cost | NOT VERIFIED | 本番実行なし |
| provider data policy | 本番未確認 | 無料と非保存は同義ではない |

固定モデル:

```text
nvidia/nemotron-3-ultra-550b-a55b:free
```

## UX / Accessibility Gate

| 項目 | 状態 | 制約 |
|---|---|---|
| Playwright主要journey | PASS | CI browser環境 |
| Axe automated gate | PASS within configured severities | 手動補助技術確認を含まない |
| Lighthouse accessibility | PASS within configured thresholds | 本番・実機ではない |
| responsive screenshots | 過去証跡あり | 最新Exact SHAの全画面人手比較は未完 |
| 200% / 400% zoom | NOT VERIFIED | 手動確認が必要 |
| VoiceOver / NVDA / TalkBack | NOT VERIFIED | 物理/補助技術環境が必要 |
| physical mobile / tablet | NOT VERIFIED | 実機確認が必要 |
| reduced motion | 自動回帰あり | 全画面手動確認は未完 |

## Production Evidence Gate

次はすべて未確認です。

```text
production URL
deployment ID
approved Git SHA
deployed Git SHA
health releaseSha
production smoke result
requested model
served model
actual cost USD
secret exposure check
rollback readiness
```

## Security Gate

| 項目 | 状態 |
|---|---|
| API keyを環境変数から取得 | 実装確認済み |
| client bundleへの実Secret非露出 | CI/コード境界で確認、production未確認 |
| JSON/API fail-closed | 実装・テスト確認済み |
| rate limit / request-size limit | 実装確認済み |
| production penetration test | NOT VERIFIED |
| production TLS / WAF / CORS | NOT VERIFIED |
| independent exact-SHA audit | NOT VERIFIED for this candidate |

## Release Decision

現在の決定:

```text
Ready for Draft PR review: YES
Ready for main merge: REQUIRES OWNER APPROVAL
Ready for deployment: NO — SEPARATE APPROVAL AND EVIDENCE REQUIRED
Production certified: NO
App Store certified: NO
```

## 完了条件

Production Readyと判断するには、少なくとも次が必要です。

- Exact candidate SHA固定
- 全必須CI成功
- Critical / High blocker 0件
- 最新SHAでのUX・アクセシビリティ手動確認
- 明示的なデプロイ承認
- 配信SHA一致
- 本番AI成功応答
- requested / served model一致
- actual cost`$0.00`
- Secret非露出
- rollback確認
- 既知制約と残余リスクの承認
