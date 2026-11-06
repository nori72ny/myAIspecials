import { selectOriginCapability, type OriginCapability, type OriginCapabilityDecision } from "./OriginCapabilityRouter.js";
import { classifyTask, type AITaskRequest, type AITaskType } from "./MultiAIOrchestrator.js";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG, ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL, selectCurrentOriginFreeModel, type OriginFreeModelEvidence } from "./OriginFreeModelCatalog.js";
import { ORIGIN_CLOUDFLARE_FREE_MODEL, selectCurrentOriginCloudflareFreeModel, type OriginCloudflareFreeModelEvidence } from "./OriginCloudflareFreeModelCatalog.js";

export const ORIGIN_OPENROUTER_FREE_PROVIDER_ID = "openrouter-free" as const;
export const ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID = "google-ai-studio-free" as const;
export const ORIGIN_GROQ_FREE_PROVIDER_ID = "groq-free" as const;
export const ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID = "cloudflare-workers-ai-free" as const;
export const ORIGIN_OPENROUTER_FREE_MODEL = ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL;
export const ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL = "gemini-2.5-flash" as const;
export const ORIGIN_GROQ_FREE_MODEL = "llama-3.3-70b-versatile" as const;
export const ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL = ORIGIN_CLOUDFLARE_FREE_MODEL;

export type OriginExecutionProviderId = typeof ORIGIN_OPENROUTER_FREE_PROVIDER_ID | typeof ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID | typeof ORIGIN_GROQ_FREE_PROVIDER_ID | typeof ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID;
/** Production primary route is OpenRouter. Gemini is a separately guarded secondary route only. Groq remains disabled until independently verified. */
export const ORIGIN_ZERO_COST_PROVIDER_IDS: readonly OriginExecutionProviderId[] = [ORIGIN_OPENROUTER_FREE_PROVIDER_ID, ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID];

export interface OriginExecutionAvailability { openRouterConfigured: boolean; googleAiStudioConfigured?: boolean; groqConfigured?: boolean; cloudflareConfigured?: boolean; }
export interface OriginExecutionPolicy { freeOnly: true; maxEstimatedCostUsd: number; timeoutMs: number; }
export type OriginProviderDataCollection = "deny" | "provider-free-tier";
/** Gemini's free tier is not treated as ZDR: it is an explicit privacy boundary and is only usable through the guarded secondary route. */
export interface OriginProviderDataPolicy { allowProviderFallbacks: boolean; dataCollection: OriginProviderDataCollection; requireZeroDataRetention: boolean; }
export interface OriginProviderFreeEvidence { providerId: OriginExecutionProviderId; verifiedAt: string; reviewAfter: string; sourceUrl: string; }
export interface OriginExecutionRequest extends AITaskRequest { capability?: OriginCapability; }
export interface OriginExecutionPlan {
  providerId: OriginExecutionProviderId;
  providerLabel: string;
  modelId: string;
  taskType: AITaskType;
  /** v2 capability selection is local/deterministic and never changes the zero-cost provider boundary by itself. */
  capabilityDecision?: OriginCapabilityDecision;
  freeOnly: true;
  estimatedCostUsd: 0;
  timeoutMs: number;
  requiresOwnerApproval: false;
  reason: string;
  providerDataPolicy: OriginProviderDataPolicy;
  modelEvidence: OriginProviderFreeEvidence;
}
export interface OriginExecutionPlanningOptions { freeModelCatalog?: readonly OriginFreeModelEvidence[]; cloudflareFreeModelCatalog?: readonly OriginCloudflareFreeModelEvidence[]; providerEvidence?: Partial<Record<OriginExecutionProviderId, OriginProviderFreeEvidence>>; nowMs?: number; }
export type OriginExecutionPlanFailureCode = "FREE_PROVIDER_NOT_CONFIGURED" | "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE" | "INVALID_EXECUTION_POLICY";
export type OriginExecutionPlanResult = { ok: true; plan: OriginExecutionPlan } | { ok: false; code: OriginExecutionPlanFailureCode; message: string };
export const DEFAULT_ORIGIN_EXECUTION_POLICY: OriginExecutionPolicy = { freeOnly: true, maxEstimatedCostUsd: 0, timeoutMs: 20_000 };
export const DEFAULT_ORIGIN_PROVIDER_DATA_POLICY: OriginProviderDataPolicy = { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true };

function normalizePolicy(policy?: Partial<OriginExecutionPolicy>): OriginExecutionPolicy | null {
  const maxEstimatedCostUsd = policy?.maxEstimatedCostUsd ?? 0;
  const requestedTimeoutMs = policy?.timeoutMs ?? DEFAULT_ORIGIN_EXECUTION_POLICY.timeoutMs;
  if (!Number.isFinite(maxEstimatedCostUsd) || maxEstimatedCostUsd !== 0) return null;
  if (!Number.isInteger(requestedTimeoutMs) || requestedTimeoutMs < 1_000 || requestedTimeoutMs > 120_000) return null;
  return { freeOnly: true, maxEstimatedCostUsd: 0, timeoutMs: Math.min(DEFAULT_ORIGIN_EXECUTION_POLICY.timeoutMs, requestedTimeoutMs) };
}

function chooseProvider(_taskType: AITaskType, _availability: OriginExecutionAvailability): OriginExecutionProviderId {
  return ORIGIN_OPENROUTER_FREE_PROVIDER_ID;
}

