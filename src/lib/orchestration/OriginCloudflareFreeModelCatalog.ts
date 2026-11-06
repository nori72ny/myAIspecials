export const ORIGIN_CLOUDFLARE_FREE_MODEL = "@cf/google/gemma-4-26b-a4b-it" as const;
export type OriginCloudflareFreeModelId = typeof ORIGIN_CLOUDFLARE_FREE_MODEL;

export interface OriginCloudflareFreeModelEvidence {
  providerId: "cloudflare-workers-ai-free";
  providerLabel: string;
  modelId: OriginCloudflareFreeModelId;
  verifiedAt: string;
  reviewAfter: string;
  sourceUrl: string;
  sourceDescription: string;
}

const ORIGIN_CLOUDFLARE_FREE_MODEL_SOURCE =
  "https://developers.cloudflare.com/workers-ai/platform/data-usage/" as const;

export const DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG: readonly OriginCloudflareFreeModelEvidence[] = [
  {
    providerId: "cloudflare-workers-ai-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
    verifiedAt: "2026-11-05T21:00:00.000Z",
    reviewAfter: "2026-11-15T21:00:00.000Z",
    sourceUrl: ORIGIN_CLOUDFLARE_FREE_MODEL_SOURCE,
    sourceDescription: "Cloudflare official documentation rechecked on 2026-11-06: 'Your Data and Workers AI' (updated 2026-10-16) states zero data retention for standard inference requests and that Cloudflare does not use Customer Content processed by Workers AI to train AI models. The Workers AI pricing page (updated 2026-10-20) states the free allocation is 10,000 Neurons per day per account and that exceeding it errors instead of charging on the Workers Free plan, which has no Neurons billing. The model page for @cf/google/gemma-4-26b-a4b-it marks the model ZDR and free-tier eligible. This catalog check does not by itself prove a live account is on Workers Free: runtime must additionally verify the account plan (bundled usage model, no paid Workers subscription, exact $0 prices) and the live model schema before every inference, and must fail closed on any unverifiable condition.",
  },
] as const;

export type OriginCloudflareFreeModelCatalogFailureCode = "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE";
export type OriginCloudflareFreeModelCatalogResult = { ok: true; model: OriginCloudflareFreeModelEvidence } | { ok: false; code: OriginCloudflareFreeModelCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? timestamp : null; }
function isValidEvidence(entry: OriginCloudflareFreeModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter);
  return entry.providerId === "cloudflare-workers-ai-free" && entry.modelId === ORIGIN_CLOUDFLARE_FREE_MODEL && entry.sourceUrl.startsWith("https://developers.cloudflare.com/") && verifiedAt !== null && reviewAfter !== null && reviewAfter > verifiedAt;
}
export function selectCurrentOriginCloudflareFreeModel(catalog: readonly OriginCloudflareFreeModelEvidence[] = DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG, nowMs: number = Date.now()): OriginCloudflareFreeModelCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料モデルの証拠カタログが正しくありません。" };
  const current = catalog.find((entry) => { const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter); return verifiedAt !== null && reviewAfter !== null && nowMs >= verifiedAt && nowMs <= reviewAfter; });
  if (!current) return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。" };
  return { ok: true, model: current };
}
