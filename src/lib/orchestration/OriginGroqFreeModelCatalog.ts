export const ORIGIN_GROQ_FREE_MODEL_ID = "openai/gpt-oss-120b" as const;
export type OriginGroqFreeModelId = typeof ORIGIN_GROQ_FREE_MODEL_ID;

export interface OriginGroqFreeModelEvidence {
  providerId: "groq-free";
  providerLabel: string;
  modelId: OriginGroqFreeModelId;
  verifiedAt: string;
  reviewAfter: string;
  sourceUrl: string;
  sourceDescription: string;
}

const ORIGIN_GROQ_FREE_MODEL_SOURCE =
  "https://console.groq.com/docs/rate-limits" as const;

export const DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG: readonly OriginGroqFreeModelEvidence[] = [
  {
    providerId: "groq-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_GROQ_FREE_MODEL_ID,
    verifiedAt: "2026-11-08T00:00:00.000Z",
    reviewAfter: "2026-11-22T00:00:00.000Z",
    sourceUrl: ORIGIN_GROQ_FREE_MODEL_SOURCE,
    sourceDescription: "Verified live in the owner's Groq Console on 2026-11-08 (owner-approved free account, organization 'Personal', no payment method registered): Settings / Data Controls shows Global ZDR 'Enabled' (overriding API-specific settings) and Inference APIs ZDR also 'Enabled', so inference on this account runs with zero data retention. The free-plan limits for openai/gpt-oss-120b are 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute and 200,000 tokens/day; with no card on file, exceeding the free limits errors (HTTP 429) instead of charging, so the route stays strictly $0. This evidence is deliberately short-lived (reviewAfter 2026-11-22): the route fails closed when it passes without a fresh console re-check, and it stays completely disabled until GROQ_API_KEY is configured. Route activation note (2026-11-08): the 8,000 tokens/minute ceiling initially made the route structurally inert, because the assembled standard chat instruction (about 15,700 characters) alone estimates to about 7,900 tokens under the executor's conservative characters/2 estimator; the chat dispatchers therefore carry a compact route-specific system instruction (2,000-3,000 characters, core policy preserved) and the executor trims history oldest-first to a 6,000-token estimated input budget, so a standard chat now passes the pre-send gate with completion headroom to spare. Routes 1 and 2 are unaffected, and requests without the compact substitute keep the previous gate behavior.",
  },
] as const;

export type OriginGroqFreeModelCatalogFailureCode = "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE";
export type OriginGroqFreeModelCatalogResult = { ok: true; model: OriginGroqFreeModelEvidence } | { ok: false; code: OriginGroqFreeModelCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? timestamp : null; }
function isValidEvidence(entry: OriginGroqFreeModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter);
  return entry.providerId === "groq-free" && entry.modelId === ORIGIN_GROQ_FREE_MODEL_ID && entry.sourceUrl.startsWith("https://console.groq.com/") && verifiedAt !== null && reviewAfter !== null && reviewAfter > verifiedAt;
}
export function selectCurrentOriginGroqFreeModel(catalog: readonly OriginGroqFreeModelEvidence[] = DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG, nowMs: number = Date.now()): OriginGroqFreeModelCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料モデルの証拠カタログが正しくありません。" };
  const current = catalog.find((entry) => { const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter); return verifiedAt !== null && reviewAfter !== null && nowMs >= verifiedAt && nowMs <= reviewAfter; });
  if (!current) return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。" };
  return { ok: true, model: current };
}
