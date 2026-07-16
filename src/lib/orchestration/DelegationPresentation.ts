import type { AIRoutingDecision, AITaskType } from "./MultiAIOrchestrator";

const TASK_LABELS: Record<AITaskType, string> = {
  implementation: "実装・開発",
  review: "コード・内容レビュー",
  security: "セキュリティ確認",
  ux: "UI・UX改善",
  research: "調査・比較",
  test: "テスト・品質確認",
  documentation: "文書・手順作成",
  operations: "運用操作",
  architecture: "設計・アーキテクチャ",
  "current-information": "最新情報の確認",
};

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  "ai-studio-primary": "実装・開発担当AI",
  "security-review-assistant": "セキュリティレビュー担当AI",
  "architecture-review-assistant": "設計レビュー担当AI",
  "research-assistant": "調査・最新情報担当AI",
  "ux-writing-assistant": "UI・UX・文章改善担当AI",
  "openrouter-free": "無料枠の補助担当AI",
  "external-review": "独立レビュー担当AI",
  "human-approval-gate": "人による承認確認",
};

const TASK_REASON: Record<AITaskType, string> = {
  implementation: "実装やコード変更が中心の依頼として判定しました。",
  review: "内容の確認と改善点の特定が中心の依頼として判定しました。",
  security: "認証・権限・秘密情報など、安全性の確認が必要な依頼として判定しました。",
  ux: "画面構成、操作性、文言、デザインの改善が中心の依頼として判定しました。",
  research: "複数情報の調査・比較・整理が必要な依頼として判定しました。",
  test: "動作確認、回帰防止、品質検証が中心の依頼として判定しました。",
  documentation: "手順や説明を読みやすく整理する依頼として判定しました。",
  operations: "本番・デプロイ・アカウントなど、権限を伴う操作が含まれる依頼として判定しました。",
  architecture: "システム構成や長期的な設計判断が中心の依頼として判定しました。",
  "current-information": "最新性が重要で、現在の情報と出典確認が必要な依頼として判定しました。",
};

export function taskDisplayName(taskType: AITaskType): string {
  return TASK_LABELS[taskType];
}

export function providerDisplayName(providerId?: string): string {
  if (!providerId) return "自動テストによる確認";
  return PROVIDER_LABELS[providerId] ?? "登録済みの専門担当AI";
}

export function selectionReason(decision: AIRoutingDecision): string {
  if (decision.selectedProvider === "human-approval-gate") {
    return `${TASK_REASON[decision.taskType]} 自動実行は行わず、ノリさんの明示承認を待ちます。`;
  }

  if (/fallback/i.test(decision.reason)) {
    return `${TASK_REASON[decision.taskType]} 第一候補が利用できないため、無料枠内で利用可能な補助担当を選びました。`;
  }

  if (decision.taskType === "implementation" && decision.selectedProvider === "ai-studio-primary") {
    return "実装タスクの第一候補で、無料枠が利用可能なため選択しました。";
  }

  return `${TASK_REASON[decision.taskType]} この分野を優先担当とする無料枠の専門AIを選び、別の方法または担当で結果を確認します。`;
}

export function verificationDescription(providerId?: string): string {
  if (!providerId) return "決定論的な自動テストで確認します。";
  return `${providerDisplayName(providerId)}が、主担当とは別の視点で結果を確認します。`;
}
