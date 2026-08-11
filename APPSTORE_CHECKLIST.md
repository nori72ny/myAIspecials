# Distribution / App Store Checklist

最終確認日: 2026-08-11

## 判定

```text
PWA source candidate: IMPLEMENTED
production web deployment: NOT VERIFIED
Chrome Web Store ready: NOT VERIFIED
Apple App Store ready: NOT VERIFIED
Google Play ready: NOT VERIFIED
native package: NOT IMPLEMENTED
store submission: NOT PERFORMED
store approval: NOT RECEIVED
```

PWA manifestやinstall boundaryの存在を、App Store / Google Play / Chrome Web Storeの提出・審査・承認と同一視しません。

基準main:

```text
36731864fbd4cda3947fc02dbd2e2c43eb3e029b
```

## Web / PWA Source Gate

| 項目 | 状態 | 制約 |
|---|---|---|
| React / Vite production build | PASS | CI環境 |
| PWA manifest / install boundary | 実装済み | 実機installは未確認 |
| service worker / offline boundary | 自動回帰あり | 実オフライン未確認 |
| cookie付きoffline navigation | 修正・test統合済み | 物理端末未確認 |
| API成功応答のoffline偽装防止 | 実装・test確認済み | production未確認 |
| Playwright E2E | PASS | CI browser |
| Axe / Lighthouse | PASS within configured scope | manual accessibility未実施 |
| production URL | NOT VERIFIED | deploy未実施 |
| deployed SHA | NOT VERIFIED | release identity未確認 |
| actual cost`$0.00` | NOT VERIFIED IN PRODUCTION | 実AI本番実行なし |

## Store固有要件

次は未実施です。

- store developer account確認
- package / bundle作成
- signing
- notarization
- privacy label
- data safety form
- age rating
- content rating
- store screenshots
- marketing metadata review
- legal entity / contact verification
- privacy policy URL確認
- support URL確認
- deletion / export flow review
- tracking disclosure
- in-app purchase review
- store-specific accessibility review
- store submission
- reviewer correspondence

これらを行うには、アカウント、規約、課金、公開情報等の個別承認が必要になる可能性があります。この文書更新では一切実行しません。

## セキュリティ・プライバシー

確認できるsource境界:

- OpenRouter keyをサーバー環境変数から取得
- free-only固定モデル
- automatic / paid fallback禁止
- legacy provider経路遮断
- JSON/API fail-closed

未確認:

- production Secret非露出
- store package内の設定
- privacy nutrition labelとの整合
- provider data handlingの実運用
- 本番log
- account deletion
- data export
- child safety / regional requirements

## 物理端末

```text
Android PWA install: NOT TESTED
iPhone PWA install: NOT TESTED
iPad PWA install: NOT TESTED
standalone launch: NOT TESTED
offline launch: NOT TESTED
update flow: NOT TESTED
uninstall / storage cleanup: NOT TESTED
OS text scaling: NOT TESTED
VoiceOver / TalkBack: NOT TESTED
```

## 過去判定の扱い

旧checklistは、古いE2E失敗、未確認のmetadata、server-side Gemini key、state persistenceを根拠にApp Store Readyを評価していました。

現在の実装・store審査証拠と一致しないため、そのPASS / FAILを現在のstore certificationとして引き継ぎません。

## 提出前の必須情報

```text
exact Git SHA
production URL
deployed SHA
target store
package identifier
package hash
signing identity
privacy policy URL
support URL
data collection declaration
third-party provider declaration
accessibility evidence
security review
actual cost USD
owner submission approval
```

## 決定境界

```text
source merge approval != deployment approval
deployment approval != store submission approval
store submission approval != billing approval
PWA installability != native store readiness
CI success != store certification
```

現時点ではstore提出を次工程として推奨・実行しません。まず個人利用向けweb公開候補の真実性、実機UX、アクセシビリティ、本番費用を証明する必要があります。
