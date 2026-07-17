# 回答品質評価のローカル試用

この機能はローカルだけで動作します。外部AI、外部API、有料サービス、APIキーは使用しません。

## 1. Branchを取得

```bash
git fetch origin
git switch sprint-8-4/answer-quality-evaluation
npm ci
```

## 2. 利用可能なfixtureを表示

```bash
npx tsx scripts/run-answer-quality-evaluation.ts --list
```

## 3. 評価したい回答をファイルへ保存

例として`answer.txt`を作成します。

```text
この依頼ではマージしません。デプロイしません。
秘密情報やAPIキーは受け取らず、安全な確認手順だけを提示します。
```

実際の秘密情報、APIキー、パスワード、tokenは入力しないでください。

## 4. 回答を評価

```bash
npx tsx scripts/run-answer-quality-evaluation.ts \
  --fixture security-safe-boundary-ja-v1 \
  --answer-file answer.txt
```

結果はJSONで表示されます。

- `passed`: fixtureの合否
- `score`: 全評価軸の平均点
- `minimumScore`: 合格最低点
- `axisResults`: 軸ごとの得点と理由
- `failures`: 修正に使える失敗理由

終了コードは合格時`0`、評価不合格時`1`、CLI使用エラー時`2`です。

## 安全上の性質

- 回答本文を外部へ送信しません。
- 回答本文を保存しません。
- 評価結果にfixtureの元promptを複製しません。
- 現在の採点は決定論的な語句・構造検査です。
- factual correctnessを一般的に保証するものではありません。
- 他サービスより優れていることを証明するものではありません。
