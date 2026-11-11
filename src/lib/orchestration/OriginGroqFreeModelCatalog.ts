export const ORIGIN_GROQ_FREE_MODEL_ID = "openai/gpt-oss-120b" as const;
/**
 * In-route rotation target (2026-11-08): when the primary model fails with a
 * rate-limit or overload error, the Groq executor retries once on this model
 * inside the same third route and the same remaining dispatch budget. Groq
 * measures the free-plan limits per model, so this is a separate quota bucket;
 * it is never used as the route's primary model.
 */
export const ORIGIN_GROQ_FREE_ROTATION_MODEL_ID = "openai/gpt-oss-20b" as const;
/**
 * Second rotation target (Preview, catalogued 2026-11-10): qwen/qwen3.8-27b
 * sits at the very end of the in-route rotation, behind both Production
 * models. It is a Preview model that Groq may discontinue on short notice,
 * and its Japanese answer quality has NOT been screened yet, so the executor
 * sends to it only while the kill switch ORIGIN_GROQ_QWEN_ROTATION_ENABLED
 * is exactly "true" (default OFF; see originGroqProviderClient). Adding the
 * model to this catalog and to the shared allowlist below does not by itself
 * enable it: the execution planner only ever plans the primary model, and
 * the rotation reaches this model only through the gated second stage.
 */
export const ORIGIN_GROQ_QWEN_MODEL_ID = "qwen/qwen3.8-27b" as const;
export type OriginGroqFreeModelId = typeof ORIGIN_GROQ_FREE_MODEL_ID | typeof ORIGIN_GROQ_FREE_ROTATION_MODEL_ID | typeof ORIGIN_GROQ_QWEN_MODEL_ID;

export const ORIGIN_GROQ_FREE_MODEL_IDS: readonly OriginGroqFreeModelId[] = [
  ORIGIN_GROQ_FREE_MODEL_ID,
  ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
  ORIGIN_GROQ_QWEN_MODEL_ID,
] as const;

export function isOriginGroqFreeModelId(value: unknown): value is OriginGroqFreeModelId {
  return value === ORIGIN_GROQ_FREE_MODEL_ID || value === ORIGIN_GROQ_FREE_ROTATION_MODEL_ID || value === ORIGIN_GROQ_QWEN_MODEL_ID;
}

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
  {
    providerId: "groq-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
    verifiedAt: "2026-11-08T00:00:00.000Z",
    reviewAfter: "2026-11-22T00:00:00.000Z",
    sourceUrl: ORIGIN_GROQ_FREE_MODEL_SOURCE,
    sourceDescription: "Rotation target added 2026-11-08 from Groq's official rate-limits documentation (checked 2026-11-08): the official limits table lists openai/gpt-oss-20b on the free plan at 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute and 200,000 tokens/day — the same values as openai/gpt-oss-120b — and Groq measures those limits per model, so this model is a separate quota bucket that the executor may rotate to only when the primary model fails with a rate-limit or overload error. Zero data retention is an organization-level setting (verified live in the owner's console on 2026-11-08 for this organization: Settings / Data Controls shows Global ZDR 'Enabled'), and Groq documents ZDR as applying to the inference endpoints as a whole, so rotating models does not change the retention posture. HONEST LIMIT: unlike openai/gpt-oss-120b, this model's effective limits have NOT been re-verified on the organization's own Limits page in the console yet; the executor's pre-send gate uses the official table values above, and if the organization's effective limits turn out lower, requests error (HTTP 429) instead of charging because no payment method is registered, so the $0 boundary holds either way. This evidence is deliberately short-lived (reviewAfter 2026-11-22, the same deadline as the primary model): the rotation fails closed when it passes without a fresh re-check of both the official limits table and the console Limits page.",
  },
  {
    providerId: "groq-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_GROQ_QWEN_MODEL_ID,
    verifiedAt: "2026-11-10T00:00:00.000Z",
    reviewAfter: "2026-12-10T00:00:00.000Z",
    sourceUrl: ORIGIN_GROQ_FREE_MODEL_SOURCE,
    sourceDescription: "Second rotation target (Preview) documented 2026-11-10 from Groq's official documentation (the rate-limits table and the qwen/qwen3.8-27b model page, both checked 2026-11-10): the official limits table lists qwen/qwen3.8-27b on the free plan at 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute and 200,000 tokens/day — the same values as the two gpt-oss models — and Groq measures those limits per model, so this model is a separate quota bucket. The model is in Preview: Groq documents Preview models as evaluation-only and discontinuable on short notice, so this evidence carries a short review window (reviewAfter 2026-12-10, 30 days) and the executor fails closed for this model alone when it lapses, leaving the two Production models unaffected. Zero data retention is an organization-level setting (verified live in the owner's console on 2026-11-08 for this organization: Settings / Data Controls shows Global ZDR 'Enabled'), and Groq documents ZDR as applying to the inference endpoints as a whole, with no Preview-model exception stated, so rotating models does not change the retention posture. HONEST LIMITS: unlike openai/gpt-oss-120b, this model's effective limits have NOT been re-verified on the organization's own Limits page in the console yet, and its Japanese answer quality has NOT been screened — Groq's official material claims strong multilingual support but publishes no Japanese benchmark. For both reasons the executor sends to this model only while the kill switch ORIGIN_GROQ_QWEN_ROTATION_ENABLED is exactly 'true' (default OFF); enabling it is a separate decision gated on a blind quality screening against the fixed question set. Requests to this model carry reasoning_effort 'none' (Groq's documented recommendation for conversational use of this dual-mode model) so thinking tokens never consume the free token budgets.",
  },
] as const;

export type OriginGroqFreeModelCatalogFailureCode = "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE";
export type OriginGroqFreeModelCatalogResult = { ok: true; model: OriginGroqFreeModelEvidence } | { ok: false; code: OriginGroqFreeModelCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? timestamp : null; }
function isValidEvidence(entry: OriginGroqFreeModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter);
  return entry.providerId === "groq-free" && isOriginGroqFreeModelId(entry.modelId) && entry.sourceUrl.startsWith("https://console.groq.com/") && verifiedAt !== null && reviewAfter !== null && reviewAfter > verifiedAt;
}
export function selectCurrentOriginGroqFreeModelById(catalog: readonly OriginGroqFreeModelEvidence[] = DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG, modelId: OriginGroqFreeModelId, nowMs: number = Date.now()): OriginGroqFreeModelCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) return { ok: false, code: "FREE_MODEL_CATALOG_INVALID", message: "無料モデルの証拠カタログが正しくありません。" };
  const current = catalog.find((entry) => { const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter); return entry.modelId === modelId && verifiedAt !== null && reviewAfter !== null && nowMs >= verifiedAt && nowMs <= reviewAfter; });
  if (!current) return { ok: false, code: "FREE_MODEL_EVIDENCE_STALE", message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。" };
  return { ok: true, model: current };
}
export function selectCurrentOriginGroqFreeModel(catalog: readonly OriginGroqFreeModelEvidence[] = DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG, nowMs: number = Date.now()): OriginGroqFreeModelCatalogResult {
  return selectCurrentOriginGroqFreeModelById(catalog, ORIGIN_GROQ_FREE_MODEL_ID, nowMs);
}
