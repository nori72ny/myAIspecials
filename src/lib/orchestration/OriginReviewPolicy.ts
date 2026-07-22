import type { AITaskType } from "./MultiAIOrchestrator";

export interface OriginReviewPolicyInput {
  taskType: AITaskType;
  consequential: boolean;
  containsFreshClaims: boolean;
  userRequestedReview: boolean;
  primaryConfidence?: number;
}

export interface OriginReviewPolicyDecision {
  required: boolean;
  reasons: string[];
}

const HIGH_RISK_TASKS = new Set<AITaskType>([
  "security",
  "operations",
  "architecture",
  "current-information",
]);

export function decideOriginReview(
  input: OriginReviewPolicyInput,
): OriginReviewPolicyDecision {
  const reasons: string[] = [];

  if (input.userRequestedReview) reasons.push("ユーザーが独立レビューを指定しました。");
  if (input.consequential) reasons.push("結果が重要な判断または操作に影響します。");
  if (input.containsFreshClaims) reasons.push("最新性を必要とする主張が含まれます。");
  if (HIGH_RISK_TASKS.has(input.taskType)) reasons.push(`依頼種別「${input.taskType}」は独立確認の対象です。`);
  if (
    typeof input.primaryConfidence === "number"
    && Number.isFinite(input.primaryConfidence)
    && input.primaryConfidence < 0.8
  ) reasons.push("一次回答の信頼度が監査基準を下回っています。");

  return {
    required: reasons.length > 0,
    reasons,
  };
}
