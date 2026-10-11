/**
 * Calibrate an explicitly pinned OpenRouter :free model against two synthetic
 * public prompts. Evidence structures alone never authorize Production.
 */
export const ORIGIN_FREE_MODEL_CALIBRATION_V1 = "origin.free-model-calibration.v1" as const;
const MODEL = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*:free$/i;
export type OriginFreeCalibrationProbeV1 = {
  readonly probeId: "identity" | "arithmetic";
  readonly requestedModel: string;
  readonly servedModel: string;
  readonly answer: string;
  readonly usageCostUsd: unknown;
  readonly upstreamCostUsd: unknown;
  /** Optional provider-reported OpenRouter server-tool charge, if present. */
  readonly serverToolCostUsd: unknown;
  readonly isByok: unknown;
  readonly providerPolicy: {
    readonly allow_fallbacks: false;
    readonly data_collection: "deny";
    readonly zdr: true;
    readonly max_price: { readonly prompt: 0; readonly completion: 0; readonly request: 0 };
  };
};
export interface OriginFreeModelCalibrationReportV1 {
  readonly schemaVersion: typeof ORIGIN_FREE_MODEL_CALIBRATION_V1;
  readonly modelId: string;
  readonly checkedAt: string;
  readonly probeCount: number;
  readonly eligibleForIndependentProviderReview: boolean;
  readonly liveProofSelfReported: true;
  readonly billingReceiptIndependentlyVerified: false;
  readonly providerRetentionIndependentlyVerified: false;
  readonly quality40Measured: false;
  readonly productionPromotionAllowed: false;
  readonly blockers: readonly string[];
}
function exactZero(v: unknown): boolean {
  return v === 0 || (typeof v === "string" && /^(?:0|0\.0+)$/.test(v));
}
export function evaluateOriginFreeModelCalibrationV1(input: {
  readonly modelId: string;
  readonly checkedAt: string;
  readonly probes: readonly OriginFreeCalibrationProbeV1[];
}): OriginFreeModelCalibrationReportV1 {
  const { modelId, checkedAt, probes } = input;
  const blockers: string[] = [];
  if (!MODEL.test(modelId)) blockers.push("AQ_FREE_CALIBRATION_MODEL_INVALID");
  if (!Number.isFinite(Date.parse(checkedAt)) || !checkedAt.endsWith("Z")) {
    blockers.push("AQ_FREE_CALIBRATION_TIME_INVALID");
  }
  if (!Array.isArray(probes) || probes.length !== 2
    || new Set(probes.map(p => p?.probeId)).size !== 2
    || !probes.some(p => p?.probeId === "identity")
    || !probes.some(p => p?.probeId === "arithmetic")) {
    blockers.push("AQ_FREE_CALIBRATION_SHAPE_INVALID");
  }
  if (Array.isArray(probes)) {
    for (const probe of probes) {
      if (!probe
        || probe.requestedModel !== modelId
        || probe.servedModel !== modelId) {
        blockers.push("AQ_FREE_CALIBRATION_SERVED_MODEL_MISMATCH");
      }
      if (!probe || !exactZero(probe.usageCostUsd)
        // OpenRouter documents null for upstream cost on non-BYOK calls.
        // This exception is safe only with explicit isByok=false below.
        || (probe.upstreamCostUsd != null && !exactZero(probe.upstreamCostUsd))
        || (probe.serverToolCostUsd != null && !exactZero(probe.serverToolCostUsd))
        || probe.isByok !== false) {
        blockers.push("AQ_FREE_CALIBRATION_ZERO_COST_UNVERIFIED");
      }
      if (!probe
        || probe.providerPolicy?.zdr !== true
        || probe.providerPolicy?.data_collection !== "deny"
        || probe.providerPolicy?.allow_fallbacks !== false
        || probe.providerPolicy?.max_price?.prompt !== 0
        || probe.providerPolicy?.max_price?.completion !== 0
        || probe.providerPolicy?.max_price?.request !== 0) {
        blockers.push("AQ_FREE_CALIBRATION_PRIVACY_OR_PRICE_POLICY_INVALID");
      }
      const expected = probe?.probeId === "identity" ? "ORIGIN_FREE_CALIBRATION_OK"
        : probe?.probeId === "arithmetic" ? "391" : null;
      if (expected === null || probe?.answer?.trim() !== expected) {
        blockers.push("AQ_FREE_CALIBRATION_ANSWER_INVALID");
      }
    }
  }
  const unique = [...new Set(blockers)];
  return Object.freeze({
    schemaVersion: ORIGIN_FREE_MODEL_CALIBRATION_V1,
    modelId,
    checkedAt,
    probeCount: Array.isArray(probes) ? probes.length : 0,
    eligibleForIndependentProviderReview: unique.length === 0,
    liveProofSelfReported: true,
    billingReceiptIndependentlyVerified: false,
    providerRetentionIndependentlyVerified: false,
    quality40Measured: false,
    productionPromotionAllowed: false,
    blockers: Object.freeze(unique),
  });
}
