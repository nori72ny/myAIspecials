# Accessibility Report

最終確認日: 2026-08-11

この文書は、ORIGIN Personalの自動アクセシビリティ検査と未実施の手動確認を分離します。WCAG 2.2 AA / AAA認証済みとは主張しません。

## 対象

基準main:

```text
36731864fbd4cda3947fc02dbd2e2c43eb3e029b
```

## 自動検査

現行test suiteにはPlaywrightと`@axe-core/playwright`が含まれます。

直近PR #71では、Node 22 / 24の両matrixで次が成功しました。

- Playwright E2E
- configured Axe checks
- Lighthouse
- build / unit regression

Axeは設定されたseverityと対象画面に対する自動検査です。未検査rule、incomplete判定、補助技術の読み上げ品質、操作理解までは保証しません。

## 実装で確認している基本境界

- keyboardで主要操作へ到達できること
- `focus-visible`を使用すること
- 主要入力のmobile font size
- 主要操作領域のtouch target
- dialogのlabelとmodal semantics
- live regionを用いる状態通知
- reduced-motionに対する回帰
- responsive viewportでの主要journey
- critical / serious Axe violationの回帰防止

この一覧は、全component・全状態の適合認証ではありません。

## 自動検査の限界

自動Axe / Lighthouseでは次を十分に判断できません。

- 読み上げ順序が自然か
- 日本語labelが理解しやすいか
- focus移動が利用者の予想と一致するか
- error recoveryが認知しやすいか
- long responseを効率よく移動できるか
- 画面拡大時に重要情報が失われないか
- 色以外で状態が伝わるか
- motionが実際に負担にならないか
- touch targetが物理端末で押しやすいか

## 未実施の手動確認

```text
VoiceOver + Safari: NOT TESTED
NVDA + Firefox/Chrome: NOT TESTED
TalkBack + Chrome: NOT TESTED
Switch Control: NOT TESTED
speech input: NOT TESTED
200% zoom all key screens: NOT TESTED
400% zoom all key screens: NOT TESTED
Windows High Contrast: NOT TESTED
physical mobile keyboard: NOT TESTED
cognitive accessibility user test: NOT TESTED
```

## 物理端末

次は未確認です。

- Android phone
- iPhone
- iPad
- tablet landscape / portrait with assistive technology
- OS text scaling
- browser minimum font override
- actual touch precision
- PWA standalone accessibility
- offline recovery announcement

emulated viewportのPASSを物理端末PASSとして扱いません。

## 過去文書から除外した断定

旧Accessibility Reportには、現在のPersonal UIと一致しないcomponentや画面を根拠とした記載がありました。

- `SovereignComponents.tsx`
- SVG Network Graph
- Strategic Review tab
- dark cockpit theme
- specific arbitrary color combinations
- Axe未導入という古い状態

現行コード・最新testで再確認できない内容を現在の評価として引き継ぎません。

## WCAG判定

現在の判定:

```text
automated accessibility regression: PASS WITH CONFIGURED SCOPE
critical / serious automated blocker: NONE IN TESTED SCOPE
manual assistive-technology review: NOT TESTED
WCAG 2.2 AA conformance: NOT CERTIFIED
WCAG AAA conformance: NOT CERTIFIED
production accessibility: UNVERIFIED
```

WCAG準拠を主張するには、success criteriaごとの対象、適用外理由、automated evidence、manual evidence、対象SHA、対象URLが必要です。

## 手動確認記録テンプレート

```text
exact Git SHA:
URL:
browser / version:
OS / version:
assistive technology / version:
viewport / zoom:
journey:
result:
finding severity:
evidence:
residual risk:
reviewer:
timestamp:
```

## 公開前の最低条件

- 最新Exact SHAで主要journeyを確認
- 200% zoom
- keyboard-only
- 少なくとも1つのdesktop screen reader
- 少なくとも1つのmobile screen reader
- error / loading / offline / successの通知
- focus orderとfocus restoration
- 長い日本語回答
- reduced motion
- 既知blocker 0件または明示的な残余リスク承認
