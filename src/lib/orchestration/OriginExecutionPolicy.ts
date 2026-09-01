import { classifyTask, type AITaskRequest, type AITaskType } from "./MultiAIOrchestrator.js";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG, ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL, selectCurrentOriginFreeModel, type OriginFreeModelEvidence } from "./OriginFreeModelCatalog.js";

export const ORIGIN_OPENROUTER_FREE_PROVIDER_ID = "openrouter-free" as const;
export const ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID = "google-ai-studio-free" as const;
export const ORIGIN_GROQ_FREE_PROVIDER_ID = "groq-free" as const;
export const ORIGIN_OPENROUTER_FREE_MODEL = ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL;
export const ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL = "gemini-2.5-flash" as const;
export const ORIGIN_GROQ_FREE_MODEL = "llama-3.3-70b-versatile" as const;

export type OriginExecutionProviderId = typeof ORIGIN_OPENROUTER_FREE_PROVIDER_ID | typeof ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID | typeof ORIGIN_GROQ_FREE_PROVIDER_ID;
export const ORIGIN_ZERO_COST_PROVIDER_IDS: readonly OriginExecutionProviderId[] = [ORIGIN_OPENROUTER_FREE_PROVIDER_ID, ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID, ORIGIN_GROQ_FREE_PROVIDER_ID];

export interface OriginExecutionAvailability { openRouterConfigured: boolean; googleAiStudioConfigured?: boolean; groqConfigured?: boolean; }
export interface OriginExecutionPolicy { freeOnly: true; maxEstimatedCostUsd: number; timeoutMs: number; }
export interface OriginProviderDataPolicy { allowProviderFallbacks: true; dataCollection: "deny"; requireZeroDataRetention: false; }
export interface OriginProviderFreeEvidence { verifiedAt: string; reviewAfter: string; sourceUrl: string; }
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
  modelEvidence: OriginProviderFreeEvidence;
}
export interface OriginExecutionPlanningOptions {
  freeModelCatalog?: readonly OriginFreeModelEvidence[];
  providerEvidence?: Partial<Record<OriginExecutionProviderId, OriginProviderFreeEvidence>>;
  nowMs?: number;
}
export type OriginExecutionPlanFailureCode = "FREE_PROVIDER_NOT_CONFIGURED" | "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE" | "INVALID_EXECUTION_POLICY";
export type OriginExecutionPlanResult = { ok: true; plan: OriginExecutionPlan } | { ok: false; code: OriginExecutionPlanFailureCode; message: string };
export const DEFAULT_ORIGIN_EXECUTION_POLICY: OriginExecutionPolicy = { freeOnly: true, maxEstimatedCostUsd: 0, timeoutMs: 20_000 };
export const DEFAULT_ORIGIN_PROVIDER_DATA_POLICY: OriginProviderDataPolicy = { allowProviderFallbacks: true, dataCollection: "deny", requireZeroDataRetention: false };

function normalizePolicy(policy?: Partial<OriginExecutionPolicy>): OriginExecutionPolicy | null {
  const maxEstimatedCostUsd = policy?.maxEstimatedCostUsd ?? 0;
  const requestedTimeoutMs = policy?.timeoutMs ?? DEFAULT_ORIGIN_EXECUTION_POLICY.timeoutMs;
  if (!Number.isFinite(maxEstimatedCostUsd) || maxEstimatedCostUsd !== 0) return null;
  if (!Number.isInteger(requestedTimeoutMs) || requestedTimeoutMs < 1_000 || requestedTimeoutMs > 120_000) return null;
  return { freeOnly: true, maxEstimatedCostUsd: 0, timeoutMs: Math.min(DEFAULT_ORIGIN_EXECUTION_POLICY.timeoutMs, requestedTimeoutMs) };
}

