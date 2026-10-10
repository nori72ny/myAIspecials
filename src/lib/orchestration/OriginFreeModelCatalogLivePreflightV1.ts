/**
 * Read-only catalog preflight for frozen ORIGIN public AQ-40 qualification.
 *
 * No provider credentials, inference, model switching, Vercel alias mutation,
 * or production-release authority. Do NOT interpret "catalogEligible" as
 * successful zero-cost serving, provider-data retention evidence, or AQ PASS.
 */
export interface OriginFreeCatalogRowV1 {
  readonly id?: unknown;
  readonly pricing?: {
    readonly prompt?: unknown;
    readonly completion?: unknown;
    readonly request?: unknown;
  };
  readonly supported_parameters?: unknown;
}
export interface OriginFreeCatalogPayloadV1 {
  readonly data?: unknown;
}
export interface OriginLiveFreeModelCatalogInputV1 {
  readonly modelId: string;
  readonly search: OriginFreeCatalogPayloadV1;
  readonly zdrZeroPrice: OriginFreeCatalogPayloadV1;
}
export type OriginLiveFreeModelBlockerV1 =
  | "AQ_FREE_MODEL_ID_NOT_EXPLICIT_FREE"
  | "AQ_FREE_MODEL_CATALOG_INVALID"
  | "AQ_FREE_MODEL_NOT_LISTED"
  | "AQ_FREE_MODEL_PAID_ALIAS_ONLY"
  | "AQ_FREE_MODEL_CATALOG_DUPLICATE"
  | "AQ_FREE_MODEL_PRICE_UNVERIFIED"
  | "AQ_FREE_MODEL_ZDR_ZERO_ENDPOINT_MISSING"
  | "AQ_FREE_MODEL_TOOL_SUPPORT_UNVERIFIED";
export interface OriginLiveFreeModelCatalogVerdictV1 {
  readonly schemaVersion: "origin.live-free-model-catalog-preflight.v1";
  readonly modelId: string;
  readonly catalogEligible: boolean;
  /** Public catalog may omit per-request pricing. This is NOT a billing receipt. */
  readonly catalogRequestPriceKnownZero: boolean;
  readonly liveInferenceVerified: false;
  readonly billingReceiptsVerified: false;
  readonly productionPromotionAllowed: false;
  readonly blockers: readonly OriginLiveFreeModelBlockerV1[];
  readonly availableFreeZdrToolModels: readonly string[];
}
const MODEL = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*:free$/i;
const ZERO = /^(?:0|0\.0+)$/;
function isExactZero(value: unknown): boolean {
  return value === 0 || (typeof value === "string" && ZERO.test(value));
}
function priceIsZero(row: OriginFreeCatalogRowV1): boolean {
  // OpenRouter's public catalog commonly omits request price. Permit an
  // *inference calibration candidate* if prompt/completion are exactly $0;
  // any nonzero/unknown *present* request price fails closed. A real inference
  // MUST still enforce provider.max_price.request=0 and verify billing receipts.
  return isExactZero(row.pricing?.prompt)
    && isExactZero(row.pricing?.completion)
    && (row.pricing?.request === undefined || isExactZero(row.pricing.request));
}
function rows(value: OriginFreeCatalogPayloadV1): OriginFreeCatalogRowV1[] | null {
  if (!value || !Array.isArray(value.data) || value.data.length > 512) return null;
  if (!value.data.every((x: unknown) => x && typeof x === "object" && !Array.isArray(x)
    && typeof (x as OriginFreeCatalogRowV1).id === "string")) return null;
  return value.data as OriginFreeCatalogRowV1[];
}
function supportsTools(row: OriginFreeCatalogRowV1): boolean {
  return Array.isArray(row.supported_parameters) && row.supported_parameters.includes("tools");
}
export function auditOriginLiveFreeModelCatalogV1(
  input: OriginLiveFreeModelCatalogInputV1,
): OriginLiveFreeModelCatalogVerdictV1 {
  const modelId = typeof input?.modelId === "string" ? input.modelId : "";
  const blockers: OriginLiveFreeModelBlockerV1[] = [];
  if (!MODEL.test(modelId)) blockers.push("AQ_FREE_MODEL_ID_NOT_EXPLICIT_FREE");
  const search = rows(input?.search);
  const zdr = rows(input?.zdrZeroPrice);
  if (!search || !zdr) blockers.push("AQ_FREE_MODEL_CATALOG_INVALID");
  const availableFreeZdrToolModels = zdr
    ? [...new Set(zdr.filter(r => typeof r.id === "string" && MODEL.test(r.id)
        && priceIsZero(r) && supportsTools(r)).map(r => r.id as string))].sort()
    : [];
  if (search && zdr && MODEL.test(modelId)) {
    const seen = search.filter(r => r.id === modelId);
    const zeroZdr = zdr.filter(r => r.id === modelId);
    if (seen.length > 1 || zeroZdr.length > 1) {
      blockers.push("AQ_FREE_MODEL_CATALOG_DUPLICATE");
    }
    if (seen.length === 0) {
      const paidAlias = modelId.slice(0, -5);
      blockers.push(search.some(r => r.id === paidAlias)
        ? "AQ_FREE_MODEL_PAID_ALIAS_ONLY"
        : "AQ_FREE_MODEL_NOT_LISTED");
    } else if (!priceIsZero(seen[0])) {
      blockers.push("AQ_FREE_MODEL_PRICE_UNVERIFIED");
    }
    if (zeroZdr.length !== 1 || !priceIsZero(zeroZdr[0])) {
      blockers.push("AQ_FREE_MODEL_ZDR_ZERO_ENDPOINT_MISSING");
    }
    if ((seen.length !== 1 || !supportsTools(seen[0]))
        || (zeroZdr.length !== 1 || !supportsTools(zeroZdr[0]))) {
      blockers.push("AQ_FREE_MODEL_TOOL_SUPPORT_UNVERIFIED");
    }
  }
  const unique = [...new Set(blockers)];
  return Object.freeze({
    schemaVersion: "origin.live-free-model-catalog-preflight.v1",
    modelId,
    catalogEligible: unique.length === 0,
    catalogRequestPriceKnownZero: Boolean(search?.length === 1 && zdr?.length > 0
      && search[0].id === modelId && search[0].pricing?.request !== undefined
      && isExactZero(search[0].pricing.request)
      && zdr.some(row => row.id === modelId && row.pricing?.request !== undefined
        && isExactZero(row.pricing.request))),
    liveInferenceVerified: false,
    billingReceiptsVerified: false,
    productionPromotionAllowed: false,
    blockers: Object.freeze(unique),
    availableFreeZdrToolModels: Object.freeze(availableFreeZdrToolModels),
  });
}


