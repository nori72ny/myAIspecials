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

const TASK_LABELS: Partial<Record<AITaskType, string>> = {
  security: "セキュリティ",
  operations: "運用",
  architecture: "設計",
  "current-information": "最新情報",
};

const USER_REVIEW_TERMS = [
  "別のai",
  "別ai",
  "レビューしてください",
  "独立レビュー",
  "独立確認",
  "相互レビュー",
  "二重確認",
  "クロスチェック",
  "another ai",
  "independent review",
  "independent check",
  "cross-check",
  "review this",
] as const;

const CONSEQUENTIAL_TERMS = [
  "医療",
  "健康",
  "法律",
  "弁護士",
  "交通事故",
  "投資",
  "金融",
  "税金",
  "契約",
  "脆弱",
  "認証",
  "本番",
  "デプロイ",
  "マージ",
  "課金",
  "medical",
  "health",
  "legal",
  "investment",
  "finance",
  "security",
  "production",
  "deploy",
  "billing",
  "payment",
] as const;

const FRESH_CLAIM_TERMS = [
  "最新",
  "現在",
  "今日",
  "ニュース",
  "料金",
  "価格",
  "天気",
  "リアルタイム",
  "current",
  "today",
  "latest",
  "news",
  "price",
  "weather",
  "real-time",
] as const;

function containsAnyTerm(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLocaleLowerCase();
  return terms.some((term) => normalized.includes(term));
}

export function decideOriginReview(
  input: OriginReviewPolicyInput,
): OriginReviewPolicyDecision {
  const reasons: string[] = [];

  if (input.userRequestedReview) reasons.push("ユーザーが独立レビューを指定しました。");
  if (input.consequential) reasons.push("結果が重要な判断または操作に影響します。");
  if (input.containsFreshClaims) reasons.push("最新性を必要とする主張が含まれます。");
  if (HIGH_RISK_TASKS.has(input.taskType)) {
    reasons.push(`依頼種別「${TASK_LABELS[input.taskType] ?? input.taskType}」は独立確認の対象です。`);
  }
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

export function decideOriginReviewForMessage(
  taskType: AITaskType,
  message: string,
): OriginReviewPolicyDecision {
  return decideOriginReview({
    taskType,
    consequential: containsAnyTerm(message, CONSEQUENTIAL_TERMS),
    containsFreshClaims: containsAnyTerm(message, FRESH_CLAIM_TERMS),
    userRequestedReview: containsAnyTerm(message, USER_REVIEW_TERMS),
  });
}
