import { describe, expect, it } from "vitest";
import {
  auditOriginLiveFreeModelCatalogV1,
  auditOriginLiveFreeZdrEndpointsV1,
  type OriginFreeCatalogRowV1,
} from "./OriginFreeModelCatalogLivePreflightV1.js";

const modelId = "google/gemma-4-31b-it:free";
const makeRow = (id: string = modelId, pricing: Record<string, unknown> = {
  prompt: "0", completion: "0.0000", request: "0",
}): OriginFreeCatalogRowV1 => ({
  id,
  pricing,
  supported_parameters: ["tools", "response_format", "temperature"],
});
const evidence = () => ({
  modelId,
  search: { data: [makeRow()] },
  zdrZeroPrice: { data: [makeRow()] },
});

describe("Origin read-only live free-model catalog preflight V1", () => {
  it("marks listed $0/ZDR tool model as CALIBRATION candidate only, never an inference or release PASS", () => {
    const output = auditOriginLiveFreeModelCatalogV1(evidence());
    expect(output).toEqual({
      schemaVersion: "origin.live-free-model-catalog-preflight.v1",
      modelId,
      catalogEligible: true,
      catalogRequestPriceKnownZero: true,
      liveInferenceVerified: false,
      billingReceiptsVerified: false,
      productionPromotionAllowed: false,
      blockers: [],
      availableFreeZdrToolModels: [modelId],
    });
  });
  it("blocks the retired :free ID even if the canonical paid alias remains", () => {
    const output = auditOriginLiveFreeModelCatalogV1({
      modelId: "inclusionai/ling-3.0-flash-sante:free",
      search: { data: [makeRow("inclusionai/ling-3.0-flash-sante", {
        prompt: "0.000000042", completion: "0.0000001232", request: "0",
      })] },
      zdrZeroPrice: { data: [makeRow()] },
    });
    expect(output.catalogEligible).toBe(false);
    expect(output.blockers).toContain("AQ_FREE_MODEL_PAID_ALIAS_ONLY");
    expect(output.productionPromotionAllowed).toBe(false);
  });
  it("rejects free aliases not listed in the official live catalog", () => {
    const output = auditOriginLiveFreeModelCatalogV1({
      ...evidence(), modelId: "unknown/missing-model:free",
    });
    expect(output.blockers).toContain("AQ_FREE_MODEL_NOT_LISTED");
  });
  it.each([
    { prompt: "0.000001", completion: "0", request: "0" },
    { prompt: "0", completion: "0.000001", request: "0" },
    { prompt: "0", completion: "0", request: "0.001" },
    { prompt: null, completion: "0", request: "0" },
    { prompt: "NaN", completion: "0", request: "0" },
    { prompt: -0.0001, completion: "0", request: "0" },
    { prompt: "-0", completion: "0", request: "0" },
  ])("rejects nonzero, unknown, or malformed price %j", pricing => {
    const output = auditOriginLiveFreeModelCatalogV1({
      ...evidence(), search: { data: [makeRow(modelId, pricing)] },
    });
    expect(output.blockers).toContain("AQ_FREE_MODEL_PRICE_UNVERIFIED");
  });
  it("accepts catalog candidate with omitted request price but NEVER treats request billing as proven", () => {
    const price = { prompt: "0", completion: "0" };
    const output = auditOriginLiveFreeModelCatalogV1({
      ...evidence(), search: { data: [makeRow(modelId, price)] },
      zdrZeroPrice: { data: [makeRow(modelId, price)] },
    });
    expect(output.catalogEligible).toBe(true);
    expect(output.catalogRequestPriceKnownZero).toBe(false);
    expect(output.liveInferenceVerified).toBe(false);
    expect(output.billingReceiptsVerified).toBe(false);
    expect(output.productionPromotionAllowed).toBe(false);
  });
  it("rejects free model lacking a ZDR + $0 endpoint in independently filtered catalog", () => {
    const output = auditOriginLiveFreeModelCatalogV1({
      ...evidence(), zdrZeroPrice: { data: [makeRow("other/free-model:free")] },
    });
    expect(output.blockers).toContain("AQ_FREE_MODEL_ZDR_ZERO_ENDPOINT_MISSING");
  });
  it("rejects listing whose zero-cost ZDR price is ambiguous", () => {
    const output = auditOriginLiveFreeModelCatalogV1({
      ...evidence(),
      zdrZeroPrice: { data: [makeRow(modelId, { prompt: "0", completion: "unknown", request: "0" })] },
    });
    expect(output.blockers).toContain("AQ_FREE_MODEL_ZDR_ZERO_ENDPOINT_MISSING");
  });
  it("rejects tools unsupported by either search or filtered ZDR model", () => {
    const a = auditOriginLiveFreeModelCatalogV1({
      ...evidence(), search: { data: [{ ...makeRow(), supported_parameters: [] }] },
    });
    const b = auditOriginLiveFreeModelCatalogV1({
      ...evidence(), zdrZeroPrice: { data: [{ ...makeRow(), supported_parameters: undefined }] },
    });
    expect(a.blockers).toContain("AQ_FREE_MODEL_TOOL_SUPPORT_UNVERIFIED");
    expect(b.blockers).toContain("AQ_FREE_MODEL_TOOL_SUPPORT_UNVERIFIED");
  });
  it("rejects duplicated catalog rows and malformed payloads, fail closed", () => {
    const double = auditOriginLiveFreeModelCatalogV1({
      ...evidence(), search: { data: [makeRow(), makeRow()] },
    });
    const invalid = auditOriginLiveFreeModelCatalogV1({
      ...evidence(), search: { data: "not-an-array" },
    });
    expect(double.blockers).toContain("AQ_FREE_MODEL_CATALOG_DUPLICATE");
    expect(invalid.blockers).toContain("AQ_FREE_MODEL_CATALOG_INVALID");
    expect(double.catalogEligible).toBe(false);
    expect(invalid.catalogEligible).toBe(false);
  });
  it.each(["openrouter/auto", "openrouter/free", "google/gemma-4-31b-it", "https://bad.example/:free"])(
    "rejects ambiguous or paid-capable request ID %s", value => {
      const output = auditOriginLiveFreeModelCatalogV1({ ...evidence(), modelId: value });
      expect(output.blockers).toContain("AQ_FREE_MODEL_ID_NOT_EXPLICIT_FREE");
    },
  );
});