/**
 * Authenticated read-only endpoint attestation. OpenRouter's /endpoints/zdr
 * is a list of ZDR-qualified endpoint records, not a model-level guess.
 * This is a prerequisite to *asking* a live model, not independent
 * confirmation of actual routing, billing or retention on a served request.
 */
export function auditOriginLiveFreeZdrEndpointsV1(input: {
  readonly modelId: string;
  readonly endpoints: OriginFreeCatalogPayloadV1;
}): {
  readonly schemaVersion: "origin.live-free-zdr-endpoints.v1";
  readonly modelId: string;
  readonly eligibleForPublicCalibration: boolean;
  readonly qualifyingEndpointCount: number;
  readonly realInferenceVerified: false;
  readonly independentBillingVerified: false;
  readonly productionPromotionAllowed: false;
  readonly blockers: readonly string[];
} {
  const modelId = typeof input?.modelId === "string" ? input.modelId : "";
  const raw = input?.endpoints?.data;
  const invalid = !Array.isArray(raw) || raw.length > 4096
    || !raw.every((v: unknown) => v && typeof v === "object" && !Array.isArray(v));
  const blockers: string[] = [];
  if (!MODEL.test(modelId)) blockers.push("AQ_FREE_ZDR_ENDPOINT_MODEL_INVALID");
  if (invalid) blockers.push("AQ_FREE_ZDR_ENDPOINT_PAYLOAD_INVALID");
  let qualifyingEndpointCount = 0;
  if (!invalid && MODEL.test(modelId)) {
    for (const entry of raw as Record<string, unknown>[]) {
      if (entry.model_id !== modelId) continue;
      const prices = entry.pricing;
      if (!prices || typeof prices !== "object" || Array.isArray(prices)) continue;
      const pricing = prices as Record<string, unknown>;
      // Refuse missing price fields *or* any extra nonzero/unknown category,
      // including cache and per-request charges hidden by model-level listings.
      if (!isExactZero(pricing.prompt) || !isExactZero(pricing.completion)
        || !isExactZero(pricing.request)
        || !Object.values(pricing).every(isExactZero)) continue;
      if (entry.status !== 0
        || typeof entry.provider_name !== "string"
        || !entry.provider_name.trim()
        || !Array.isArray(entry.supported_parameters)
        || !entry.supported_parameters.includes("tools")) continue;
      qualifyingEndpointCount += 1;
    }
  }
  if (!qualifyingEndpointCount) blockers.push("AQ_FREE_ZDR_ENDPOINT_EXACT_ZERO_NOT_VERIFIED");
  return Object.freeze({
    schemaVersion: "origin.live-free-zdr-endpoints.v1",
    modelId,
    eligibleForPublicCalibration: blockers.length === 0,
    qualifyingEndpointCount,
    realInferenceVerified: false,
    independentBillingVerified: false,
    productionPromotionAllowed: false,
    blockers: Object.freeze(blockers),
  });
}
