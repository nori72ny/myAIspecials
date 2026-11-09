export const ORIGIN_CLOUDFLARE_FREE_MODEL = "@cf/google/gemma-4-26b-a4b-it" as const;
/**
 * Light-routing candidate (design: LIGHT_MODEL_ROUTING_DESIGN_2026-11-09).
 * Its evidence is catalogued now so a later PR can add in-route model
 * selection, but NOTHING selects this model yet: the second route's plan,
 * plan proof, execution-result verification and client acceptance all stay
 * pinned to ORIGIN_CLOUDFLARE_FREE_MODEL, and
 * selectCurrentOriginCloudflareFreeModel keeps returning the primary model.
 * It is never used as the route's primary model in this catalog's contract.
 */
export const ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID = "@cf/qwen/qwen3-30b-a3b-fp8" as const;
export type OriginCloudflareFreeModelId = typeof ORIGIN_CLOUDFLARE_FREE_MODEL | typeof ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID;

export const ORIGIN_CLOUDFLARE_FREE_MODEL_IDS: readonly OriginCloudflareFreeModelId[] = [
  ORIGIN_CLOUDFLARE_FREE_MODEL,
  ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID,
] as const;

export function isOriginCloudflareFreeModelId(value: unknown): value is OriginCloudflareFreeModelId {
  return value === ORIGIN_CLOUDFLARE_FREE_MODEL || value === ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID;
}

/**
 * Published Workers AI rates (Neurons per 1M tokens), rechecked on 2026-11-09
 * against the official pricing page. Evidence for routing decisions and
 * consumption estimates only; never a charge. The route executor still uses
 * its own pinned constants for the primary model until the routing PR wires
 * selection through this table.
 */
export const ORIGIN_CLOUDFLARE_FREE_MODEL_NEURONS_PER_MILLION_TOKENS: Readonly<Record<OriginCloudflareFreeModelId, { input: number; output: number }>> = {
  [ORIGIN_CLOUDFLARE_FREE_MODEL]: { input: 9_091, output: 27_273 },
  [ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID]: { input: 4_625, output: 30_475 },
} as const;

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
const ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_SOURCE =
  "https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/" as const;

export const DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG: readonly OriginCloudflareFreeModelEvidence[] = [
  {
    providerId: "cloudflare-workers-ai-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
    verifiedAt: "2026-11-09T13:00:00.000Z",
    reviewAfter: "2026-11-19T13:00:00.000Z",
    sourceUrl: ORIGIN_CLOUDFLARE_FREE_MODEL_SOURCE,
    sourceDescription: "Cloudflare official documentation rechecked on 2026-11-09: 'Your Data and Workers AI' (updated 2026-10-16) states zero data retention for standard inference requests and that Cloudflare does not use Customer Content processed by Workers AI to train AI models. The Workers AI pricing page (updated 2026-10-20) states the free allocation is 10,000 Neurons per day per account (limits reset at 00:00 UTC) and that exceeding it errors instead of charging on the Workers Free plan, which has no Neurons billing; it lists @cf/google/gemma-4-26b-a4b-it at $0.10 per million input tokens and $0.30 per million output tokens (9,091 / 27,273 Neurons per million tokens). The model page for @cf/google/gemma-4-26b-a4b-it marks the model Cloudflare-hosted with 'Zero data retention: Yes' and shows no planned deprecation. This catalog check does not by itself prove a live account is on Workers Free: runtime must additionally verify the account plan (bundled usage model, no paid Workers subscription, exact $0 prices) and the live model schema before every inference, and must fail closed on any unverifiable condition. The evidence window is deliberately short (reviewAfter 2026-11-19): the route fails closed when it passes without a fresh documentation re-check.",
  },
  {
    providerId: "cloudflare-workers-ai-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID,
    verifiedAt: "2026-11-09T13:00:00.000Z",
    reviewAfter: "2026-11-20T00:00:00.000Z",
    sourceUrl: ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_SOURCE,
    sourceDescription: "Light-routing candidate catalogued on 2026-11-09 from Cloudflare's official documentation (design: LIGHT_MODEL_ROUTING_DESIGN_2026-11-09). The Workers AI pricing page (updated 2026-10-20) lists @cf/qwen/qwen3-30b-a3b-fp8 at $0.051 per million input tokens and $0.335 per million output tokens (4,625 / 30,475 Neurons per million tokens), inside the same account-wide free allocation of 10,000 Neurons per day; exceeding the allocation errors instead of charging on the Workers Free plan, which has no Neurons billing. The model page marks the model Cloudflare-hosted with 'Zero data retention: Yes' and a 32,768-token context window, and the platform data-usage page states Workers AI does not use Customer Content to train AI models. The model page also shows a planned deprecation on 2026-11-20, so this entry's reviewAfter is capped at that date: any use at or after it requires a fresh availability re-check. HONEST LIMITS: this entry only records that the model is documented as free-tier eligible. NOTHING in the current code selects this model: the second route's plan, plan proof, execution-result verification and client acceptance all remain pinned to @cf/google/gemma-4-26b-a4b-it, and selectCurrentOriginCloudflareFreeModel keeps returning the primary model. Whether this account can actually run the model has NOT been verified (a paid-only model would fail the live schema read with error 5035); that live check and the Japanese answer-quality gate are prerequisites of the later routing PRs. The model is a reasoning model whose output rate (30,475 Neurons per million tokens) is higher than the primary model's (27,273), so its per-response saving is unverified until measured.",
  },
] as const;

export type OriginCloudflareFreeModelCatalogFailureCode = "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE";
export type OriginCloudflareFreeModelCatalogResult = { ok: true; model: OriginCloudflareFreeModelEvidence } | { ok: false; code: OriginCloudflareFreeModelCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? timestamp : null; }
function isValidEvidence(entry: OriginCloudflareFreeModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter);
  return entry.providerId === "cloudflare-workers-ai-free" && isOriginCloudflareFreeModelId(entry.modelId) && entry.sourceUrl.startsWith("https://developers.cloudflare.com/") && verifiedAt !== null && reviewAfter !== null && reviewAfter > verifiedAt;
}
export function selectCurrentOriginCloudflareFreeModelById(catalog: readonly OriginCloudflareFreeModelEvidence[] = DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG, modelId: OriginCloudflareFreeModelId, nowMs: number = Date.now()): OriginCloudflareFreeModelCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料モデルの証拠カタログが正しくありません。" };
  const current = catalog.find((entry) => { const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter); return entry.modelId === modelId && verifiedAt !== null && reviewAfter !== null && nowMs >= verifiedAt && nowMs <= reviewAfter; });
  if (!current) return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。" };
  return { ok: true, model: current };
}
export function selectCurrentOriginCloudflareFreeModel(catalog: readonly OriginCloudflareFreeModelEvidence[] = DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG, nowMs: number = Date.now()): OriginCloudflareFreeModelCatalogResult {
  return selectCurrentOriginCloudflareFreeModelById(catalog, ORIGIN_CLOUDFLARE_FREE_MODEL, nowMs);
}
