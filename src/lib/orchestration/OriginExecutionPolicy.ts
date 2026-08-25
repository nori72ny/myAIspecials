import { classifyTask, type AITaskRequest, type AITaskType } from "./MultiAIOrchestrator.js";
import {
  DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
  ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
  selectCurrentOriginFreeModel,
  type OriginFreeModelEvidence,
} from "./OriginFreeModelCatalog.js";

export const ORIGIN_OPENROUTER_FREE_PROVIDER_ID = "openrouter-free" as const;
export const ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID = "google-ai-studio-free" as const;
export const ORIGIN_GROQ_FREE_PROVIDER_ID = "groq-free" as const;
export const ORIGIN_OPENROUTER_FREE_MODEL = ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL;
export const ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL = "gemini-2.5-flash" as const;
export const ORIGIN_GROQ_FREE_MODEL = "llama-3.3-70b-versatile" as const;

export type OriginExecutionProviderId =
  | typeof ORIGIN_OPENROUTER_FREE_PROVIDER_ID
  | typeof ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID
  | typeof ORIGIN_GROQ_FREE_PROVIDER_ID;

export const ORIGIN_ZERO_COST_PROVIDER_IDS: readonly OriginExecutionProviderId[] = [
  ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
  ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID,
  ORIGIN_GROQ_FREE_PROVIDER_ID,
];

export interface OriginExecutionAvailability {
  openRouterConfigured: boolean;
  googleAiStudioConfigured?: boolean;
  groqConfigured?: boolean;
}

export interface OriginExecutionPolicy {
  freeOnly: true;
  maxEstimatedCostUsd: 0;
  timeoutMs: number;
}

export interface OriginProviderDataPolicy {
  allowProviderFallbacks: true;
  dataCollection: "deny";
  requireZeroDataRetention: false;
}

export interface OriginExecutionPlan {
  providerId: OriginExecutionProviderId;
  providerLabel: string;
  modelId: string;
  taskType: AITaskType;
  freeOnly: true;
  estimatedCostUsd: 0;
  timeoutMs: number;
  requiresOwnerApproval: false;
  reason: string;
  providerDataPolicy: OriginProviderDataPolicy;
  modelEvidence: { verifiedAt: string; reviewAfter: string; sourceUrl: string };
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
  timeoutMs: 20_000,
};

export const DEFAULT_ORIGIN_PROVIDER_DATA_POLICY: OriginProviderDataPolicy = {
  allowProviderFallbacks: true,
  dataCollection: "deny",
  requireZeroDataRetention: false,
};

function normalizePolicy(policy?: Partial<OriginExecutionPolicy>): OriginExecutionPolicy | null {
  const maxEstimatedCostUsd = policy?.maxEstimatedCostUsd ?? 0;
  const requestedTimeoutMs = policy?.timeoutMs ?? DEFAULT_ORIGIN_EXECUTION_POLICY.timeoutMs;
  if (!Number.isFinite(maxEstimatedCostUsd) || maxEstimatedCostUsd !== 0) return null;
  if (!Number.isInteger(requestedTimeoutMs) || requestedTimeoutMs < 1_000 || requestedTimeoutMs > 120_000) return null;
  return { freeOnly: true, maxEstimatedCostUsd: 0, timeoutMs: Math.min(DEFAULT_ORIGIN_EXECUTION_POLICY.timeoutMs, requestedTimeoutMs) };
}

export function buildOriginExecutionPlan(
  request: AITaskRequest,
  availability: OriginExecutionAvailability,
  policyInput?: Partial<OriginExecutionPolicy>,
  planningOptions: OriginExecutionPlanningOptions = {},
): OriginExecutionPlanResult {
  const policy = normalizePolicy(policyInput);
  if (!policy) return { ok: false, code: "INVALID_EXECUTION_POLICY", message: "実行ポリシーの値が正しくありません。" };
  if (!availability.openRouterConfigured && !availability.googleAiStudioConfigured && !availability.groqConfigured) {
    return { ok: false, code: "FREE_PROVIDER_NOT_CONFIGURED", message: "明示的に無料と確認できるAIプロバイダーが設定されていません。" };
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
      reason: `依頼を「${taskType}」として分類し、0ドル固定ポリシーで実行します。一次経路が利用できない場合は許可リスト内の無料プロバイダーへ自動フォールバックし、有料モデルには切り替えません。`,
      providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
      modelEvidence: { verifiedAt: model.verifiedAt, reviewAfter: model.reviewAfter, sourceUrl: model.sourceUrl },
    },
  };
}
