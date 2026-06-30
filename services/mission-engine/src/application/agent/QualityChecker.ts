import { OutputFormat } from "./OutputValidator";

export interface QualityIssue {
  type: "Hallucination" | "MissingData" | "EmptyResponse" | "InvalidJSON";
  description: string;
  severity: "High" | "Medium" | "Low";
}

export class QualityChecker {
  public static check(
    content: string,
    expectedFormat: OutputFormat,
    successCriteria: string[] = []
  ): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 1. EmptyResponse
    if (!content || content.trim() === "") {
      issues.push({
        type: "EmptyResponse",
        description: "エージェントの出力結果が空です。",
        severity: "High"
      });
      return issues;
    }

    // 2. InvalidJSON
    if (expectedFormat === "JSON") {
      let cleanContent = content.trim();
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent.replace(/^```json/, "").replace(/```$/, "").trim();
      } else if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.replace(/^```/, "").replace(/```$/, "").trim();
      }
      try {
        JSON.parse(cleanContent);
      } catch (err) {
        issues.push({
          type: "InvalidJSON",
          description: `期待されたJSONフォーマットが壊れています: ${(err as Error).message}`,
          severity: "High"
        });
      }
    }

    // 3. Hallucination (Placeholder values, obvious mocks)
    const hallucinationRegexes = [
      /\[Insert[^\]]*\]/i,
      /\[Your Name\]/i,
      /TODO:/i,
      /PLACEHOLDER/i,
      /Lorem Ipsum/i,
      /\[Placeholder[^\]]*\]/i,
      /example\.com/i,
      /123-456-7890/i
    ];

    for (const regex of hallucinationRegexes) {
      const match = content.match(regex);
      if (match) {
        issues.push({
          type: "Hallucination",
          description: `仮置き、またはハルシネーションのプレースホルダーが検出されました: "${match[0]}"`,
          severity: "Medium"
        });
      }
    }

    // 4. MissingData (Verify against success criteria)
    for (const criterion of successCriteria) {
      const cleanCriterion = criterion.replace(/^[-*+]\s+/, "").trim();
      if (cleanCriterion.length > 5) {
        const containsCriterion = content.toLowerCase().includes(cleanCriterion.toLowerCase()) ||
          cleanCriterion.split(/\s+/).some(word => word.length > 4 && content.toLowerCase().includes(word.toLowerCase()));
        
        if (!containsCriterion) {
          issues.push({
            type: "MissingData",
            description: `ミッションの成功基準を満たす情報が不足している可能性があります: "${criterion}"`,
            severity: "Low"
          });
        }
      }
    }

    return issues;
  }
}
