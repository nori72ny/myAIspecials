# ORIGIN Product Experience Contract v0.1

Status: Canonical product direction

Owner: ノリさん

Canonical repository: `nori72ny/myAIspecials`

Release strategy: Personal first, world-class platform later

Last aligned: 2026-07-23

## 1. ORIGINが目指すもの

ORIGINは、単一のAIへ文章を送るチャット製品ではない。ユーザーが一度目的を伝えると、その意図を理解し、依頼を分類し、安全・無料の条件内で適切なAIを選び、必要に応じて複数の独立したAIによる調査、比較、合議、相互レビューを行い、検証可能な最終回答または成果物へ統合するAIオーケストレーションOSである。

ACOS 2.0はORIGINを支えるオーケストレーションエンジンであり、Google AI Studio、Gemini、OpenRouter、その他の外部AIは交換可能な開発環境またはprovider adapterである。特定providerをORIGINそのものとして扱わない。

一次目標はノリさんが日常的に安心して使えるPersonal Editionである。最終目標は、品質、安全性、保守性、アクセシビリティ、性能、拡張性を根拠付きで高め、Production Ready、Enterprise Ready、Daily Use Ready、World Class Readyへ段階的に到達することである。

## 2. 1つの依頼に対する標準フロー

1. 表面的な文言だけでなく、達成したい目的を理解する。
2. 依頼の種類、重要度、最新情報の必要性、成果物形式を分類する。
3. 能力、無料状態、安全条件、利用可能性から実行候補を選ぶ。
4. 単独実行で十分か、複数AIによる比較・独立確認が必要か判断する。
5. 必要な調査、根拠、引用、計算、制作を行う。
6. 事実、論理、安全性、指示適合性、実行経路を検証する。
7. 複数の結果を、矛盾や少数意見を隠さず最終回答へ統合する。
8. 一般利用者が理解できる形で提示し、技術情報は段階的に開示する。
9. 保存・学習機能が正式実装されるまでは、利用者の記憶として保存したと表示しない。

## 3. 回答内容と見せ方

標準的な回答は、依頼に不要な見出しを機械的に増やさず、次の情報を読みやすい順序で扱う。

1. 結論
2. 依頼に対する具体的な回答または成果物
3. 判断理由、根拠、出典
4. 別AIによる確認を含む検証状態
5. 不明点、制約、リスク
6. 次に取るべき行動

比較表、将来予測、追加助言、グラフ、図解、イラスト、文書、スライド、表計算などは、理解または成果を明確に改善するときだけ追加する。見栄えのためだけに増やさない。数値や画像を生成しただけで、事実確認済みとは表示しない。

最初の表示では、利用者が必要とする結論と内容を優先する。使用モデルID、provider ID、trace、処理時間などの内部情報は、正確に取得できる場合だけ折りたたみ詳細へ表示する。

## 4. デザイン原則

- 日本語を既定とし、自然で簡潔な表現を使う。
- 1画面の主目的と主要操作を明確にする。
- Apple、Linear、Notion、Figma水準の情報設計、静かな密度、余白、階層、応答性を品質基準として参照する。ただしブランドを模倣しない。
- Dark Firstを維持しながら、ライト表示、モバイル、タブレット、キーボード、スクリーンリーダーでも同等に使えるようにする。
- 状態、費用、検証、失敗理由を、専門知識がなくても理解できる言葉で示す。
- 高度な処理過程はprogressive disclosureで表示し、最初からダッシュボード情報を詰め込まない。
- fake data、サンプル値、動かないボタン、未実装機能、根拠のないプライバシー・性能・品質主張を正式画面へ出さない。

## 5. AI連携の原則

- task classification、capability matching、routing、execution、review、synthesisを分離する。
- 単独AIで十分な依頼に、見せかけの複数AI処理を追加しない。
- 重要判断、最新情報、低信頼、専門領域、ユーザー指定時は独立レビューを検討する。
- 同一providerの別名モデルだけで独立検証済みと表示しない。
- reviewerの失敗、欠落、timeout、拒否を成功や承認に変換しない。
- provider固有情報はdomainと一般UIへ漏らさず、adapter境界に閉じ込める。
- 無料状態を実行前後に確認できない処理、有料モデル、自動有料fallbackは使用しない。

## 6. 現在の実装との対応

