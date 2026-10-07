# 回答品質の提案対応表 — 2026-10-07

## 判定範囲

この表は、取得できた引き継ぎ資料・過去会話の検索結果と、PR #889 / #892 / #894のコード・CIを照合した部分台帳です。過去の全提案原文を回収した保証はありません。未発見の提案を「対応済み」と扱いません。

資料: ORIGIN_PERSONAL_COMPLETE_HANDOVER_2026-09-27(1).md、対話要件の第4節・回答品質の第13節・独立監査の第18節。過去会話検索では、2026-09-08のResearch案、2026-09-19のMCP/決定的文書処理案、2026-09-23のGemini監査要件と回答品質不足の要約を回収しました。これらの要約を提案原文とは扱いません。秘密評価課題は照合対象に含めません。

コード確認対象: `e78321851a6c6b9fbdfa74eebc9e3ec834fc95fc`。
このSHAのProduction Release、ACOS、CodeQL、OpenSSFは成功。これだけで本番配備・実回答の効果を証明しません。

## 項目別の対応と残件

| 項目 | 確認できたコード・検証 | 残件 / 判定 |
| --- | --- | --- |
| 質問理解・目的・制約の保持 | OriginAnswerQualityPolicyのcarried-forward constraints、originChatResponsePolicyのrequirement brief | 方針は存在。実回答での網羅率はNOT_MEASURED |
| 必要最小限の質問・回答済み事項の再利用 | clarification loop、1–3問、既知情報を再質問しない指示 | 実際の複数ターンでの検証が必要 |
| 数値・単位・分母・日付・丸め | 再計算と最小計算根拠の指示、与えた値の計算を検索不要とする分類 | モデルの数値正確性はNOT_MEASURED。指示を計算エンジンと同一視しない |
| 最新情報の自動判定 | 変換＋追加調査、別文・箇条書き、現在価格依頼の修正。応答ポリシー96ケースのオフライン検証 | 決定的な分類検証はPASS。実検索成功・回答品質は別途必要 |
| 実Web調査・複数ソース比較 | groundedResearchV11とgroundedResearchSynthesisV12を確認 | コードは存在。本番での対象タスクの成功はこの調査で未検証 |
| 出典と鮮度の表示 | evidenceLevel / freshness / sourceAuthority、S番号のHTTPS出典 | 「最近 / 古い可能性 / 不明」は正確な公開日・取得日の保証ではない。日付精度は未検証 |
| 一次情報を優先し二次情報と区別 | sourceAuthorityのofficial-domain-match / secondary-referenceを区別する合成指示 | ドメイン一致は真実性の証明ではない。一次情報の取得優先順位・実際の網羅率は未検証 |
| 根拠・推論・推奨・不確実性の区別 | research mode、wording strength、claim-local uncertainty | 方針は存在。実回答の誤断定はNOT_MEASURED |
| 矛盾検出 | groundedResearchV11のconservative-structured-only、方針で矛盾を明示 | 構造化値の差はレビュー信号。任意の文章の意味矛盾を完全検出したとは言えない |
| 引用の正確性 | S番号・URL一致・出典数・事実単位の引用・数値の支持を検証 | 引用先が全ての非数値の主張を意味的に支持する保証ではない |
| 幻覚抑制・未実行の完了誤認防止 | 発明した事実・実行・独立監査を主張しない指示 | 実行記録と回答の突合せが必要。NOT_MEASURED |
| 具体性・実用性・形式遵守 | usable deliverable、独立して進められる作業、JSON等のhard requirements | 実成果物による確認が必要 |
| 日英の表現・構成・情報密度 | bilingual frontend / server policy、自然な文頭、反復削減、必要な表、固定6節制限撤廃 | 実回答の読みやすさ・専門性・退行はNOT_MEASURED |
| Memory / Critic / Verification | untrusted memory boundary、内部3-pass、independent-review-requiredの未実行表示 | 内部自己点検を独立審査と扱わない。実行接続は別途追跡 |
| MCP・決定的な文書処理 | 2026-09-19の過去会話要約に記録 | このPR範囲では実装・接続・顧客提出前承認を未確認。回答プロンプト修正で完了にしない |
| 独立比較・継続評価 | AQ比較基盤・exact-head gate・予約guard | 全40ケース、真の複数ターン、参照AI3系統×独立judge2系統の比較は未完了 |

## 一次証拠

- [PR #889](https://github.com/nori72ny/myAIspecials/pull/889): server policy改善。Draft、未マージ。
- [PR #892](https://github.com/nori72ny/myAIspecials/pull/892): 評価専用。head `f9e7640abca1cb4c62c05d57c0208fe767fe2704`、baseline `49adca87322c9ea106ba33f9015662a747579acf`。mainへマージ・デプロイしない。
- [PR #894](https://github.com/nori72ny/myAIspecials/pull/894): #889を含む後続改善。#892ではこの後続差分を測らない。
- [応答ポリシー](https://github.com/nori72ny/myAIspecials/blob/e78321851a6c6b9fbdfa74eebc9e3ec834fc95fc/src/legacy/originChatResponsePolicy.ts)
- [回答品質ポリシー](https://github.com/nori72ny/myAIspecials/blob/e78321851a6c6b9fbdfa74eebc9e3ec834fc95fc/src/lib/orchestration/OriginAnswerQualityPolicy.ts)
- [Research report](https://github.com/nori72ny/myAIspecials/blob/e78321851a6c6b9fbdfa74eebc9e3ec834fc95fc/src/research/groundedResearchV11.ts)
- [Research synthesis](https://github.com/nori72ny/myAIspecials/blob/e78321851a6c6b9fbdfa74eebc9e3ec834fc95fc/src/research/groundedResearchSynthesisV12.ts)
- [Production Release CI](https://github.com/nori72ny/myAIspecials/actions/runs/37584698752)
- [ACOS](https://github.com/nori72ny/myAIspecials/actions/runs/37584698926)
- [CodeQL](https://github.com/nori72ny/myAIspecials/actions/runs/37584698845)
- [OpenSSF](https://github.com/nori72ny/myAIspecials/actions/runs/37584698902)

## 次の検証順序

1. #892の固定比較をguard・held-out priority・共有予約に従って一度だけ実施。予約後のprovider retryは禁止。guard skipはNOT_MEASURED。
2. sanitized evidenceのok、SHA、manifest、scorer、quota計画を確認し、制約網羅・数値・根拠・実用性・退行を分類する。単一chat shardを全体合格にしない。
3. #894の後続差分は独立の候補として別途評価する。#892の結果を流用して効果を主張しない。
4. 非数値主張と引用の意味一致、ソースの公開日/取得日、一次情報優先、複数ターンの制約維持を重点的に検証し、再現できた不具合にだけ最小修正を追加する。
5. MCP/文書処理提案は別の実行経路を追跡する。未確認は未確認のまま残す。
6. 全提案原文の回収と各項目のコード・CI・本番配備・実利用証拠が揃うまで「全提案完了」「他AI以上」「QUALIFIED」と言わない。

無料利用、秘密保護、paid fallback禁止、provider/network retry禁止、main未変更、sealed課題未閲覧を維持する。
