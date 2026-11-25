export const ORIGIN_OVHCLOUD_FREE_MODEL_ID = "gpt-oss-20b" as const;
/**
 * OVHcloud AI Endpoints, anonymous tier (fourth route, catalogued
 * 2026-11-25). The anonymous tier needs no signup, no API key and no
 * payment method: requests are sent without any credential and are
 * limited to 2 requests/minute/IP/model. Exceeding the limit returns
 * HTTP 429 and nothing else — there is no account and no balance, so
 * no billing path exists and the route stays strictly $0 by
 * construction. The endpoint is OpenAI-compatible
 * (https://oai.endpoints.kepler.ai.cloud.ovh.net/v1).
 *
 * Only this one model is planned by the route. The anonymous tier
 * exposes other models as well (gpt-oss-120b, Qwen3.8-27B,
 * Qwen3.6-27B, Meta-Llama-3_3-70B-Instruct,
 * Mistral-Small-3.2-24B-Instruct, among others, observed 2026-11-25),
 * but gpt-oss-20b is the one model whose anonymous completion was
 * verified live with an HTTP 200 response in the 2026-11-25 probe;
 * a sibling model (Qwen3.8-27B) returned 429 immediately in the same
 * probe, which shows the anonymous allocation is shared and thin.
 * The route therefore plans only the measured model and treats every
 * other model as unproven (fail closed), exactly like the other
 * routes treat unmeasured models.
 */
export type OriginOvhcloudFreeModelId = typeof ORIGIN_OVHCLOUD_FREE_MODEL_ID;

export const ORIGIN_OVHCLOUD_FREE_MODEL_IDS: readonly OriginOvhcloudFreeModelId[] = [
  ORIGIN_OVHCLOUD_FREE_MODEL_ID,
] as const;

export function isOriginOvhcloudFreeModelId(value: unknown): value is OriginOvhcloudFreeModelId {
  return value === ORIGIN_OVHCLOUD_FREE_MODEL_ID;
}

export interface OriginOvhcloudFreeModelEvidence {
  providerId: "ovhcloud-free";
  providerLabel: string;
  modelId: OriginOvhcloudFreeModelId;
  verifiedAt: string;
  reviewAfter: string;
  sourceUrl: string;
  sourceDescription: string;
}

const ORIGIN_OVHCLOUD_FREE_MODEL_SOURCE =
  "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/" as const;

export const DEFAULT_ORIGIN_OVHCLOUD_FREE_MODEL_CATALOG: readonly OriginOvhcloudFreeModelEvidence[] = [
  {
    providerId: "ovhcloud-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_OVHCLOUD_FREE_MODEL_ID,
    verifiedAt: "2026-11-25T00:00:00.000Z",
    reviewAfter: "2026-12-25T00:00:00.000Z",
    sourceUrl: ORIGIN_OVHCLOUD_FREE_MODEL_SOURCE,
    sourceDescription: "Catalogued 2026-11-25 from OVHcloud's official product page (re-read on 2026-11-25) and the AI Endpoints annex (Annex 10) of the Public Cloud specific conditions, plus a live anonymous probe run the same day. Zero data retention: the product page states 'Your data is never used to train or improve our AI models' and 'Zero data retention: We keep only the data required for billing purposes' — and under anonymous use no billing data arises at all. Annex 10 contractually provides that the service includes no storage or backup and that OVHcloud does not access or reuse the content of inputs or outputs; the Batch API is an exception to that annex, so this route never uses the Batch API. Processing stays inside the EU. Free tier: the anonymous tier is permanent (not a time-limited trial), requires no signup, no API key and no card, and is limited to 2 requests/minute/IP/model with no published daily or token cap, so the RPM limit is the effective ceiling; exceeding it is refused with HTTP 429 and, because no account or balance exists, there is structurally no path to a charge, so the route stays strictly $0. Live probe (2026-11-25): an anonymous POST of a fixed, non-confidential probe text to gpt-oss-20b at the OpenAI-compatible endpoint returned HTTP 200 with a usage block, while Qwen3.8-27B returned 429 immediately — the anonymous allocation appears to be shared across users and is thin, so this route is a last-resort receiver only, never a primary route, and a 429 from it is an ordinary outcome, not an anomaly. HONEST LIMITS: explicit official wording on whether the anonymous tier may be used commercially or in production has NOT been confirmed (no prohibiting wording was found either), so the route is restricted to lightweight, non-confidential calls only — the dispatcher attempts it solely for requests a caller has explicitly marked as lightweight and non-confidential, and never for conversation text or personal data. This evidence expires on 2026-12-25 (reviewAfter): the route fails closed when it passes without a fresh re-check of the anonymous tier's terms and the commercial-use wording.",
  },
] as const;

export type OriginOvhcloudFreeModelCatalogFailureCode = "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE";
export type OriginOvhcloudFreeModelCatalogResult = { ok: true; model: OriginOvhcloudFreeModelEvidence } | { ok: false; code: OriginOvhcloudFreeModelCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? timestamp : null; }
function isValidEvidence(entry: OriginOvhcloudFreeModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter);
  return entry.providerId === "ovhcloud-free" && isOriginOvhcloudFreeModelId(entry.modelId) && entry.sourceUrl.startsWith("https://www.ovhcloud.com/") && verifiedAt !== null && reviewAfter !== null && reviewAfter > verifiedAt;
}
export function selectCurrentOriginOvhcloudFreeModelById(catalog: readonly OriginOvhcloudFreeModelEvidence[] = DEFAULT_ORIGIN_OVHCLOUD_FREE_MODEL_CATALOG, modelId: OriginOvhcloudFreeModelId, nowMs: number = Date.now()): OriginOvhcloudFreeModelCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料モデルの証拠カタログが正しくありません。" };
  const current = catalog.find((entry) => { const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter); return entry.modelId === modelId && verifiedAt !== null && reviewAfter !== null && nowMs >= verifiedAt && nowMs <= reviewAfter; });
  if (!current) return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。" };
  return { ok: true, model: current };
}
export function selectCurrentOriginOvhcloudFreeModel(catalog: readonly OriginOvhcloudFreeModelEvidence[] = DEFAULT_ORIGIN_OVHCLOUD_FREE_MODEL_CATALOG, nowMs: number = Date.now()): OriginOvhcloudFreeModelCatalogResult {
  return selectCurrentOriginOvhcloudFreeModelById(catalog, ORIGIN_OVHCLOUD_FREE_MODEL_ID, nowMs);
}
