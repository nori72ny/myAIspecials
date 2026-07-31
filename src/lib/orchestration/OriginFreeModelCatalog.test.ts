import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
  selectCurrentOriginFreeModel,
  type OriginFreeModelEvidence,
} from "./OriginFreeModelCatalog";

const currentTime = Date.parse("2026-08-01T12:00:00.000Z");

describe("selectCurrentOriginFreeModel", () => {
  it("returns the evidence-backed fixed zero-cost model", () => {
    const result = selectCurrentOriginFreeModel(DEFAULT_ORIGIN_FREE_MODEL_CATALOG, currentTime);

    expect(result).toEqual({
      ok: true,
      model: expect.objectContaining({
        modelId: "inclusionai/ling-3.0-flash:free",
        providerId: "openrouter-free",
        sourceUrl: "https://openrouter.ai/inclusionai/ling-3.0-flash:free",
      }),
    });
  });

  it.each([
    "openrouter/auto",
    "openrouter/free",
    "google/gemma-3-27b-it:free",
  ])(
    "rejects automatic model identifier %s",
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
      reviewAfter: "2026-07-31T00:00:00.000Z",
    }];
    expect(selectCurrentOriginFreeModel(invalidRange, currentTime)).toEqual(
      expect.objectContaining({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" }),
    );
  });

  it("fails closed after the fixed model evidence expires", () => {
    expect(selectCurrentOriginFreeModel(
      DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
      Date.parse("2026-08-09T00:00:00.000Z"),
    )).toEqual({
      ok: false,
      code: "FREE_MODEL_EVIDENCE_STALE",
      message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。",
    });
  });
});
