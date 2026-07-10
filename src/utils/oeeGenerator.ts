import { AnalysisResult } from "../types";

export function generateOEEPrompt(result: AnalysisResult): string {
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

  return `
あなたはGoogle DeepMind Evaluation Teamとして設計された「Output Evaluation Engine (OEE)」です。
AI同士が採点し合うための自動判定システムとして機能してください。
人間が読む前提ではなく、後続のシステムがパースしやすい厳格な構造で出力してください。

【評価対象の成果物】
---
${finalOutput}
---

【評価指示】
以下の15項目について、それぞれ「スコア（100点満点）」と「グレード（S/A/B/C/D）」を算出し、JSONフォーマットで出力してください。

1. Accuracy (正確性)
2. Fact Check
3. Freshness (最新情報)
4. Logic (論理性)
5. Comprehensiveness (網羅性)
6. Readability (読みやすさ)
7. Japanese Quality (日本語品質)
8. Design (デザイン性)
9. Practicality (実用性)
10. AI Hallucination (ハルシネーションのなさ)
11. Confidence (信頼度)
12. Reusability (再利用性)
13. Prompt Quality (プロンプト品質)
14. Structural Quality (構造品質)
15. World Top Company Gap (世界トップ企業レベルとの差)

また、以下の項目も含めてください：

- UQI (Output Unified Quality Index): 全体の統合スコア（100点満点）
- 改善点 (必須修正 / 推奨修正 / あると良い / 将来的な改善)
- Readiness (以下の4要件に対して true/false とその理由)
  1. 営業先へ提出して問題ないか
  2. 法務レビューなしで提出できるか
  3. 経営会議へ提出できるか
  4. 社外公開できるか
- 世界トップ企業レベルからの改善提案
  (Apple, Google, OpenAI, Anthropic, Linear, Notion の各視点からの具体的な改善案)

【出力形式 (JSON)】
\`\`\`json
{
  "UQI": 95,
  "evaluations": {
    "accuracy": { "score": 95, "grade": "S" },
    // ...他の14項目
  },
  "improvements": {
    "mandatory": ["..."],
    "recommended": ["..."],
    "niceToHave": ["..."],
    "future": ["..."]
  },
  "readiness": {
    "salesReady": { "status": true, "reason": "..." },
    "legalReady": { "status": false, "reason": "..." },
    "boardReady": { "status": true, "reason": "..." },
    "publicReady": { "status": false, "reason": "..." }
  },
  "topCompanyPerspectives": {
    "Apple": "...",
    "Google": "...",
    "OpenAI": "...",
    "Anthropic": "...",
    "Linear": "...",
    "Notion": "..."
  }
}
\`\`\`
`.trim();
}
