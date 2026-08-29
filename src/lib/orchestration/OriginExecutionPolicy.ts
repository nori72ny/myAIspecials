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

/**
 * ORIGIN Personal's production zero-cost route is intentionally single-provider.
 * Other provider IDs remain exported for compatibility with legacy callers/tests,
 * but the execution planner never selects them as an automatic fallback.
 */
export const ORIGIN_ZERO_COST_PROVIDER_IDS: readonly OriginExecutionProviderId[] = [
  ORIGIN_OPENROUTER_FREE_PROVIDER_ID,
];

export interface OriginExecutionAvailability {
  openRouterConfigured: boolean;
  googleAiStudioConfigured?: boolean;
  groqConfigured?: boolean;
}

export interface OriginExecutionPolicy {
  freeOnly: true;
  maxEstimatedCostUsd: number;
  timeoutMs: number;
}

export interface OriginProviderDataPolicy {
  /** Legacy callers may still construct true, but production execution rejects it. */
  allowProviderFallbacks: boolean;
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
  allowProviderFallbacks: false,
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
  if (!availability.openRouterConfigured) {
    return { ok: false, code: "FREE_PROVIDER_NOT_CONFIGURED", message: "ORIGINの固定無料実行に必要なOpenRouterが設定されていません。" };
  }
  const freeModelResult = selectCurrentOriginFreeModel(
    planningOptions.freeModelCatalog ?? DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
    planningOptions.nowMs ?? Date.now(),
  );
  if (freeModelResult.ok === false) return freeModelResult;
  const taskType = classifyTask(request);
  const model = freeModelResult.model;
  if (model.providerId !== ORIGIN_OPENROUTER_FREE_PROVIDER_ID) {
    return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "ORIGINの固定無料経路はOpenRouterモデルのみを許可します。" };
  }
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
      reason: `依頼を「${taskType}」として分類し、OpenRouterの許可済み無料モデル1経路だけで0ドル固定ポリシーで実行します。プロバイダー間フォールバックは行いません。`,
      providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
      modelEvidence: { verifiedAt: model.verifiedAt, reviewAfter: model.reviewAfter, sourceUrl: model.sourceUrl },
    },
  };
}
