import { describe, expect, it } from "vitest";
import {
  evaluateOriginFreeModelCalibrationV1,
  type OriginFreeCalibrationProbeV1,
} from "./OriginFreeModelLiveCalibrationV1.js";
const modelId = "google/gemma-4-31b-it:free";
const policy = {
  allow_fallbacks: false, data_collection: "deny", zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0 },
} as const;
function probes(): OriginFreeCalibrationProbeV1[] {
  return [
    {
      probeId: "identity",
      requestedModel: modelId,
      servedModel: modelId,
      answer: "ORIGIN_FREE_CALIBRATION_OK",
      usageCostUsd: "0",
      upstreamCostUsd: 0,
      isByok: false,
      providerPolicy: policy,
    },
    {
      probeId: "arithmetic",
      requestedModel: modelId,
      servedModel: modelId.slice(0, -5),
      answer: "391",
      usageCostUsd: 0,
      upstreamCostUsd: undefined,
      isByok: false,
      providerPolicy: policy,
    },
  ];
}
const evaluate = (p: OriginFreeCalibrationProbeV1[] = probes(), id = modelId) =>
  evaluateOriginFreeModelCalibrationV1({
    modelId: id, checkedAt: "2026-10-10T00:00:00.000Z", probes: p,
  });

describe("free model live two-probe calibration V1", () => {
  it("qualifies only for external review, never independently verifies billing/privacy or promotes Production", () => {
    const x = evaluate();
    expect(x).toMatchObject({
      eligibleForIndependentProviderReview: true,
      liveProofSelfReported: true,
      billingReceiptIndependentlyVerified: false,
      providerRetentionIndependentlyVerified: false,
      quality40Measured: false,
      productionPromotionAllowed: false,
      probeCount: 2,
      blockers: [],
    });
  });
  it("blocks missing or duplicate public calibration probes", () => {
    expect(evaluate(probes().slice(0,1)).blockers).toContain("AQ_FREE_CALIBRATION_SHAPE_INVALID");
    expect(evaluate([probes()[0], probes()[0]]).blockers).toContain("AQ_FREE_CALIBRATION_SHAPE_INVALID");
  });
  it("rejects served model substitutions even when they are free", () => {
    const x = probes();
    x[1] = { ...x[1], servedModel: "other/free-model:free" };
    expect(evaluate(x).blockers).toContain("AQ_FREE_CALIBRATION_SERVED_MODEL_MISMATCH");
  });
  it.each([null, undefined, 0.000001, "0.00000000001", "-0", "NaN", "free"])(
    "rejects invalid/unknown costs %s", value => {
      const x = probes();
      x[0] = { ...x[0], usageCostUsd: value };
      expect(evaluate(x).blockers).toContain("AQ_FREE_CALIBRATION_ZERO_COST_UNVERIFIED");
    },
  );
  it("fails closed on upstream paid cost or BYOK", () => {
    const x = probes();
    x[0] = { ...x[0], upstreamCostUsd: 0.01 };
    expect(evaluate(x).blockers).toContain("AQ_FREE_CALIBRATION_ZERO_COST_UNVERIFIED");
    const y = probes();
    y[1] = { ...y[1], isByok: true };
    expect(evaluate(y).blockers).toContain("AQ_FREE_CALIBRATION_ZERO_COST_UNVERIFIED");
  });
  it.each([undefined, null, "false", "true", true, 0, 1])(
    "rejects missing or nonboolean BYOK evidence: %s", status => {
      const probe = probes();
      probe[0] = { ...probe[0], isByok: status };
      const verdict = evaluate(probe);
      expect(verdict.eligibleForIndependentProviderReview).toBe(false);
      expect(verdict.blockers).toContain("AQ_FREE_CALIBRATION_ZERO_COST_UNVERIFIED");
    },
  );
  it("rejects fallback, non-ZDR provider and any unbounded max-price", () => {
    const x = probes();
    x[0] = { ...x[0], providerPolicy: { ...policy, zdr: false as true } };
    expect(evaluate(x).blockers).toContain("AQ_FREE_CALIBRATION_PRIVACY_OR_PRICE_POLICY_INVALID");
    const y = probes();
    y[0] = { ...y[0], providerPolicy: { ...policy, max_price: { ...policy.max_price, request: 0.01 as 0 } } };
    expect(evaluate(y).blockers).toContain("AQ_FREE_CALIBRATION_PRIVACY_OR_PRICE_POLICY_INVALID");
    const z = probes();
    z[0] = { ...z[0], providerPolicy: { ...policy, allow_fallbacks: true as false } };
    expect(evaluate(z).blockers).toContain("AQ_FREE_CALIBRATION_PRIVACY_OR_PRICE_POLICY_INVALID");
  });
  it("requires actual correct public answers, not merely nonempty completions", () => {
    const x = probes();
    x[1] = { ...x[1], answer: "392" };
    expect(evaluate(x).blockers).toContain("AQ_FREE_CALIBRATION_ANSWER_INVALID");
    const y = probes();
    y[0] = { ...y[0], answer: "untrusted output" };
    expect(evaluate(y).blockers).toContain("AQ_FREE_CALIBRATION_ANSWER_INVALID");
  });
  it("rejects paid canonical model ID even if responses look zero-cost", () => {
    expect(evaluate(probes(), modelId.slice(0, -5)).blockers).toContain("AQ_FREE_CALIBRATION_MODEL_INVALID");
  });
});
