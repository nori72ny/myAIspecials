import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG,
  isOriginCloudflareFreeModelId,
  ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID,
  ORIGIN_CLOUDFLARE_FREE_MODEL,
  ORIGIN_CLOUDFLARE_FREE_MODEL_IDS,
  ORIGIN_CLOUDFLARE_FREE_MODEL_NEURONS_PER_MILLION_TOKENS,
  selectCurrentOriginCloudflareFreeModel,
  selectCurrentOriginCloudflareFreeModelById,
  type OriginCloudflareFreeModelEvidence,
} from "./OriginCloudflareFreeModelCatalog";

const DURING_MS = Date.parse("2026-11-10T12:00:00.000Z");
const AFTER_ALL_REVIEW_MS = Date.parse("2026-11-21T00:00:00.000Z");

describe("Cloudflare free model evidence catalog", () => {
  it("pins the verified primary model and the 2026-11-19 review deadline", () => {
    const entry = DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG[0];
    expect(entry.providerId).toBe("cloudflare-workers-ai-free");
    expect(entry.modelId).toBe(ORIGIN_CLOUDFLARE_FREE_MODEL);
    expect(entry.modelId).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(entry.verifiedAt).toBe("2026-11-09T13:00:00.000Z");
    expect(entry.reviewAfter).toBe("2026-11-19T13:00:00.000Z");
    expect(entry.sourceDescription).toContain("zero data retention");
    expect(entry.sourceDescription).toContain("10,000 Neurons per day");
    expect(entry.sourceDescription).toContain("9,091 / 27,273 Neurons");
  });

  it("catalogues exactly the primary model and the light-routing candidate, nothing else", () => {
    expect(DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG.map((entry) => entry.modelId)).toEqual([
      "@cf/google/gemma-4-26b-a4b-it",
      "@cf/qwen/qwen3-30b-a3b-fp8",
    ]);
    expect(ORIGIN_CLOUDFLARE_FREE_MODEL_IDS).toEqual([
      "@cf/google/gemma-4-26b-a4b-it",
      "@cf/qwen/qwen3-30b-a3b-fp8",
    ]);
  });

  it("pins the light candidate entry with its deprecation-capped review deadline and honest limits", () => {
    const entry = DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG[1];
    expect(entry.providerId).toBe("cloudflare-workers-ai-free");
    expect(entry.modelId).toBe(ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID);
    expect(entry.modelId).toBe("@cf/qwen/qwen3-30b-a3b-fp8");
    expect(entry.verifiedAt).toBe("2026-11-09T13:00:00.000Z");
    expect(entry.reviewAfter).toBe("2026-11-20T00:00:00.000Z");
    expect(entry.sourceDescription).toContain("4,625 / 30,475 Neurons");
    expect(entry.sourceDescription).toContain("Zero data retention: Yes");
    expect(entry.sourceDescription).toContain("planned deprecation on 2026-11-20");
    expect(entry.sourceDescription).toContain("has NOT been verified");
    expect(entry.sourceDescription).toContain("NOTHING in the current code selects this model");
  });

  it("pins the published Neurons rates for both catalogued models", () => {
    expect(ORIGIN_CLOUDFLARE_FREE_MODEL_NEURONS_PER_MILLION_TOKENS[ORIGIN_CLOUDFLARE_FREE_MODEL]).toEqual({ input: 9_091, output: 27_273 });
    expect(ORIGIN_CLOUDFLARE_FREE_MODEL_NEURONS_PER_MILLION_TOKENS[ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID]).toEqual({ input: 4_625, output: 30_475 });
  });

  it("selects the primary evidence inside its verification window", () => {
    const result = selectCurrentOriginCloudflareFreeModel(undefined, DURING_MS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.modelId).toBe(ORIGIN_CLOUDFLARE_FREE_MODEL);
  });

  it("selects each model by id, and the default selection stays on the primary model", () => {
    const primary = selectCurrentOriginCloudflareFreeModel(undefined, DURING_MS);
    expect(primary.ok).toBe(true);
    if (primary.ok) expect(primary.model.modelId).toBe(ORIGIN_CLOUDFLARE_FREE_MODEL);
    const light = selectCurrentOriginCloudflareFreeModelById(undefined, ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID, DURING_MS);
    expect(light.ok).toBe(true);
    if (light.ok) expect(light.model.modelId).toBe("@cf/qwen/qwen3-30b-a3b-fp8");
    const staleLight = selectCurrentOriginCloudflareFreeModelById(undefined, ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID, AFTER_ALL_REVIEW_MS);
    expect(staleLight).toMatchObject({ ok: false, code: "FREE_MODEL_EVIDENCE_STALE" });
  });

  it("never falls through to the light model when the primary evidence is stale", () => {
    const primaryStaleCatalog: OriginCloudflareFreeModelEvidence[] = DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG.map((entry) =>
      entry.modelId === ORIGIN_CLOUDFLARE_FREE_MODEL
        ? { ...entry, verifiedAt: "2026-11-01T00:00:00.000Z", reviewAfter: "2026-11-05T00:00:00.000Z" }
        : entry);
    expect(selectCurrentOriginCloudflareFreeModel(primaryStaleCatalog, DURING_MS))
      .toMatchObject({ ok: false, code: "FREE_MODEL_EVIDENCE_STALE" });
    const light = selectCurrentOriginCloudflareFreeModelById(primaryStaleCatalog, ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID, DURING_MS);
    expect(light.ok).toBe(true);
  });

  it("fails closed as evidence-stale after every review deadline", () => {
    const result = selectCurrentOriginCloudflareFreeModel(undefined, AFTER_ALL_REVIEW_MS);
    expect(result).toEqual({
      ok: false,
      code: "FREE_MODEL_EVIDENCE_STALE",
      message: expect.any(String),
    });
  });

  it("rejects a tampered catalog entry as invalid, for either selection", () => {
    const tampered: OriginCloudflareFreeModelEvidence[] = DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG.map((entry) =>
      entry.modelId === ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID
        ? { ...entry, sourceUrl: "https://example.com/not-cloudflare" }
        : entry);
    expect(selectCurrentOriginCloudflareFreeModel(tampered, DURING_MS))
      .toMatchObject({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" });
    expect(selectCurrentOriginCloudflareFreeModelById(tampered, ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID, DURING_MS))
      .toMatchObject({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" });
    const tamperedPrimary: OriginCloudflareFreeModelEvidence[] = [{
      ...DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG[0],
      sourceUrl: "https://example.com/not-cloudflare",
    }];
    expect(selectCurrentOriginCloudflareFreeModel(tamperedPrimary, DURING_MS))
      .toMatchObject({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" });
  });

  it("recognizes exactly the two catalog models as Cloudflare free model ids", () => {
    expect(isOriginCloudflareFreeModelId("@cf/google/gemma-4-26b-a4b-it")).toBe(true);
    expect(isOriginCloudflareFreeModelId("@cf/qwen/qwen3-30b-a3b-fp8")).toBe(true);
    expect(isOriginCloudflareFreeModelId("@cf/meta/llama-3.2-1b-instruct")).toBe(false);
    expect(isOriginCloudflareFreeModelId("@cf/ibm-granite/granite-4.0-h-micro")).toBe(false);
    expect(isOriginCloudflareFreeModelId("openai/gpt-oss-120b")).toBe(false);
    expect(isOriginCloudflareFreeModelId(undefined)).toBe(false);
  });
});
