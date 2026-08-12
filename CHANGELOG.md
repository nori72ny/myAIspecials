# Changelog

ORIGIN（ACOS 2.0）のGitHub `main`へ統合された、確認可能な変更を記録します。

この文書は正式リリースや本番公開を宣言しません。日付はmerge commitの日付、内容はGit履歴と差分で確認できる範囲に限定します。バージョン番号や性能値は、対応するtag・測定証跡・公開証跡がない限り付与しません。

## Unreleased

### Fixed model

- `data_collection: deny`と両立しないNVIDIA無料エンドポイントを固定対象から除外。
- 価格0、学習利用なしの無料エンドポイント、推論、構造化出力、140超言語対応を公式情報で確認できた`google/gemma-4-26b-a4b-it:free`へ固定モデルを変更。
- 実生成は未実施であり、日本語回答品質、served model、実費は未検証。

### Documentation

- Release Notes、Changelog、Roadmapを現行実装・Git履歴・検証済み事実に合わせて再構成。
- 将来構想と実装済み機能を分離。
- RC公開、性能スコア、同時実行規模など、証拠のない断定を削除。

## 2026-08-11

### PR #70 — READMEの真実性是正

Merge commit:

```text
820389575c9a3e4f343c41b84a195fda33ba276b
```

- READMEをReact 19 / Vite 6 / Express 5 / npmの現行構成へ整合。
- 固定無料モデル、無料根拠期限、安全停止、承認境界を明記。
- 正式公開・本番稼働・性能・優位性が未証明であることを明記。
- コピー対象をGitHubのコピーボタンが表示されるコードブロックへ整理。

### PR #69 — 依存関係アドバイザリ修正

Merge commit:

```text
76eef70d0076d8cf0872c78a979a7091cd0616a5
```

- DOMPurifyを3.4.13へ更新。
- lockfile内のJS-YAML、PostCSS、Nanoid、Undiciを互換範囲内で更新。
- full / production-onlyの`npm audit`で脆弱性0件を確認。
- アプリケーションコード、モデルルーティング、UI、API、デプロイ設定は変更なし。

### PR #68 — 固定無料モデルの交換

Merge commit:

```text
1eeff53dd66bf96bef937e9a5b126c87322262a1
```

- 廃止された固定モデルを次へ交換。

```text
nvidia/nemotron-3-ultra-550b-a55b:free
```

- reasoning effortを当該モデルが受け付ける`medium`へ整合。
- 旧モデル、自動ルーティングID、許可外モデルを拒否。
- 無料根拠の再確認期限を2026-08-18 23:59:59.999Zに設定。

## 2026-08-10

### PR #67 — API JSON境界のfail-closed化

Merge commit:

```text
458c74b305e5c31404bb0b6b66dfeb00e47150a8
```

- JSONでないAPI応答を表示用テキストとして扱わず、安全側で拒否。
- 不正JSON、HTML応答、未定義API経路に対するテストを追加。
- 旧API経路がSPA HTMLへフォールスルーしない境界を維持。

### PR #66 — PWAインストール境界

Merge commit:

```text
66057b179f5800e5f1aa8c69c4a5776b2b7192fa
```

- ORIGIN PersonalのPWAインストール境界を追加。
- cookieを伴うオフラインナビゲーションを修正。
- オフライン時にAPI応答を偽装しない安全境界を維持。

### PR #65 — 本番ランタイム互換性ゲート

Merge commit:

```text
d06550e826e7a9b17a4b9029b8e03cd6f2fb0ca1
```

- Node.js本番ランタイムのスモークゲートを追加。
- Cloudflare workerd互換性のcredential-free dry runを追加。
- Express 5ランタイム互換性を是正。
- 互換性検査はデプロイを行わない。

## 記録上の注意

過去の文書には、次のような実装・測定・公開証拠と結び付かない記載がありました。

- RC1 / RC2の正式リリース
- Architecture 98%、Security 100%、LCP 1.2秒
- 1,000以上の自律エージェント同時実行
- 自己進化する組織・分散合意・永続Knowledge DNA
- Gemini専用ランタイム
- 本番公開済みのProduction Package

これらはこのChangelogの確認済み変更として引き継ぎません。将来実装された場合は、Exact SHA、テスト、測定方法、公開証跡と共に新しい項目として記録します。
