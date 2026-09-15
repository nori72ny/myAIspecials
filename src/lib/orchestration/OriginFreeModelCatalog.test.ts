import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
  ORIGIN_CODING_OPENROUTER_FREE_MODEL,
  selectCurrentOriginFreeModel,
  type OriginFreeModelEvidence,
} from "./OriginFreeModelCatalog";

const currentTime = Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].verifiedAt) + 1;
const codingTime = Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[1].verifiedAt) + 1;

describe("selectCurrentOriginFreeModel", () => {
  it("returns the evidence-backed fixed zero-cost default model", () => {
    const result = selectCurrentOriginFreeModel(DEFAULT_ORIGIN_FREE_MODEL_CATALOG, currentTime);

    expect(result).toEqual({
      ok: true,
      model: expect.objectContaining({
        modelId: "inclusionai/ling-3.0-flash-sante:free",
        providerId: "openrouter-free",
        sourceUrl: "https://openrouter.ai/inclusionai/ling-3.0-flash-sante:free",
      }),
    });
  });

  it("returns the dedicated coding model only when it is explicitly requested", () => {
    const result = selectCurrentOriginFreeModel(
      DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
      codingTime,
      ORIGIN_CODING_OPENROUTER_FREE_MODEL,
    );
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
    "nex-agi/nex-n2.5-mini:free",
    "openrouter/auto",
    "openrouter/free",
    "google/gemma-3-27b-it:free",
  ])(
    "rejects retired, automatic, or otherwise non-fixed model identifier %s",
    (modelId) => {
      const invalidCatalog = [{
        ...DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0],
        modelId,
      }, DEFAULT_ORIGIN_FREE_MODEL_CATALOG[1]] as unknown as readonly OriginFreeModelEvidence[];

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
    }, DEFAULT_ORIGIN_FREE_MODEL_CATALOG[1]];
    expect(selectCurrentOriginFreeModel(invalidSource, currentTime)).toEqual(
      expect.objectContaining({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" }),
    );

    const invalidRange = [{
      ...DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0],
      reviewAfter: "2026-08-10T00:00:00.000Z",
    }, DEFAULT_ORIGIN_FREE_MODEL_CATALOG[1]];
    expect(selectCurrentOriginFreeModel(invalidRange, currentTime)).toEqual(
      expect.objectContaining({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" }),
    );
  });

  it("fails closed after the selected model evidence expires without falling back", () => {
    expect(selectCurrentOriginFreeModel(
      DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
      Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].reviewAfter) + 1,
    )).toEqual({
      ok: false,
      code: "FREE_MODEL_EVIDENCE_STALE",
      message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。",
    });

    expect(selectCurrentOriginFreeModel(
      DEFAULT_ORIGIN_FREE_MODEL_CATALOG,
      Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[1].reviewAfter) + 1,
      ORIGIN_CODING_OPENROUTER_FREE_MODEL,
    )).toEqual(expect.objectContaining({ ok: false, code: "FREE_MODEL_EVIDENCE_STALE" }));
  });

  it("keeps default evidence valid through its exact deadline and stops one millisecond later", () => {
    const deadline = Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].reviewAfter);
    expect(selectCurrentOriginFreeModel(DEFAULT_ORIGIN_FREE_MODEL_CATALOG, deadline)).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(selectCurrentOriginFreeModel(DEFAULT_ORIGIN_FREE_MODEL_CATALOG, deadline + 1)).toEqual(
      expect.objectContaining({ ok: false, code: "FREE_MODEL_EVIDENCE_STALE" }),
    );
  });
});
