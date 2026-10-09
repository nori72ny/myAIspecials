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
  return isExactZero(row.pricing?.prompt)
    && isExactZero(row.pricing?.completion)
    && isExactZero(row.pricing?.request);
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
    liveInferenceVerified: false,
    billingReceiptsVerified: false,
    productionPromotionAllowed: false,
    blockers: Object.freeze(unique),
    availableFreeZdrToolModels: Object.freeze(availableFreeZdrToolModels),
  });
}
