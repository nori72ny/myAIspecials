export const ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL =
  "inclusionai/ling-3.0-flash-sante:free" as const;
export const ORIGIN_CODING_OPENROUTER_FREE_MODEL =
  "inclusionai/ling-3.0-flash:free" as const;
export type OriginFreeModelId =
  | typeof ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL
  | typeof ORIGIN_CODING_OPENROUTER_FREE_MODEL;

export interface OriginFreeModelEvidence {
  providerId: "openrouter-free";
  providerLabel: string;
  modelId: OriginFreeModelId;
  verifiedAt: string;
  reviewAfter: string;
  sourceUrl: string;
  sourceDescription: string;
}

const ORIGIN_OPENROUTER_FREE_MODEL_SOURCE =
  "https://openrouter.ai/inclusionai/ling-3.0-flash-sante:free" as const;
const ORIGIN_OPENROUTER_CODING_FREE_MODEL_SOURCE =
  "https://openrouter.ai/inclusionai/ling-3.0-flash:free" as const;

export const DEFAULT_ORIGIN_FREE_MODEL_CATALOG: readonly OriginFreeModelEvidence[] = [
  {
    providerId: "openrouter-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
    verifiedAt: "2026-09-15T01:02:00.000Z",
    reviewAfter: "2026-09-22T01:02:00.000Z",
    sourceUrl: ORIGIN_OPENROUTER_FREE_MODEL_SOURCE,
    sourceDescription: "OpenRouter official model and provider pages were rechecked on 2026-09-15 JST: the fixed :free model remains listed at zero prompt/completion price, and the NovitaAI provider page lists this model at zero input/output price while OpenRouter's provider directory marks NovitaAI as no-training and zero-retention. Runtime separately requires ZDR/data-collection-deny routing, max-price zero, exact served-model identity, and zero reported usage cost; any unverifiable or non-zero condition fails closed before an answer is returned.",
  },
  {
    providerId: "openrouter-free",
    providerLabel: "ORIGIN Coding 無料AI",
    modelId: ORIGIN_CODING_OPENROUTER_FREE_MODEL,
    verifiedAt: "2026-09-15T21:10:00.000Z",
    reviewAfter: "2026-09-22T21:10:00.000Z",
    sourceUrl: ORIGIN_OPENROUTER_CODING_FREE_MODEL_SOURCE,
    sourceDescription: "OpenRouter official model page was rechecked on 2026-09-16 JST: Ling 3.0 Flash :free is listed at zero prompt/completion price and is designed for token-efficient production-scale agentic inference. OpenRouter's provider directory independently marks NovitaAI and DeepInfra as no-training and zero-retention. Runtime still requires ZDR, data_collection=deny, provider fallbacks disabled, max-price zero, exact served-model identity, and zero reported usage cost; if no eligible zero-retention free endpoint is available, execution fails closed.",
  },
] as const;

export type OriginFreeModelCatalogFailureCode = "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE";
export type OriginFreeModelCatalogResult = { ok: true; model: OriginFreeModelEvidence } | { ok: false; code: OriginFreeModelCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? timestamp : null; }
function expectedSource(modelId: OriginFreeModelId): string {
  return modelId === ORIGIN_CODING_OPENROUTER_FREE_MODEL
    ? ORIGIN_OPENROUTER_CODING_FREE_MODEL_SOURCE
    : ORIGIN_OPENROUTER_FREE_MODEL_SOURCE;
}
function isKnownModel(value: unknown): value is OriginFreeModelId {
  return value === ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL || value === ORIGIN_CODING_OPENROUTER_FREE_MODEL;
}
function isValidEvidence(entry: OriginFreeModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter);
  return entry.providerId === "openrouter-free"
    && isKnownModel(entry.modelId)
    && entry.sourceUrl === expectedSource(entry.modelId)
    && verifiedAt !== null
    && reviewAfter !== null
    && reviewAfter > verifiedAt;
}
export function selectCurrentOriginFreeModel(
  catalog: readonly OriginFreeModelEvidence[] = DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
  nowMs: number = Date.now(),
  preferredModel: OriginFreeModelId = ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
): OriginFreeModelCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料モデルの証拠カタログが正しくありません。" };
  const current = catalog.find((entry) => { const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter); return entry.modelId === preferredModel && verifiedAt !== null && reviewAfter !== null && nowMs >= verifiedAt && nowMs <= reviewAfter; });
  if (!current) return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。" };
  return { ok: true, model: current };
}
