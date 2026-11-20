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
    verifiedAt: "2026-11-20T07:20:58.911Z",
    reviewAfter: "2026-11-30T07:20:58.910Z",
    sourceUrl: ORIGIN_OPENROUTER_FREE_MODEL_SOURCE,
    sourceDescription: "OpenRouter official /api/v1/models pricing was rechecked on 2026-11-05: google/gemma-4-31b-it:free reports prompt and completion prices of 0. This catalog check does not verify live endpoint-level ZDR, request-level charges, or an authenticated billing receipt. Runtime must continue enforcing provider.zdr=true, data_collection=deny, max-price zero, no provider fallback, exact served-model identity, and zero reported usage telemetry; any unverifiable or non-zero condition fails closed before an answer is returned.",
  },
] as const;

export type OriginFreeModelCatalogFailureCode = "FREE_MODEL_CATALOG_INVALID" | "FREE_MODEL_EVIDENCE_STALE";
export type OriginFreeModelCatalogResult = { ok: true; model: OriginFreeModelEvidence } | { ok: false; code: OriginFreeModelCatalogFailureCode; message: string };

/**
 * Route disposition for the OpenRouter route (PKG-4 PR-2, 2026-11-17): the
 * route is STOPPED and is never executed. The owner enabled OpenRouter's ZDR
 * enforcement on 2026-11-15; the model's sole endpoint does not support ZDR
 * (the provider retains request data for 55 days), so the endpoint vanished
 * and every attempt has since failed with a 404 after paying a 92-208ms
 * dead-attempt cost on every chat dispatch. The disposition is a code-level
 * fact, not a runtime switch: the failover dispatcher records the route as
 * skipped (skipReason "route-stopped", zero transport) instead of attempting
 * it, and plan building no longer gates on this entry's evidence freshness
 * (see selectOriginFreeModelForStoppedRoute). The catalog entry above is
 * retained unchanged as the historical evidence record. Restarting the route
 * requires reverting this disposition AND renewing the evidence first; the
 * freshness gate in selectCurrentOriginFreeModel stays in force for any
 * caller that would actually execute the route.
 */
export const ORIGIN_OPENROUTER_ROUTE_DISPOSITION = "stopped" as const;

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

/**
 * The catalog entry used while the OpenRouter route carries the "stopped"
 * disposition (ORIGIN_OPENROUTER_ROUTE_DISPOSITION): the entry is returned
 * as the plan's evidence RECORD without applying the freshness window,
 * because the route is never executed — the serving routes (Cloudflare,
 * Groq) each verify their own evidence freshness before running. Catalog
 * validity is still enforced exactly as in selectCurrentOriginFreeModel: a
 * malformed catalog yields null here and plan building fails closed with
 * FREE_MODEL_CATALOG_INVALID. Only staleness is waived, and only for this
 * stopped route.
 */
export function selectOriginFreeModelForStoppedRoute(catalog: readonly OriginFreeModelEvidence[] = DEFAULT_ORIGIN_FREE_MODEL_CATALOG): OriginFreeModelEvidence | null {
  if (catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) return null;
  return catalog.find((entry) => isValidEvidence(entry)) ?? null;
}
