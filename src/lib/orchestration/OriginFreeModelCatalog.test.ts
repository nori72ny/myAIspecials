import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
  selectCurrentOriginFreeModel,
  type OriginFreeModelEvidence,
} from "./OriginFreeModelCatalog";

const currentTime = Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].verifiedAt) + 1;

describe("selectCurrentOriginFreeModel", () => {
  it("returns the evidence-backed fixed zero-cost model", () => {
    const result = selectCurrentOriginFreeModel(DEFAULT_ORIGIN_FREE_MODEL_CATALOG, currentTime);

    expect(result).toEqual({
      ok: true,
      model: expect.objectContaining({
        modelId: "google/gemma-4-31b-it:free",
        providerId: "openrouter-free",
        sourceUrl: "https://openrouter.ai/api/v1/models",
      }),
    });
  });

  it.each([
    "inclusionai/ling-3.0-flash:free",
    "openrouter/auto",
    "openrouter/free",
    "google/gemma-3-27b-it:free",
  ])(
    "rejects retired, automatic, or otherwise non-fixed model identifier %s",
    (modelId) => {
      const invalidCatalog = [{
        ...DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0],
        modelId,
      }] as unknown as readonly OriginFreeModelEvidence[];

      expect(selectCurrentOriginFreeModel(invalidCatalog, currentTime)).toEqual({
        ok: false,
        code: "FREE_MODEL_CATALOG_INVALID",
        message: "無料モデルの証拠カタログが正しくありません。",
      });
    },
  );
  it("rejects invalid evidence sources and time ranges", () => {
    const invalidSource = [{
      ...DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0],
      sourceUrl: "https://example.com/unverified-model",
    }];
    expect(selectCurrentOriginFreeModel(invalidSource, currentTime)).toEqual(
      expect.objectContaining({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" }),
    );

    const invalidRange = [{
      ...DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0],
      reviewAfter: "2026-08-10T00:00:00.000Z",
    }];
    expect(selectCurrentOriginFreeModel(invalidRange, currentTime)).toEqual(
      expect.objectContaining({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" }),
    );
  });

  it("fails closed after the fixed model evidence expires", () => {
    expect(selectCurrentOriginFreeModel(
      DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
      Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].reviewAfter) + 1,
    )).toEqual({
      ok: false,
      code: "FREE_MODEL_EVIDENCE_STALE",
      message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。",
    });
  });

  it("keeps refreshed evidence valid through its exact deadline and stops one millisecond later", () => {
    const deadline = Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].reviewAfter);
    expect(selectCurrentOriginFreeModel(DEFAULT_ORIGIN_FREE_MODEL_CATALOG, deadline)).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(selectCurrentOriginFreeModel(DEFAULT_ORIGIN_FREE_MODEL_CATALOG, deadline + 1)).toEqual(
      expect.objectContaining({ ok: false, code: "FREE_MODEL_EVIDENCE_STALE" }),
    );
  });
});