| 製品要件 | 現在の証拠 | 状態 |
|---|---|---|
| 目的を1か所へ自然文で入力 | Personal DashboardとUI test | TEST-COVERED |
| 無料AIの安全な単独実行 | `/api/chat`境界、無料証拠、実行整合性test | TEST-COVERED |
| task classificationとcapability routing | Routing Engine / Capability Registryのunit test | TEST-COVERED / PRODUCT-UNVERIFIED |
| 独立AIレビュー判断 | `OriginReviewPolicy`のunit test | TEST-COVERED / ROUTE-UNCONNECTED |
| 独立providerレビューと統合 | `OriginReviewSynthesis`、`OriginReviewedExecution`のunit test | TEST-COVERED / ROUTE-UNCONNECTED |
| 根拠・引用・事実検証 | 関連engineと監査UIは存在 | PRODUCT-UNVERIFIED |
| 回答、費用、使用AI、検証状態の表示 | Personal Unified Chat test | TEST-COVERED |
| グラフ・図解・成果物の適応表示 | Personal正式経路との接続証拠なし | NOT IMPLEMENTED |
| 個人記憶と継続学習 | 一次リリースUIから非表示 | NOT IMPLEMENTED |
| AI Studio direct runtime | fail-closed境界のみ、正式route未接続 | BLOCKED |
| 旧Dashboardのサンプル・fallback表示 | production entrypointから未import、release boundary test追加 | TEST-COVERED / LEGACY-DEBT |

`TEST-COVERED`は本番環境での動作確認を意味しない。存在するengineや画面だけを根拠に、Personal Editionで利用可能と表示しない。

## 7. 変更時の受入条件

今後の設計・実装・AI Studio作業は、次を満たす必要がある。

- ORIGINを特定provider専用チャットへ縮小しない。
- 本契約の標準フローのどの段階を実装・変更するか明示する。
- 回答品質と画面表示が、実際に実行した処理および証拠と一致する。
- 新機能より既存品質、安全性、保守性、UX、アクセシビリティ、性能を優先する。
- 未実装、未接続、未測定を成功または利用可能と記載しない。
- 各変更で設計理由、変更ファイル、影響、テスト、リスク、残課題を報告する。
- mainへのマージとデプロイは、それぞれオーナーの別個の明示承認を得る。

## 8. 禁止される縮小・誤認

- AI StudioやGeminiをORIGINの全体構想と同一視すること。
- chat responseが返るだけでオーケストレーション完成と宣言すること。
- 複数AIの実行数だけで合議・独立検証・品質を証明すること。
- score、win rate、世界最高、enterprise readyなどを再現可能な証拠なしに表示すること。
- mock、fixture、preview、sampleを利用者の実データまたは実行結果として表示すること。
- 回答本文、会話、秘密情報、provider生エラーを監査証跡として保存すること。

## 9. 新しいAIへ継続対応する構造

新しいAI、モデル、検索、画像、音声、動画、制作サービスが登場しても、ORIGINのdomain、正式API、一般UIをproviderごとに作り直さない。

新規AIはprovider adapterとして追加し、Capability Registryへ能力を登録する。Routing Engineは名前や人気ではなく、依頼適合能力、安全条件、無料証拠、利用可能性、品質証拠から候補を判断する。一般画面は共通のORIGIN回答形式を表示し、provider/modelの技術情報は分離した実行証跡として扱う。

新規AIの有効化には次を必要とする。

1. stableな明示モデルIDと公式lifecycle情報
2. 実行前後の費用`$0.00`を証明できる根拠
3. 保存、学習利用、地域、rate limit、認証方式の確認
4. timeout、rate limit、不正応答、証拠期限切れのfail-closed test
5. 自動retry、自動model切替、自動provider fallbackがないこと
6. 回答内容と表示メタデータが実行記録と一致すること
7. exact candidate SHAのCIと監査
8. 必要なオーナー承認

新しいAIが高性能でも自動的には有効化しない。既存AIが終了・有料化・品質低下した場合も、別AIへ黙って切り替えず、利用可能な証拠付き候補がなければ停止する。

## 10. 共通回答形式

すべてのproviderは、一般UIへ直接固有形式を返さず、`origin.answer.v1`へ変換する。共通回答は、結論、本文、根拠、独立確認状態、制約、次の行動、実在する成果物参照だけを持つ。

provider ID、model ID、trace ID、実費用などは回答本文と分離した技術証跡に保持する。別AIによる確認を実行していない回答を`passed`にせず、実在するartifact参照がないグラフ、画像、文書を生成済みとして表示しない。

正式`/api/chat`は後方互換の`content`と並行して`origin.answer.v1`を返す。Personal UIは検証済みのenvelopeがある場合だけ、結論、回答、根拠、確認状況、制約、次の行動を表示する。不正または不完全なenvelopeは構造化表示に使わず、既存の安全な`content`へ戻す。
