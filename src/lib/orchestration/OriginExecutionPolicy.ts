import { classifyTask, type AITaskRequest, type AITaskType } from "./MultiAIOrchestrator";
import {
  DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
  ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
  selectCurrentOriginFreeModel,
  type OriginFreeModelEvidence,
  type OriginFreeModelId,
} from "./OriginFreeModelCatalog";

export const ORIGIN_OPENROUTER_FREE_PROVIDER_ID = "openrouter-free" as const;
export const ORIGIN_OPENROUTER_FREE_MODEL = ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL;

export type OriginExecutionProviderId = typeof ORIGIN_OPENROUTER_FREE_PROVIDER_ID;

export interface OriginExecutionAvailability {
  openRouterConfigured: boolean;
}

export interface OriginExecutionPolicy {
  freeOnly: true;
  maxEstimatedCostUsd: number;
  timeoutMs: number;
}

export interface OriginProviderDataPolicy {
  allowProviderFallbacks: false;
  dataCollection: "deny";
  requireZeroDataRetention: true;
}

export interface OriginExecutionPlan {
  providerId: OriginExecutionProviderId;
  providerLabel: string;
  modelId: OriginFreeModelId;
  taskType: AITaskType;
  freeOnly: true;
  estimatedCostUsd: 0;
  timeoutMs: number;
  requiresOwnerApproval: false;
  reason: string;
  providerDataPolicy: OriginProviderDataPolicy;
  modelEvidence: {
    verifiedAt: string;
    reviewAfter: string;
    sourceUrl: string;
  };
}

export interface OriginExecutionPlanningOptions {
  freeModelCatalog?: readonly OriginFreeModelEvidence[];
  nowMs?: number;
}

export type OriginExecutionPlanFailureCode =
  | "FREE_PROVIDER_NOT_CONFIGURED"
  | "FREE_MODEL_CATALOG_INVALID"
  | "FREE_MODEL_EVIDENCE_STALE"
  | "INVALID_EXECUTION_POLICY";

export type OriginExecutionPlanResult =
  | { ok: true; plan: OriginExecutionPlan }
  | { ok: false; code: OriginExecutionPlanFailureCode; message: string };

export const DEFAULT_ORIGIN_EXECUTION_POLICY: OriginExecutionPolicy = {
  freeOnly: true,
  maxEstimatedCostUsd: 0,
  timeoutMs: 30_000,
};

export const DEFAULT_ORIGIN_PROVIDER_DATA_POLICY: OriginProviderDataPolicy = {
  allowProviderFallbacks: false,
  dataCollection: "deny",
  requireZeroDataRetention: true,
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
  planningOptions: OriginExecutionPlanningOptions = {},
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

  const freeModelResult = selectCurrentOriginFreeModel(
    planningOptions.freeModelCatalog ?? DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
    planningOptions.nowMs ?? Date.now(),
  );
  if (freeModelResult.ok === false) return freeModelResult;

  const taskType = classifyTask(request);
  const model = freeModelResult.model;

  return {
    ok: true,
    plan: {
      providerId: ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
      providerLabel: model.providerLabel,
      modelId: model.modelId,
      taskType,
      freeOnly: true,
      estimatedCostUsd: 0,
      timeoutMs: policy.timeoutMs,
      requiresOwnerApproval: false,
      reason: `依頼を「${taskType}」として分類し、公式ページで無料状態を確認した明示的な無料モデルを選択しました。これは品質優位性の主張ではありません。`,
      providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
      modelEvidence: {
        verifiedAt: model.verifiedAt,
        reviewAfter: model.reviewAfter,
        sourceUrl: model.sourceUrl,
      },
    },
  };
}
