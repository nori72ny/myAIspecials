export type OriginFreeModelId = `${string}/${string}:free` | "openrouter/free";

export interface OriginFreeModelEvidence {
  providerId: "openrouter-free";
  providerLabel: string;
  modelId: OriginFreeModelId;
  verifiedAt: string;
  reviewAfter: string;
  sourceUrl: string;
  sourceDescription: string;
}

export const ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL = "openrouter/free" as const;
const ORIGIN_OPENROUTER_FREE_ROUTER_SOURCE =
  "https://openrouter.ai/docs/guides/routing/routers/free-router" as const;

export const DEFAULT_ORIGIN_FREE_MODEL_CATALOG: readonly OriginFreeModelEvidence[] = [
  {
    providerId: "openrouter-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
    verifiedAt: "2026-07-24T00:00:00.000Z",
    reviewAfter: "2026-08-01T23:59:59.999Z",
    sourceUrl: ORIGIN_OPENROUTER_FREE_ROUTER_SOURCE,
    sourceDescription: "OpenRouter's official Free Models Router documentation states that openrouter/free selects only currently available free models and that both the router and routed requests are free.",
  },
] as const;

export type OriginFreeModelCatalogFailureCode =
  | "FREE_MODEL_CATALOG_INVALID"
  | "FREE_MODEL_EVIDENCE_STALE";

export type OriginFreeModelCatalogResult =
  | { ok: true; model: OriginFreeModelEvidence }
  | { ok: false; code: OriginFreeModelCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isValidEvidence(entry: OriginFreeModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt);
  const reviewAfter = parseTimestamp(entry.reviewAfter);

  return entry.providerId === "openrouter-free"
    && (entry.modelId === "openrouter/free" || entry.modelId.endsWith(":free"))
    && entry.sourceUrl.startsWith("https://openrouter.ai/")
    && verifiedAt !== null
    && reviewAfter !== null
    && reviewAfter > verifiedAt;
}

function isOfficialFreeRouterEvidence(entry: OriginFreeModelEvidence): boolean {
  return entry.modelId === ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL
    && entry.sourceUrl === ORIGIN_OPENROUTER_FREE_ROUTER_SOURCE;
}

export function selectCurrentOriginFreeModel(
  catalog: readonly OriginFreeModelEvidence[] = DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
  nowMs: number = Date.now(),
): OriginFreeModelCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) {
    return {
      ok: false,
      code: "FREE_MODEL_CATALOG_INVALID",
      message: "無料モデルの証拠カタログが正しくありません。",
    };
  }

  const current = catalog.find((entry) => {
    const verifiedAt = parseTimestamp(entry.verifiedAt);
    const reviewAfter = parseTimestamp(entry.reviewAfter);
    return verifiedAt !== null
      && reviewAfter !== null
      && nowMs >= verifiedAt
      && (isOfficialFreeRouterEvidence(entry) || nowMs <= reviewAfter);
  });

  if (!current) {
    return {
      ok: false,
      code: "FREE_MODEL_EVIDENCE_STALE",
      message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。",
    };
  }

  return { ok: true, model: current };
}
