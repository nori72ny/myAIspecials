import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG,
  isOriginCloudflareVoiceModelId,
  ORIGIN_CLOUDFLARE_VOICE_MODEL,
  ORIGIN_CLOUDFLARE_VOICE_MODEL_IDS,
  ORIGIN_CLOUDFLARE_VOICE_MODEL_NEURONS_PER_AUDIO_MINUTE,
  selectCurrentOriginCloudflareVoiceModel,
  selectCurrentOriginCloudflareVoiceModelById,
  type OriginCloudflareVoiceModelEvidence,
} from "./OriginCloudflareVoiceModelCatalog";

const DURING_MS = Date.parse("2026-11-20T12:00:00.000Z");
const BEFORE_MS = Date.parse("2026-11-01T00:00:00.000Z");
const AFTER_REVIEW_MS = Date.parse("2026-12-13T00:00:00.000Z");

describe("Cloudflare voice model evidence catalog", () => {
  it("pins the verified transcription model and the 2026-12-12 review deadline", () => {
    const entry = DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG[0];
    expect(entry.providerId).toBe("cloudflare-workers-ai-free");
    expect(entry.modelId).toBe(ORIGIN_CLOUDFLARE_VOICE_MODEL);
    expect(entry.modelId).toBe("@cf/openai/whisper-large-v3-turbo");
    expect(entry.verifiedAt).toBe("2026-11-12T00:00:00.000Z");
    expect(entry.reviewAfter).toBe("2026-12-12T00:00:00.000Z");
    expect(entry.sourceUrl).toBe("https://developers.cloudflare.com/workers-ai/platform/data-usage/");
  });

  it("catalogues exactly the turbo transcription model, nothing else", () => {
    expect(DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG.map((entry) => entry.modelId)).toEqual([
      "@cf/openai/whisper-large-v3-turbo",
    ]);
    expect(ORIGIN_CLOUDFLARE_VOICE_MODEL_IDS).toEqual([
      "@cf/openai/whisper-large-v3-turbo",
    ]);
  });

  it("records the pricing, free-allocation and platform ZDR evidence", () => {
    const entry = DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG[0];
    expect(entry.sourceDescription).toContain("46.63 Neurons per audio minute");
    expect(entry.sourceDescription).toContain("10,000 Neurons per day");
    expect(entry.sourceDescription).toContain("text prompts, images, and audio");
    expect(entry.sourceDescription).toContain("zero data retention for standard inference requests");
    expect(entry.sourceDescription).toContain("does not use Customer Content processed by Workers AI to train AI models");
  });

  it("records honestly that the per-model ZDR tag could not be confirmed", () => {
    const entry = DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG[0];
    expect(entry.sourceDescription).toContain("could NOT be confirmed");
    expect(entry.sourceDescription).toContain("NOTHING in the current code selects or calls this model");
  });

  it("pins the published Neurons rate per audio minute", () => {
    expect(ORIGIN_CLOUDFLARE_VOICE_MODEL_NEURONS_PER_AUDIO_MINUTE[ORIGIN_CLOUDFLARE_VOICE_MODEL]).toBe(46.63);
  });

  it("selects the evidence inside its verification window", () => {
    const result = selectCurrentOriginCloudflareVoiceModel(undefined, DURING_MS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.modelId).toBe(ORIGIN_CLOUDFLARE_VOICE_MODEL);
    const byId = selectCurrentOriginCloudflareVoiceModelById(undefined, ORIGIN_CLOUDFLARE_VOICE_MODEL, DURING_MS);
    expect(byId.ok).toBe(true);
    if (byId.ok) expect(byId.model.modelId).toBe("@cf/openai/whisper-large-v3-turbo");
  });

  it("fails closed as evidence-stale after the review deadline", () => {
    const result = selectCurrentOriginCloudflareVoiceModel(undefined, AFTER_REVIEW_MS);
    expect(result).toEqual({
      ok: false,
      code: "VOICE_MODEL_EVIDENCE_STALE",
      message: expect.any(String),
    });
    expect(selectCurrentOriginCloudflareVoiceModelById(undefined, ORIGIN_CLOUDFLARE_VOICE_MODEL, AFTER_REVIEW_MS))
      .toMatchObject({ ok: false, code: "VOICE_MODEL_EVIDENCE_STALE" });
  });

  it("fails closed as evidence-stale before the verification window opens", () => {
    expect(selectCurrentOriginCloudflareVoiceModel(undefined, BEFORE_MS))
      .toMatchObject({ ok: false, code: "VOICE_MODEL_EVIDENCE_STALE" });
  });

  it("rejects a tampered catalog entry as invalid", () => {
    const tampered: OriginCloudflareVoiceModelEvidence[] = DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG.map((entry) => ({
      ...entry,
      sourceUrl: "https://example.com/not-cloudflare",
    }));
    expect(selectCurrentOriginCloudflareVoiceModel(tampered, DURING_MS))
      .toMatchObject({ ok: false, code: "VOICE_MODEL_CATALOG_INVALID" });
    expect(selectCurrentOriginCloudflareVoiceModelById(tampered, ORIGIN_CLOUDFLARE_VOICE_MODEL, DURING_MS))
      .toMatchObject({ ok: false, code: "VOICE_MODEL_CATALOG_INVALID" });
  });

  it("rejects an empty or inverted-window catalog as invalid", () => {
    expect(selectCurrentOriginCloudflareVoiceModel([], DURING_MS))
      .toMatchObject({ ok: false, code: "VOICE_MODEL_CATALOG_INVALID" });
    const inverted: OriginCloudflareVoiceModelEvidence[] = DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG.map((entry) => ({
      ...entry,
      verifiedAt: "2026-12-12T00:00:00.000Z",
      reviewAfter: "2026-11-12T00:00:00.000Z",
    }));
    expect(selectCurrentOriginCloudflareVoiceModel(inverted, DURING_MS))
      .toMatchObject({ ok: false, code: "VOICE_MODEL_CATALOG_INVALID" });
  });

  it("recognizes exactly the catalogued model as a Cloudflare voice model id", () => {
    expect(isOriginCloudflareVoiceModelId("@cf/openai/whisper-large-v3-turbo")).toBe(true);
    expect(isOriginCloudflareVoiceModelId("@cf/openai/whisper")).toBe(false);
    expect(isOriginCloudflareVoiceModelId("@cf/openai/whisper-tiny-en")).toBe(false);
    expect(isOriginCloudflareVoiceModelId("@cf/google/gemma-4-26b-a4b-it")).toBe(false);
    expect(isOriginCloudflareVoiceModelId(undefined)).toBe(false);
  });
});