function chooseProvider(taskType: AITaskType, availability: OriginExecutionAvailability): OriginExecutionProviderId {
  const configured: OriginExecutionProviderId[] = [];
  const add = (provider: OriginExecutionProviderId, ok: boolean | undefined) => { if (ok) configured.push(provider); };
  const gemini = availability.googleAiStudioConfigured === true;
  const openrouter = availability.openRouterConfigured === true;
  const groq = availability.groqConfigured === true;
  const preferred: OriginExecutionProviderId[] = (() => {
    switch (taskType) {
      case "implementation":
      case "test":
      case "documentation":
        return [ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID, ORIGIN_GROQ_FREE_PROVIDER_ID, ORIGIN_OPENROUTER_FREE_PROVIDER_ID];
      case "research":
      case "current-information":
        return [ORIGIN_OPENROUTER_FREE_PROVIDER_ID, ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID, ORIGIN_GROQ_FREE_PROVIDER_ID];
      case "security":
      case "architecture":
      case "review":
      case "ux":
      case "operations":
      default:
        return [ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID, ORIGIN_OPENROUTER_FREE_PROVIDER_ID, ORIGIN_GROQ_FREE_PROVIDER_ID];
    }
  })();
  for (const provider of preferred) {
    const enabled = provider === ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID ? gemini : provider === ORIGIN_OPENROUTER_FREE_PROVIDER_ID ? openrouter : groq;
    add(provider, enabled);
  }
  return configured[0] ?? ORIGIN_OPENROUTER_FREE_PROVIDER_ID;
}

function parseEvidence(evidence: OriginProviderFreeEvidence, nowMs: number): OriginExecutionPlanResult | null {
  const verifiedAt = Date.parse(evidence.verifiedAt);
  const reviewAfter = Date.parse(evidence.reviewAfter);
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(reviewAfter) || reviewAfter <= verifiedAt || !evidence.sourceUrl.startsWith("https://")) {
    return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料Providerの証拠が不正です。" };
  }
  if (nowMs < verifiedAt || nowMs > reviewAfter) {
    return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "選択Providerの無料利用証拠が期限切れです。再確認まで実行を停止します。" };
  }
  return null;
}

function resolveProviderEvidence(
  providerId: OriginExecutionProviderId,
  planningOptions: OriginExecutionPlanningOptions,
  nowMs: number,
): OriginProviderFreeEvidence | OriginExecutionPlanResult {
  if (providerId === ORIGIN_OPENROUTER_FREE_PROVIDER_ID) {
    const result = selectCurrentOriginFreeModel(planningOptions.freeModelCatalog ?? DEFAULT_ORIGIN_FREE_MODEL_CATALOG, nowMs);
    if ("model" in result) return result.model;
    return { ok: false, code: result.code, message: result.message };
  }
  const evidence = planningOptions.providerEvidence?.[providerId];
  if (!evidence) return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "選択Providerの無料利用証拠が未設定です。証拠を確認するまで実行を停止します。" };
  return parseEvidence(evidence, nowMs) ?? evidence;
}

export function buildOriginExecutionPlan(request: AITaskRequest, availability: OriginExecutionAvailability, policyInput?: Partial<OriginExecutionPolicy>, planningOptions: OriginExecutionPlanningOptions = {}): OriginExecutionPlanResult {
  const policy = normalizePolicy(policyInput);
  if (!policy) return { ok: false, code: "INVALID_EXECUTION_POLICY", message: "実行ポリシーの値が正しくありません。" };
  if (!availability.openRouterConfigured && !availability.googleAiStudioConfigured && !availability.groqConfigured) return { ok: false, code: "FREE_PROVIDER_NOT_CONFIGURED", message: "明示的に無料と確認できるAIプロバイダーが設定されていません。" };
  const nowMs = planningOptions.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料Provider証拠の基準時刻が不正です。" };
  const taskType = classifyTask(request);
  const providerId = chooseProvider(taskType, availability);
  const evidence = resolveProviderEvidence(providerId, planningOptions, nowMs);
  if ("ok" in evidence && evidence.ok === false) return evidence;
  const modelEvidence = evidence as OriginProviderFreeEvidence;
  const providerLabel = providerId === ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID ? "Google AI Studio" : providerId === ORIGIN_GROQ_FREE_PROVIDER_ID ? "Groq" : "ORIGIN 無料AI";
  const modelId = providerId === ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID ? ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL : providerId === ORIGIN_GROQ_FREE_PROVIDER_ID ? ORIGIN_GROQ_FREE_MODEL : ORIGIN_OPENROUTER_FREE_MODEL;
  return { ok: true, plan: { providerId, providerLabel, modelId, taskType, freeOnly: true, estimatedCostUsd: 0, timeoutMs: policy.timeoutMs, requiresOwnerApproval: false, reason: `依頼を「${taskType}」として分類し、設定済みの無料Providerからタスク適合性を優先して${providerLabel} / ${modelId}を選択します。選択Provider自身の無料利用証拠が期限内である場合のみ実行し、有料モデルには切り替えません。`, providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, modelEvidence } };
}