function parseEvidence(evidence: OriginProviderFreeEvidence, providerId: OriginExecutionProviderId, nowMs: number): OriginExecutionPlanResult | null {
  const verifiedAt = Date.parse(evidence.verifiedAt);
  const reviewAfter = Date.parse(evidence.reviewAfter);
  if (evidence.providerId !== providerId || !Number.isFinite(verifiedAt) || !Number.isFinite(reviewAfter) || reviewAfter <= verifiedAt || !evidence.sourceUrl.startsWith("https://")) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料Providerの証拠が選択Providerと一致しないか、不正です。" };
  if (nowMs < verifiedAt || nowMs > reviewAfter) return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "選択Providerの無料利用証拠が期限切れです。再確認まで実行を停止します。" };
  return null;
}

function resolveProviderEvidence(providerId: OriginExecutionProviderId, planningOptions: OriginExecutionPlanningOptions, nowMs: number): OriginProviderFreeEvidence | OriginExecutionPlanResult {
  if (providerId === ORIGIN_OPENROUTER_FREE_PROVIDER_ID) {
    const result = selectCurrentOriginFreeModel(planningOptions.freeModelCatalog ?? DEFAULT_ORIGIN_FREE_MODEL_CATALOG, nowMs);
    if ("model" in result) return { ...result.model, providerId: ORIGIN_OPENROUTER_FREE_PROVIDER_ID };
    return { ok: false, code: result.code, message: result.message };
  }
  if (providerId === ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID) {
    const result = selectCurrentOriginCloudflareFreeModel(planningOptions.cloudflareFreeModelCatalog, nowMs);
    if ("model" in result) return { providerId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID, verifiedAt: result.model.verifiedAt, reviewAfter: result.model.reviewAfter, sourceUrl: result.model.sourceUrl };
    return { ok: false, code: result.code, message: result.message };
  }
  if (providerId === ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID) {
    const evidence = planningOptions.providerEvidence?.[providerId];
    if (!evidence) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "Gemini無料枠の一次情報証拠が設定されていません。" };
    const stale = parseEvidence(evidence, providerId, nowMs);
    if (stale) return stale;
    return evidence;
  }
  return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "許可されていないProviderです。" };
}

export function buildOriginExecutionPlan(request: OriginExecutionRequest, availability: OriginExecutionAvailability, policyInput?: Partial<OriginExecutionPolicy>, planningOptions: OriginExecutionPlanningOptions = {}): OriginExecutionPlanResult {
  const policy = normalizePolicy(policyInput);
  if (!policy) return { ok: false, code: "INVALID_EXECUTION_POLICY", message: "実行ポリシーの値が正しくありません。" };
  if (!availability.openRouterConfigured) return { ok: false, code: "FREE_PROVIDER_NOT_CONFIGURED", message: "明示的に無料と確認できるOpenRouter無料モデルが設定されていません。" };
  const nowMs = planningOptions.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料Provider証拠の基準時刻が不正です。" };
  const capabilityDecision = selectOriginCapability(request.goal, request.capability);
  const taskType = classifyTask(request);
  const providerId = chooseProvider(taskType, availability);
  const evidence = resolveProviderEvidence(providerId, planningOptions, nowMs);
  if ("ok" in evidence && evidence.ok === false) return evidence;
  const modelEvidence = evidence as OriginProviderFreeEvidence;
  const modelId = ORIGIN_OPENROUTER_FREE_MODEL;
  const providerDataPolicy = DEFAULT_ORIGIN_PROVIDER_DATA_POLICY;
  return { ok: true, plan: { providerId, providerLabel: "ORIGIN 無料AI", modelId, taskType, capabilityDecision, freeOnly: true, estimatedCostUsd: 0, timeoutMs: policy.timeoutMs, requiresOwnerApproval: false, reason: `依頼を capability「${capabilityDecision.capability}」/ task「${taskType}」としてローカル分類し、検証済みのOpenRouter無料モデルのみを選択します。Provider自身の無料利用証拠が期限内である場合のみ実行します。`, providerDataPolicy, modelEvidence } };
}

/**
 * Builds the ordered secondary route plan (Cloudflare Workers AI) for the free-provider
 * failover dispatcher. The primary plan semantics of buildOriginExecutionPlan are unchanged:
 * this builder only derives a same-task, same-timeout plan for the fixed Cloudflare free model
 * from the Cloudflare evidence catalog, under the exact same data policy class as the primary
 * route (dataCollection "deny", zero data retention required, no provider-level fallbacks).
 * Owner decision 2026-11-06 approved this cross-route failover between independently verified
 * free ZDR routes; every route still verifies its own evidence freshness, $0 plan state, and
 * served-model identity before any answer is returned.
 */
export function buildOriginCloudflareRoutePlan(sourcePlan: OriginExecutionPlan, planningOptions: OriginExecutionPlanningOptions = {}): OriginExecutionPlanResult {
  const nowMs = planningOptions.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料Provider証拠の基準時刻が不正です。" };
  const evidence = resolveProviderEvidence(ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID, planningOptions, nowMs);
  if ("ok" in evidence && evidence.ok === false) return evidence;
  const modelEvidence = evidence as OriginProviderFreeEvidence;
  return { ok: true, plan: { providerId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID, providerLabel: "ORIGIN 無料AI", modelId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL, taskType: sourcePlan.taskType, capabilityDecision: sourcePlan.capabilityDecision, freeOnly: true, estimatedCostUsd: 0, timeoutMs: sourcePlan.timeoutMs, requiresOwnerApproval: false, reason: "第1経路（OpenRouter）の可用性エラー時に限り、証拠が期限内でZDR・学習利用なし・$0が公式情報で確認できるCloudflare Workers AIの固定無料モデルへ切り替えるための副経路計画です。実行前にアカウントのWorkers Freeプラン状態と価格$0を機械証明し、証明できない場合はこの経路を実行しません。", providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, modelEvidence } };
}
