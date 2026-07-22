export const ORIGIN_AI_STUDIO_PROVIDER_ID = "google-ai-studio-free" as const;
export const ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions" as const;

export interface OriginAiStudioFreeModelEvidence {
  providerId: typeof ORIGIN_AI_STUDIO_PROVIDER_ID;
  providerLabel: string;
  modelId: string;
  billingTier: string;
  inputCostUsd: number;
  outputCostUsd: number;
  apiFamily: string;
  store: boolean;
  verifiedAt: string;
  reviewAfter: string;
  pricingSourceUrl: string;
  modelSourceUrl: string;
}

export const DEFAULT_ORIGIN_AI_STUDIO_FREE_MODEL_CATALOG:
  readonly OriginAiStudioFreeModelEvidence[] = [] as const;

export interface OriginAiStudioRuntimeAvailability {
  enabled: boolean;
  apiKeyConfigured: boolean;
  ownerApprovedLiveExecution: boolean;
}

export interface OriginAiStudioRuntimePlan {
  providerId: typeof ORIGIN_AI_STUDIO_PROVIDER_ID;
  providerLabel: string;
  modelId: string;
  endpoint: typeof ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT;
  freeOnly: true;
  maxEstimatedCostUsd: 0;
  requiresOwnerApproval: false;
  requestPolicy: {
    store: false;
    allowAutomaticRetries: false;
    allowProviderFallbacks: false;
    allowAutomaticModelSelection: false;
  };
  evidence: {
    billingTier: "free";
    verifiedAt: string;
    reviewAfter: string;
    pricingSourceUrl: string;
    modelSourceUrl: string;
  };
}

export type OriginAiStudioRuntimeFailureCode =
  | "AI_STUDIO_RUNTIME_DISABLED"
  | "AI_STUDIO_OWNER_APPROVAL_REQUIRED"
  | "AI_STUDIO_API_KEY_NOT_CONFIGURED"
  | "AI_STUDIO_FREE_CATALOG_INVALID"
  | "AI_STUDIO_FREE_EVIDENCE_STALE";

export type OriginAiStudioRuntimePlanResult =
  | { ok: true; plan: OriginAiStudioRuntimePlan }
  | {
      ok: false;
      code: OriginAiStudioRuntimeFailureCode;
      message: string;
    };

export interface OriginAiStudioRuntimePlanningOptions {
  catalog?: readonly OriginAiStudioFreeModelEvidence[];
  nowMs?: number;
}

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isExplicitStableGeminiModelId(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  if (
    normalized.includes("preview")
    || normalized.includes("experimental")
    || normalized.includes("-exp")
    || normalized.endsWith("-latest")
  ) {
    return false;
  }

  return /^gemini-\d+(?:\.\d+)*-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized);
}

function isValidEvidence(entry: OriginAiStudioFreeModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt);
  const reviewAfter = parseTimestamp(entry.reviewAfter);

  return entry.providerId === ORIGIN_AI_STUDIO_PROVIDER_ID
    && isExplicitStableGeminiModelId(entry.modelId)
    && entry.billingTier === "free"
    && entry.inputCostUsd === 0
    && entry.outputCostUsd === 0
    && entry.apiFamily === "interactions"
    && entry.store === false
    && entry.pricingSourceUrl.startsWith("https://ai.google.dev/")
    && entry.modelSourceUrl.startsWith("https://ai.google.dev/")
    && verifiedAt !== null
    && reviewAfter !== null
    && reviewAfter > verifiedAt;
}

function selectCurrentEvidence(
  catalog: readonly OriginAiStudioFreeModelEvidence[],
  nowMs: number,
): OriginAiStudioRuntimePlanResult | OriginAiStudioFreeModelEvidence {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) {
    return {
      ok: false,
      code: "AI_STUDIO_FREE_CATALOG_INVALID",
      message: "AI Studio無料モデルの証拠カタログが未設定または不正なため、実行を停止しました。",
    };
  }

  const current = catalog.find((entry) => {
    const verifiedAt = parseTimestamp(entry.verifiedAt);
    const reviewAfter = parseTimestamp(entry.reviewAfter);
    return verifiedAt !== null
      && reviewAfter !== null
      && nowMs >= verifiedAt
      && nowMs <= reviewAfter;
  });

  if (!current) {
    return {
      ok: false,
      code: "AI_STUDIO_FREE_EVIDENCE_STALE",
      message: "AI Studio無料モデルの証拠が期限切れのため、再確認まで実行を停止しました。",
    };
  }

  return current;
}

export function isOriginAiStudioRuntimeEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.ORIGIN_AI_STUDIO_RUNTIME_ENABLED === "true";
}

export function buildOriginAiStudioRuntimePlan(
  availability: OriginAiStudioRuntimeAvailability,
  options: OriginAiStudioRuntimePlanningOptions = {},
): OriginAiStudioRuntimePlanResult {
  if (!availability.enabled) {
    return {
      ok: false,
      code: "AI_STUDIO_RUNTIME_DISABLED",
      message: "AI Studioランタイムは既定で無効です。",
    };
  }

  if (!availability.ownerApprovedLiveExecution) {
    return {
      ok: false,
      code: "AI_STUDIO_OWNER_APPROVAL_REQUIRED",
      message: "AI Studioの実リクエストにはオーナーの明示承認が必要です。",
    };
  }

  if (!availability.apiKeyConfigured) {
    return {
      ok: false,
      code: "AI_STUDIO_API_KEY_NOT_CONFIGURED",
      message: "AI Studioのサーバー側認証情報が設定されていません。",
    };
  }

  const selected = selectCurrentEvidence(
    options.catalog ?? DEFAULT_ORIGIN_AI_STUDIO_FREE_MODEL_CATALOG,
    options.nowMs ?? Date.now(),
  );
  if ("ok" in selected) return selected;

  return {
    ok: true,
    plan: {
      providerId: ORIGIN_AI_STUDIO_PROVIDER_ID,
      providerLabel: selected.providerLabel,
      modelId: selected.modelId,
      endpoint: ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT,
      freeOnly: true,
      maxEstimatedCostUsd: 0,
      requiresOwnerApproval: false,
      requestPolicy: {
        store: false,
        allowAutomaticRetries: false,
        allowProviderFallbacks: false,
        allowAutomaticModelSelection: false,
      },
      evidence: {
        billingTier: "free",
        verifiedAt: selected.verifiedAt,
        reviewAfter: selected.reviewAfter,
        pricingSourceUrl: selected.pricingSourceUrl,
        modelSourceUrl: selected.modelSourceUrl,
      },
    },
  };
}
