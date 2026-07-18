import { classifyTask, type AITaskRequest, type AITaskType } from "./MultiAIOrchestrator";

export const ORIGIN_OPENROUTER_FREE_PROVIDER_ID = "openrouter-free" as const;
export const ORIGIN_OPENROUTER_FREE_MODEL = "google/gemini-2.5-flash:free" as const;

export type OriginExecutionProviderId = typeof ORIGIN_OPENROUTER_FREE_PROVIDER_ID;

export interface OriginExecutionAvailability {
  openRouterConfigured: boolean;
}

export interface OriginExecutionPolicy {
  freeOnly: true;
  maxEstimatedCostUsd: number;
  timeoutMs: number;
}

export interface OriginExecutionPlan {
  providerId: OriginExecutionProviderId;
  providerLabel: string;
  modelId: typeof ORIGIN_OPENROUTER_FREE_MODEL;
  taskType: AITaskType;
  freeOnly: true;
  estimatedCostUsd: 0;
  timeoutMs: number;
  requiresOwnerApproval: false;
  reason: string;
}

export type OriginExecutionPlanFailureCode =
  | "FREE_PROVIDER_NOT_CONFIGURED"
  | "INVALID_EXECUTION_POLICY";

export type OriginExecutionPlanResult =
  | { ok: true; plan: OriginExecutionPlan }
  | { ok: false; code: OriginExecutionPlanFailureCode; message: string };

export const DEFAULT_ORIGIN_EXECUTION_POLICY: OriginExecutionPolicy = {
  freeOnly: true,
  maxEstimatedCostUsd: 0,
  timeoutMs: 30_000,
};

function normalizePolicy(policy?: Partial<OriginExecutionPolicy>): OriginExecutionPolicy | null {
  const maxEstimatedCostUsd = policy?.maxEstimatedCostUsd ?? DEFAULT_ORIGIN_EXECUTION_POLICY.maxEstimatedCostUsd;
  const timeoutMs = policy?.timeoutMs ?? DEFAULT_ORIGIN_EXECUTION_POLICY.timeoutMs;

  if (!Number.isFinite(maxEstimatedCostUsd) || maxEstimatedCostUsd < 0) return null;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) return null;

  return {
    freeOnly: true,
    maxEstimatedCostUsd,
    timeoutMs,
  };
}

export function buildOriginExecutionPlan(
  request: AITaskRequest,
  availability: OriginExecutionAvailability,
  policyInput?: Partial<OriginExecutionPolicy>,
): OriginExecutionPlanResult {
  const policy = normalizePolicy(policyInput);
  if (!policy) {
    return {
      ok: false,
      code: "INVALID_EXECUTION_POLICY",
      message: "実行ポリシーの値が正しくありません。",
    };
  }

  if (!availability.openRouterConfigured) {
    return {
      ok: false,
      code: "FREE_PROVIDER_NOT_CONFIGURED",
      message: "明示的に無料と確認できるAIプロバイダーが設定されていません。",
    };
  }

  const taskType = classifyTask(request);

  return {
    ok: true,
    plan: {
      providerId: ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
      providerLabel: "ORIGIN 無料AI",
      modelId: ORIGIN_OPENROUTER_FREE_MODEL,
      taskType,
      freeOnly: true,
      estimatedCostUsd: 0,
      timeoutMs: policy.timeoutMs,
      requiresOwnerApproval: false,
      reason: `依頼を「${taskType}」として分類し、明示的な無料モデルだけを使用するポリシーに適合する実行先を選択しました。`,
    },
  };
}
