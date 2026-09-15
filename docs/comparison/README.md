# 他AIとの回答比較（API不要）

同じプロンプトをORIGIN・ChatGPT・Claude・Gemini等へ渡し、返ってきた
JSONをそのまま採点できます。モデルに課金する処理や回答コードの実行は
ありません。相手のサービスにログインして回答を取得する操作は別です。
この機能は比較用スクリプトで、ORIGIN画面への追加・本番公開は未実施です。
V2は16問を「計算・論理」「根拠・不確実性」「安全境界」「コード・検証」
の4カテゴリへ均等に分け、総点とカテゴリ別点を同時に出します。

## 共通プロンプト

新規チャットで、検索・コード実行をオフにして同じ文を渡します。後述の
参考回答や採点器は見せません。利用日時、表示モデル名、サービス、追加
指示、ツール利用の有無を記録します。無料枠で応答しなかったケースも
除外せず、未実行として別途記録してください。

共通プロンプトはコードと二重管理せず、必ず次のコマンドから生成した全文を
各参加モデルへそのまま渡します。

```sh
node --import tsx scripts/compare-ai-answers-v14.ts prompt
```

返答形式は `{"suite":"origin-answer-checks-v2","answers":{...}}` です。

## 採点

正式な比較では全参加者に同一のプロンプト文字列を使ってください。
スクリプトからも共通プロンプトを出力できます。

```sh
node --import tsx scripts/compare-ai-answers-v14.ts score answers.json '表示モデル名' '日時・サービス・条件'
node --import tsx scripts/compare-ai-answers-v14.ts compare participants.json
node --import tsx scripts/compare-ai-answers-v14.ts report participants.json
```

participants.jsonは最大8件の配列です。各要素はparticipant（名前）、
provenance（実行条件）、response（生の回答文字列）の3項目です。
回答が不正JSONなら0/16、欠落課題も分母16に残します。余分な課題IDは
unknownTaskIdsに表示します。速度・料金・モデルの本人性は検証しません。
reportは課題別・カテゴリ別の結果表、実行条件、再確認する課題をMarkdownで出力します。
生の回答は再掲せず、総合性能の順位や未参加モデルの成績を生成しません。
厳密な指定JSONとの一致を採点するため、一般的な文章品質・コード生成の
同値性・大規模開発能力を測るものではありません。

## この会話のChatGPT回答

chatgpt-session-reference.jsonは、この会話のアシスタントが作成した参考
回答です。課題・採点基準を見た後の回答で、盲検比較ではありません。
ユーザー指定の「Astra」という表示と実際のAPIモデルIDとの同一性は
確認していません。Astra APIを実行したという記録ではありません。
ORIGIN・他社モデルの未取得回答を捏造して順位を出すことはしません。

実モデルの回答をこの会話に貼り付ければ、同じ基準で比較できます。
苦手な課題を改善した後は新しい未使用課題でも確認し、公開済み16問への
過剰適合を避けてください。参考回答の満点は他AIへの優位性を意味しません。
