# ORIGIN（ACOS 2.0）Release Certification

最終確認日: 2026-08-12

## この文書の役割

この文書は、ORIGIN Personalの公開判定を要約します。

ソース・オブ・トゥルースはGitHub `main`です。詳細な判定項目は`PRODUCTION_CHECKLIST.md`、既知制約は`KNOWN_LIMITATIONS.md`、検証結果は`QA_REPORT.md`を参照します。

この文書単独を「唯一の正本」とせず、古いSHAの判定を現行候補へ流用しません。

## 現在の基準

この文書更新の開始点:

```text
19c387d4a9a0fd8ceac66f4e5efc96a2aa5d8214
```

現在の固定無料モデル:

```text
google/gemma-4-26b-a4b-it:free
```

無料根拠の再確認期限:

```text
2026-08-19T23:59:59.999Z
```

## 現在の判定

```text
Source / CI candidate: PASS
Draft PR readiness: PASS
Main merge readiness: REQUIRES EXACT-SHA OWNER APPROVAL
Third-release source readiness: CONDITIONAL PASS
Deployment readiness: NOT VERIFIED
Production Ready: NOT CERTIFIED
Daily Use Ready: NOT CERTIFIED
Enterprise Ready: NOT CERTIFIED
World Class Ready: NOT CERTIFIED
Actual production cost: NOT VERIFIED
Production deployment: NOT PERFORMED
```

PASSは記載されたscopeだけに適用します。Source / CI PASSを、Production・Daily Use・Enterprise・World Classの認定へ拡張しません。

## Source / CI Gate

直近の文書整合PR #72 Exact Head SHA:

```text
36365cc5fc1cf0e8de6c8d32ac35c96cf07db87d
```

PR #72で実行対象となった4ワークフローはすべてsuccessでした。

```text
ACOS 2.0 Quality Gate
CodeQL Security Analysis
OpenSSF Scorecard
Production Release CI/CD
```

Production Release CI/CDはPR検証ワークフロー名です。デプロイ済みという意味ではありません。

確認済みの主なsource gate:

- TypeScript / design-token lint
- clean install
- unit tests
- API tests
- Playwright E2E
- production build
- Node.js production runtime smoke
- Lighthouse
- configured Axe checks
- dependency review
- full / production-only security audit
- Gitleaks
- CodeQL
- OpenSSF Scorecard
- SBOM generation
- Workers compatibility dry run on applicable code SHA

## Zero-Cost / Provider Gate

sourceで確認済み:

- `FREE_ONLY=true`
- 固定モデル1つ
- OpenRouter automatic routing禁止
- paid fallback禁止
- requested / served model不一致時の安全停止
- 無料根拠失効時の`FREE_MODEL_EVIDENCE_STALE`
- APIキーをサーバー環境変数から取得
- 旧provider経路を遮断

productionで未確認:

```text
successful live AI response
requested model
served model
actual cost USD
provider data handling
secret exposure check
```

## 第三回公開の前倒し判定

目標公開判定期間:

```text
2026-08-13 through 2026-08-15
```

この期間に第三回公開するには、次を同じExact candidate SHAで完了させます。

1. 残存する公開・認証表現の監査
2. UI内のコピー対象・誤表示・未実装表示の最終確認
3. PC / tablet / mobileの主要journey確認
4. loading / error / offline / successの確認
5. Critical / High blocker 0件
6. 全必須CI success
7. オーナーによるExact SHAのReady・main merge承認
8. オーナーによる別個のdeployment承認
9. deployed SHAと`/api/health.releaseSha`の一致
10. production AI response、served model、actual cost `$0.00`の確認

固定無料モデルの根拠は8月18日に再確認期限を迎えます。8月13～15日に公開した場合も、8月18日までに再検証または安全停止を確認します。

## Production Evidence Gate

次はまだ揃っていません。

```text
production URL
deployment ID
approved Git SHA
deployed Git SHA
/api/health releaseSha
production smoke timestamp
successful live AI response
requested model
served model
actual cost USD
secret exposure result
rollback readiness
```

これらが揃うまで「公開済み」「本番Ready」「毎日使える」と断定しません。

## UX / Accessibility Gate

自動検査:

```text
Playwright E2E: PASS
configured Axe checks: PASS
Lighthouse CI: PASS
responsive automated journeys: PASS within tested scope
```

未確認:

```text
physical Android / iPhone / iPad
VoiceOver
NVDA
TalkBack
200% / 400% zoom on all key screens
production PWA install / offline recovery
```

物理端末・補助技術未確認を隠さず、第三回公開時の既知制約として明示します。

## Enterprise / World Class Gate

将来工程であり、現在の第三回公開条件には含めません。

未認定項目:

- authentication / authorization
- tenant isolation
- durable persistence
- backup / restore
- data retention governance
- incident recovery
- provider-neutral multi-AI consensus
- Truth Engine adversarial evaluation
- citation correctness benchmark
- versioned answer-quality benchmark
- independent comparative review
- production performance budgets
- WCAG 2.2 AA conformance audit

目標から削除するのではなく、証拠が揃うまで実装済み・認定済みと表現しません。

## 旧判定の扱い

旧文書の対象SHA:

```text
72109ff71460984614029f7870b62cafc3647bf0
```

この旧SHAに対するE2E・Security・Accessibility未検証判定は、現在のmain判定として使用しません。

同様に、過去の一時Preview、旧release SHA、古い固定無料モデル、古いE2E失敗を第三回公開証拠へ再利用しません。

## 最終判定テンプレート

```text
verdict:
exact candidate Git SHA:
approved Git SHA:
deployed Git SHA:
production URL:
deployment ID:
health releaseSha:
CI result:
security result:
accessibility result:
physical-device result:
requested model:
served model:
actual cost USD:
secret exposure result:
known limitations:
rollback readiness:
merge approval:
deployment approval:
timestamp:
```

## 現時点の結論

```text
Source candidate: PASS
Third release: NOT YET PUBLISHED
Fast-track target: 2026-08-13 to 2026-08-15
Current blocker class: production identity, live zero-cost execution, final UX evidence
Cost for this documentation update: $0.00
```
