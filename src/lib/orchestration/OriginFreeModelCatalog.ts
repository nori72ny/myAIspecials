export const ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL =
  "google/gemma-4-31b-it:free" as const;
export type OriginFreeModelId = typeof ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL;

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
  "https://openrouter.ai/google/gemma-4-31b-it:free" as const;

export const DEFAULT_ORIGIN_FREE_MODEL_CATALOG: readonly OriginFreeModelEvidence[] = [
  {
    providerId: "openrouter-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
    verifiedAt: "2026-09-04T11:10:00.000Z",
    reviewAfter: "2026-09-14T10:59:59.999Z",
    sourceUrl: ORIGIN_OPENROUTER_FREE_MODEL_SOURCE,
    sourceDescription: "OpenRouter official model page was checked on 2026-09-04 and reports Free pricing for the fixed model ID. Runtime separately requires exact served-model identity, provider data_collection deny, ZDR, and reported usage cost of zero before returning an answer.",
  },
] as const;

export type OriginFreeModelCatalogFailureCode = "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE";
export type OriginFreeModelCatalogResult = { ok: true; model: OriginFreeModelEvidence } | { ok: false; code: OriginFreeModelCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? timestamp : null; }
function isValidEvidence(entry: OriginFreeModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter);
  return entry.providerId === "openrouter-free" && entry.modelId === ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL && entry.sourceUrl.startsWith("https://openrouter.ai/") && verifiedAt !== null && reviewAfter !== null && reviewAfter > verifiedAt;
}
export function selectCurrentOriginFreeModel(catalog: readonly OriginFreeModelEvidence[] = DEFAULT_ORIGIN_FREE_MODEL_CATALOG, nowMs: number = Date.now()): OriginFreeModelCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料モデルの証拠カタログが正しくありません。" };
  const current = catalog.find((entry) => { const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter); return verifiedAt !== null && reviewAfter !== null && nowMs >= verifiedAt && nowMs <= reviewAfter; });
  if (!current) return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。" };
  return { ok: true, model: current };
}
