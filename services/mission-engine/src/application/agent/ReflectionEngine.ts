import { QualityChecker, QualityIssue } from "./QualityChecker";
import { OutputFormat } from "./OutputValidator";

export interface ReflectionResult {
  passed: boolean;
  score: number; // 0 to 100
  issues: QualityIssue[];
  feedback: string;
}

export class ReflectionEngine {
  public static reflect(
    content: string,
    expectedFormat: OutputFormat,
    successCriteria: string[]
  ): ReflectionResult {
    const issues = QualityChecker.check(content, expectedFormat, successCriteria);

    let score = 100;
    for (const issue of issues) {
      if (issue.severity === "High") {
        score -= 45;
      } else if (issue.severity === "Medium") {
        score -= 15;
      } else {
        score -= 5;
      }
    }

    score = Math.max(0, score);
    const passed = score >= 70; // 70 is passing mark for Version 1

    let feedback = "";
    if (passed) {
      feedback = `リフレクション判定: 合格 (スコア: ${score}/100). 目立つ問題は検出されませんでした。`;
    } else {
      feedback = `リフレクション判定: 不合格 (スコア: ${score}/100). 合計 ${issues.length} 件の品質課題が指摘されました。\n` +
        `詳細指摘事項:\n` +
        issues.map(i => ` - [${i.type}] ${i.description} (重要度: ${i.severity})`).join("\n");
    }

    return {
      passed,
      score,
      issues,
      feedback
    };
  }
}
