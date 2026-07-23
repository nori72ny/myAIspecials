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
| 独立AIレビュー判断 | `OriginReviewPolicy`を正式`/api/chat`へ接続、必要性・理由・未実施時の制約を表示 | TEST-COVERED |
| 独立providerレビューと統合 | `OriginReviewSynthesis`、`OriginReviewedExecution`のunit test | TEST-COVERED / ROUTE-UNCONNECTED |
| 根拠・引用・事実検証 | AI提示の公開HTTPS形式の出典を`provided`として表示。URL基本形式、本文、更新時点、回答との一致を別々に記録し、未確認を`source-checked`へ昇格させない。内容確認は未接続 | TEST-COVERED / SOURCE-CHECK-UNCONNECTED |
| 主張と出典の対応 | 同一行の明示記法`主張 〔出典: [資料名](https://...)〕`だけを`explicit-inline-citation`として抽出。近接文や一般リンクから意味を推測しない | TEST-COVERED / CONTENT-UNVERIFIED |
| 出典確認の実行境界 | `OriginSourceVerification`が1回実行、公開HTTPS、リダイレクトなし、記録鮮度、本文digest、主張一致、実費`$0.00`を検証。実executorは未接続 | TEST-COVERED / ROUTE-UNCONNECTED |
| 回答、費用、使用AI、検証状態の表示 | Personal Unified Chat test | TEST-COVERED |
| グラフ・図解・成果物の適応表示 | Personal正式経路との接続証拠なし | NOT IMPLEMENTED |
| 個人記憶と継続学習 | 一次リリースUIから非表示 | NOT IMPLEMENTED |
| AI Studio direct runtime | fail-closed境界のみ、正式route未接続 | BLOCKED |
| 旧Dashboardのサンプル・fallback表示 | production UI/serverから未import、legacy APIとMission Engineも未mount、release boundary test追加 | TEST-COVERED / SOURCE-REMAINS |

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

各出典は、URL安全性、本文確認、更新時点、回答内の主張との一致を独立した検査状態として保持する。AIがリンクを提示しただけの場合はURL形式のみを確認済みとし、本文、更新時点、回答との一致は`not-run`のままにする。`source-checked`は、出典本文と回答との一致を記録上確認でき、更新時点を確認済みまたは確認対象外と判断した場合だけ使用する。

主張と出典の対応は意味推定で生成しない。正式回答では、同一行の`主張 〔出典: [資料名](https://...)〕`または英語の`statement 〔Source: [label](https://...)〕`だけを明示的な対応として抽出する。一般的なMarkdownリンク、別行のリンク、後置された参考資料一覧、引用ブロックの近接関係だけでは対応済みと扱わない。未確認時の一般UIは「AIが対応付けた主張」と表示し、ORIGINが内容を確認したように見せない。

明示対応は`claimBinding: explicit-inline-citation`として保持する。出典確認ゲートは、出典URLと主張に加えてこの結び付け方式がない要求を拒否する。同じURLが複数の主張へ明示対応されている場合は、主張単位の別々の検証対象として保持し、一つの主張の成功を他の主張へ流用しない。

出典確認executorへ渡す要求は、検証ID、確認対象の主張、正規化した公開HTTPS URL、最大費用`$0.00`、最大1回、リダイレクト禁止、公開ネットワーク限定を含む。返却記録は、同一の検証ID・主張・URL、HTTP 200、リダイレクトなし、公開アドレス限定、取得時刻、本文のSHA-256 digest、実費`$0.00`を満たす必要がある。記録が不正、古い、不一致、未確認、有料、またはexecutor未接続の場合は`provided`のまま維持し、再試行や別経路へのfallbackを行わない。

この実行境界のunit testは、実際の外部取得、DNS解決の安全性、出典内容の正しさを証明しない。正式`/api/chat`にはまだ接続せず、利用可能な無料executor、データポリシー、ネットワーク制御、実行証跡が別途確認できるまで有効化しない。

provider ID、model ID、trace ID、実費用などは回答本文と分離した技術証跡に保持する。別AIによる確認を実行していない回答を`passed`にせず、実在するartifact参照がないグラフ、画像、文書を生成済みとして表示しない。

正式`/api/chat`は後方互換の`content`と並行して`origin.answer.v1`を返す。Personal UIは検証済みのenvelopeがある場合だけ、結論、回答、根拠、確認状況、制約、次の行動を表示する。不正または不完全なenvelopeは構造化表示に使わず、既存の安全な`content`へ戻す。

構造化回答の冒頭には、数値化した根拠のない信頼度を表示せず、「出典内容をどこまで確認したか」と「独立した別AIの確認を実施したか」を分離した確認範囲を表示する。出典なし、未確認、確認済みと未確認の混在、すべて確認済みを区別し、出典確認と別AI確認を同一の意味として扱わない。

`origin.answer.v1`の独立確認状態と実行記録の確認状態が一致しない場合、Personal UIは構造化回答を採用しない。成功応答であっても、空または文字列ではない本文は無効なprovider応答として拒否し、回答済みと表示しない。
