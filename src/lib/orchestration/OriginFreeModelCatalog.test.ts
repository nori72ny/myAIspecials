import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
  selectCurrentOriginFreeModel,
  type OriginFreeModelEvidence,
} from "./OriginFreeModelCatalog";

const currentTime = Date.parse("2026-07-24T20:48:17.419Z");

describe("selectCurrentOriginFreeModel", () => {
  it("returns the official zero-cost free-model router", () => {
    const result = selectCurrentOriginFreeModel(DEFAULT_ORIGIN_FREE_MODEL_CATALOG, currentTime);

    expect(result).toEqual({
      ok: true,
      model: expect.objectContaining({
        modelId: "openrouter/free",
        providerId: "openrouter-free",
        sourceUrl: "https://openrouter.ai/docs/guides/routing/routers/free-router",
      }),
    });
  });

  it("rejects paid or unverified automatic model identifiers", () => {
    const invalidCatalog = [{
      ...DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0],
      modelId: "openrouter/auto",
    }] as unknown as readonly OriginFreeModelEvidence[];

    expect(selectCurrentOriginFreeModel(invalidCatalog, currentTime)).toEqual({
      ok: false,
      code: "FREE_MODEL_CATALOG_INVALID",
      message: "無料モデルの証拠カタログが正しくありません。",
    });
  });

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
      reviewAfter: "2026-07-18T00:00:00.000Z",
    }];
    expect(selectCurrentOriginFreeModel(invalidRange, currentTime)).toEqual(
      expect.objectContaining({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" }),
    );
  });

  it("keeps the official free router available after its scheduled review date", () => {
    expect(selectCurrentOriginFreeModel(
      DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
      Date.parse("2026-08-02T00:00:00.000Z"),
    )).toEqual({
      ok: true,
      model: expect.objectContaining({
        modelId: "openrouter/free",
      }),
    });
  });

  it("fails closed for a stale pinned free model", () => {
    const pinnedCatalog = [{
      ...DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0],
      modelId: "example/model:free",
      sourceUrl: "https://openrouter.ai/example/model:free",
    }] as const;

    expect(selectCurrentOriginFreeModel(
      pinnedCatalog,
      Date.parse("2026-08-02T00:00:00.000Z"),
    )).toEqual({
      ok: false,
      code: "FREE_MODEL_EVIDENCE_STALE",
      message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。",
    });
  });
});
