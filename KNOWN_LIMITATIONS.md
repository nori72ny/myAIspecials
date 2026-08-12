# Known Limitations

最終確認日: 2026-08-11

この文書は、ORIGIN Personalの現行範囲と未検証事項を記録します。旧RC番号、未実装のエージェント規模、WebSocket、分散メモリ、enterprise keyを現在の仕様として扱いません。

基準main:

```text
36731864fbd4cda3947fc02dbd2e2c43eb3e029b
```

## 公開・運用

- 本番URLは未確認
- 恒久deployment IDは未確認
- 配信SHAとGitHub mainの一致は未確認
- 本番での実AI成功応答は未確認
- 実行時の実費`$0.00`は本番では未確認
- 日常利用可能性、SLA、可用性、復旧時間は未確認

CI成功やWorkers dry runは、本番デプロイの証明ではありません。

## AIモデルと費用

現在の固定無料モデル:

```text
google/gemma-4-26b-a4b-it:free
```

無料根拠の再確認期限:

```text
2026-08-19T23:59:59.999Z
```

制約:

- 固定モデル以外へ自動切替しない
- 有料fallbackを行わない
- 価格根拠が失効した場合は外部AI実行を停止
- providerが別モデルを提供した場合は停止
- provider availability、rate limit、利用条件の変更により利用できなくなる可能性がある
- 無料であることと、入力が保存・学習されないことは同義ではない

## 製品範囲

現行Personalランタイムの中心は、単一のチャット実行境界です。

現在の実行機能として保証しないもの:

- 複数AIの自動合議
- 自動Reviewer実行
- live searchと出典検証
- Project
- 長期Memory
- 端末間同期
- 永続Knowledge DNA
- 自己進化する組織
- Byzantine / Raft合意
- 1,000以上の自律エージェント同時実行
- WebSocket backplane
- 仮想ファイルシステムによる実ディスク操作
- desktop / IDE自動操作

リポジトリに将来構想や旧コードが存在しても、Personalランタイムから利用可能とは限りません。

## ローカルデータ

PWA、ブラウザーstorage、オフライン境界が存在しますが、次は未確認です。

- 物理Android / iPhone / iPad
- private browsing
- storage eviction
- OSによるPWA停止・削除
- 実ネットワーク切断と復旧
- 複数端末同期
- backup / restore
- 長期保持

ローカル保存を、クラウド同期、永続backup、組織Memoryとして表示しません。

## 回答品質

自動テストは、API境界・UI状態・固定fixtureの回帰を検査します。次を保証しません。

- すべての質問への正確性
- 最新情報
- 出典の完全性
- 法律・医療・金融等の高リスク判断
- 日本語表現の完全性
- hallucinationの完全排除
- 他AIサービスより優れていること

回答品質を主張するには、versioned fixture、採点基準、失敗例、比較条件、Exact SHAが必要です。

## 性能

CIではLighthouseを実行していますが、本番Real User Monitoringではありません。

未確認:

- 本番FCP / LCP / CLS / INP / TTFB
- 低速端末・低速回線
- 長時間CPU / memory
- memory leak
- 同時利用者数
- provider latency
- regional latency
- long-session degradation

過去のhash付きbundle名、LCP 1.2秒、peak memory、sub-millisecond routing等を現在の保証値として使用しません。

## アクセシビリティ

自動Axe検査とPlaywrightの操作確認は、補助技術による手動適合確認を置き換えません。

未確認:

- VoiceOver
- NVDA
- TalkBack
- 200% / 400% zoomの全画面
- physical keyboard on mobile/tablet
- high-contrast mode
- speech input
- switch control
- 認知アクセシビリティのユーザーテスト

WCAG 2.2 AA準拠またはAAA準拠を認証済みとは表現しません。

## セキュリティ

確認済みのコード境界があっても、次は未検証です。

- production penetration test
- 本番Secret・log・TLS・WAF・CORS設定
- 未知の脆弱性
- 外部providerの運用
- prompt injectionの網羅的耐性
- 長期的なdependency risk

「SECURED」「100%安全」「Zero Trust認証済み」とは主張しません。

## 配布

次は実施・証明されていません。

- App Store提出
- Google Play提出
- Chrome Web Store提出
- store review
- store policy適合
- signed native package
- software notarization

PWA manifestの存在は、store readyの証明ではありません。

## 制約の変更

この文書の制約を解消した場合は、次を同時に記録します。

```text
exact Git SHA
test method
test environment
evidence location
verdict
known residual risk
actual cost USD
merge status
deployment status
```
