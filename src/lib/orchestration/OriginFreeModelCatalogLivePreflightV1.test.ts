import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auditOriginLiveFreeModelCatalogV1,
  auditOriginLiveFreeZdrEndpointsV1,
} from "./OriginFreeModelCatalogLivePreflightV1.js";

const modelId = "google/gemma-4-31b-it:free";
const baseId = "google/gemma-4-31b-it";

function endpoint(overrides: Record<string, unknown> = {}) {
  return {
    model_id: baseId,
    pricing: { prompt: "0", completion: "0" },
    status: 0,
    provider_name: "provider",
    supported_parameters: ["tools"],
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("ZDR preflight ID and price normalization", () => {
  it("accepts the base ZDR model ID when request pricing is omitted", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const verdict = auditOriginLiveFreeZdrEndpointsV1({
      modelId,
      endpoints: { data: [endpoint()] },
    });
    expect(verdict.eligibleForPublicCalibration).toBe(true);
    expect(verdict.qualifyingEndpointCount).toBe(1);
    expect(verdict.productionPromotionAllowed).toBe(false);
  });

  it("accepts an explicitly undefined request price but requires all other prices to be zero", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const verdict = auditOriginLiveFreeZdrEndpointsV1({
      modelId,
      endpoints: { data: [endpoint({ pricing: {
        prompt: 0, completion: "0.0", request: undefined, cache_read: "0",
      } })] },
    });
    expect(verdict.eligibleForPublicCalibration).toBe(true);
  });

  it("rejects a nonzero request price", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const verdict = auditOriginLiveFreeZdrEndpointsV1({
      modelId,
      endpoints: { data: [endpoint({ pricing: { prompt: 0, completion: 0, request: "0.01" } })] },
    });
    expect(verdict.eligibleForPublicCalibration).toBe(false);
    expect(verdict.qualifyingEndpointCount).toBe(0);
  });

  it("rejects a nonzero additional price category", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const verdict = auditOriginLiveFreeZdrEndpointsV1({
      modelId,
      endpoints: { data: [endpoint({ pricing: {
        prompt: 0, completion: 0, cache_read: "0.01",
      } })] },
    });
    expect(verdict.eligibleForPublicCalibration).toBe(false);
  });

  it("still requires explicit zero prompt and completion prices", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const verdict = auditOriginLiveFreeZdrEndpointsV1({
      modelId,
      endpoints: { data: [endpoint({ pricing: { prompt: 0, completion: undefined } })] },
    });
    expect(verdict.eligibleForPublicCalibration).toBe(false);
  });

  it("matches a base ZDR ID in catalog preflight without weakening free-alias validation", () => {
    const verdict = auditOriginLiveFreeModelCatalogV1({
      modelId,
      search: { data: [{
        id: modelId,
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["tools"],
      }] },
      zdrZeroPrice: { data: [{
        id: baseId,
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["tools"],
      }] },
    });
    expect(verdict.catalogEligible).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.productionPromotionAllowed).toBe(false);
  });
});