describe("authenticated ZDR endpoint price gate (read-only; not a live inference)", () => {
  const endpointModelId = "google/gemma-4-31b-it:free";
  const good = () => ({
    model_id: endpointModelId,
    provider_name: "Verified synthetic provider",
    status: 0,
    pricing: { prompt: "0", completion: "0.0000", request: "0", image: "0" },
    supported_parameters: ["tools", "temperature"],
  });
  const check = (data: unknown, id = endpointModelId) =>
    auditOriginLiveFreeZdrEndpointsV1({ modelId: id, endpoints: { data } });

  it("accepts one eligible exact-zero ZDR endpoint ONLY for bounded public calibration", () => {
    const result = check([good(), { ...good(), model_id: "different/paid" }]);
    expect(result).toEqual({
      schemaVersion: "origin.live-free-zdr-endpoints.v1",
      modelId: endpointModelId,
      eligibleForPublicCalibration: true,
      qualifyingEndpointCount: 1,
      realInferenceVerified: false,
      independentBillingVerified: false,
      productionPromotionAllowed: false,
      blockers: [],
    });
  });
  it.each([
    { pricing: { prompt: "0", completion: "0", request: "0.000000000001" } },
    { pricing: { prompt: "0", completion: "0", request: "1e-9999" } },
    { pricing: { prompt: "0", completion: "0" } },
    { pricing: { prompt: "0", completion: "0", request: "0", input_cache_read: "0.01" } },
    { status: 1 },
    { provider_name: "" },
    { supported_parameters: ["temperature"] },
    { model_id: "google/gemma-4-31b-it" },
  ])("rejects endpoints with paid, missing, ambiguous, unsupported or inactive evidence: %j", patch => {
    const result = check([{ ...good(), ...patch }]);
    expect(result.eligibleForPublicCalibration).toBe(false);
    expect(result.blockers).toContain("AQ_FREE_ZDR_ENDPOINT_EXACT_ZERO_NOT_VERIFIED");
  });
  it("rejects invalid endpoint payload and ambiguous requested paid model", () => {
    expect(check("fake").blockers).toContain("AQ_FREE_ZDR_ENDPOINT_PAYLOAD_INVALID");
    expect(check([good()], "google/gemma-4-31b-it").blockers).toContain("AQ_FREE_ZDR_ENDPOINT_MODEL_INVALID");
    expect(check(Array(4097).fill(good())).blockers).toContain("AQ_FREE_ZDR_ENDPOINT_PAYLOAD_INVALID");
  });
});
