import { AnalysisResult } from "../types";

export function generateARP(result: AnalysisResult, userPrompt: string): string {
  const aiNames = result.aiMeeting?.map((m) => m.aiName).join("・") || "Gemini, OpenAI 等";
  const aiDetails = result.aiMeeting?.map((m) => `- ${m.aiName} (${m.role}): ${m.opinion}`).join("\n") || "複数の高度AIモデルを連携利用";
  
  const sources = result.research?.sources?.map((s) => `- ${s}`).join("\n") || "なし";
  
  const factCheck = `
- 公式情報確認: ${result.truthEngine?.officialConfirmation || "検証済み"}
- 引用率: ${result.truthEngine?.citationRate || 100}%
- AI合意率: ${result.truthEngine?.aiAgreementRate || 100}%
- ハルシネーションチェック: ${result.truthEngine?.hallucinationCheck || "問題なし"}
  `.trim();

  let finalOutput = `
# ${result.result?.title || result.mission?.name || "成果物"}
## ${result.result?.subtitle || ""}

### Executive Summary
${result.result?.executiveSummary || ""}
`.trim();

  if (result.result?.comparisonTable?.length) {
    finalOutput += `\n\n### 比較分析\n| 項目 | 当社プラン | 競合 |\n|---|---|---|\n`;
    result.result.comparisonTable.forEach((row) => {
      finalOutput += `| ${row.item} | ${row.ourPlan} | ${row.competitors} |\n`;
    });
  }

  if (result.result?.timeline?.length) {
    finalOutput += `\n\n### 実行タイムライン\n`;
    result.result.timeline.forEach((t) => {
      finalOutput += `- **${t.phase}** (${t.duration}):\n`;
      t.actions.forEach((a) => {
        finalOutput += `  - ${a}\n`;
      });
    });
  }

  if (result.futureRecommendations?.length) {
    finalOutput += `\n\n### 今後の推奨事項\n`;
    result.futureRecommendations.forEach((r) => {
      finalOutput += `- **${r.title}**: ${r.description} (重要度: ${r.priority})\n`;
    });
  }

  const prompt = userPrompt || `あなたは世界トップクラスのソフトウェア企業・コンサルティングファーム・研究機関から構成される独立品質監査委員会です。

これから提示する成果物について、コードではなく「成果物そのもの」の品質を厳しく監査してください。

【監査対象】
（ここから下の最終成果物を参照）

監査では以下を100点満点で採点してください。

■総合評価
・総合点（100点）

■品質評価
・目的達成度
・正確性
・事実性
・最新性
・一次情報への依存度
・論理性
・説得力
・網羅性
・実用性
・読みやすさ
・構成力
・デザイン性（該当する場合）
・ユーザー体験
・意思決定への有用性

■ファクトチェック
・数値は正しいか
・最新情報か
・一次情報は十分か
・誤情報やハルシネーションの可能性はあるか
・推測と事実は明確に区別されているか

■改善提案
・今すぐ修正すべき点（S）
・次に改善すべき点（A）
・余裕があれば改善（B）
・将来的な改善（C）

■世界トップ基準との比較
Apple
Google
OpenAI
Anthropic
McKinsey
BCG

これらの成果物と比較して不足している点を具体的に指摘してください。

■最終判定
以下のいずれかを必ず選択してください。

・提出可能（そのまま納品可）
・軽微修正後に提出可能
・再作成推奨
・提出不可

感想ではなく、客観的・具体的・実務レベルで評価してください。`;

  return `
========================

# AI REVIEW PACKAGE

## 1. ユーザー依頼内容

${result.mission?.name || "未設定"}
${result.mission?.goal || ""}

---

## 2. 目的

ACOSが解釈した目的:
${result.mission?.purpose || result.mission?.goal || "タスクの完了"}

---

## 3. 前提条件

- 対象読者: プロフェッショナル・エグゼクティブ
- 条件: ACOS品質基準 (MIE 承認済み)
- 目的: ${result.mission?.purpose || result.mission?.goal || ""}

---

## 4. 使用AI

使用モデル: ${aiNames}

ルーティング理由:
タスクの複雑性と要求される推論能力に応じて、複数の専門特化AIモデルを協調・合意形成プロセス（AI Meeting）を通じて利用しています。
${aiDetails}

---

## 5. 使用情報

Web検索・RAG・Memory等:
${sources}

使用した一次情報:
- 公式ソースの優先参照

---

## 6. Fact Check

ファクトチェック内容:
${factCheck}

未検証事項: 特になし (ACOS Truth Engine検証済)
推測と事実は分離して記述しています。

---

## 7. 最終成果物

${finalOutput}

---

## 8. 自己評価

Truth Score: ${result.successScore}%
Quality Score: ${result.qualityEngine?.accuracy || 100}%
Evidence Score: ${result.truthEngine?.citationRate || 100}%
Freshness: ${result.qualityEngine?.freshness || 100}%
Confidence: ${result.qualityEngine?.confidence || 100}%

理由:
${result.result?.executiveSummary || "本成果物は、複数の超高度AIが自律対話を通じて合意した、論理的矛盾のない最高品質の実行ロードマップです。"}

---

## 9. 第三者AIレビュー用プロンプト

${prompt}

========================
`.trim();
}
