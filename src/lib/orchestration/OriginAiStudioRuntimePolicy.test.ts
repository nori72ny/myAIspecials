import { describe, expect, it } from "vitest";

import {
  buildOriginAiStudioRuntimePlan,
  DEFAULT_ORIGIN_AI_STUDIO_FREE_MODEL_CATALOG,
  isOriginAiStudioRuntimeEnabled,
  ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT,
  type OriginAiStudioFreeModelEvidence,
} from "./OriginAiStudioRuntimePolicy";

const verifiedNow = Date.parse("2030-01-15T00:00:00.000Z");

const syntheticFreeEvidence: OriginAiStudioFreeModelEvidence = {
  providerId: "google-ai-studio-free",
  providerLabel: "ORIGIN AI Studio 無料AI",
  modelId: "gemini-9.9-flash",
  billingTier: "free",
  inputCostUsd: 0,
  outputCostUsd: 0,
  apiFamily: "interactions",
  store: false,
  verifiedAt: "2030-01-01T00:00:00.000Z",
  reviewAfter: "2030-01-31T23:59:59.999Z",
  pricingSourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  modelSourceUrl: "https://ai.google.dev/gemini-api/docs/models",
};

const enabledAvailability = {
  enabled: true,
  apiKeyConfigured: true,
  ownerApprovedLiveExecution: true,
};

describe("OriginAiStudioRuntimePolicy", () => {
  it("keeps the runtime disabled unless the dedicated flag is exactly true", () => {
    expect(isOriginAiStudioRuntimeEnabled({})).toBe(false);
    expect(isOriginAiStudioRuntimeEnabled({ ORIGIN_AI_STUDIO_RUNTIME_ENABLED: "false" })).toBe(false);
    expect(isOriginAiStudioRuntimeEnabled({ ORIGIN_AI_STUDIO_RUNTIME_ENABLED: "TRUE" })).toBe(false);
    expect(isOriginAiStudioRuntimeEnabled({ ORIGIN_AI_STUDIO_RUNTIME_ENABLED: "true" })).toBe(true);

    expect(buildOriginAiStudioRuntimePlan({
      ...enabledAvailability,
      enabled: false,
    })).toEqual({
      ok: false,
      code: "AI_STUDIO_RUNTIME_DISABLED",
      message: "AI Studioランタイムは既定で無効です。",
    });
  });

  it("ships with an empty production catalog so enabling the flag alone cannot execute", () => {
    expect(DEFAULT_ORIGIN_AI_STUDIO_FREE_MODEL_CATALOG).toEqual([]);

    expect(buildOriginAiStudioRuntimePlan(enabledAvailability, {
      nowMs: verifiedNow,
    })).toEqual({
      ok: false,
      code: "AI_STUDIO_FREE_CATALOG_INVALID",
      message: "AI Studio無料モデルの証拠カタログが未設定または不正なため、実行を停止しました。",
    });
  });

  it("requires separate owner approval and server-side credential configuration", () => {
    expect(buildOriginAiStudioRuntimePlan({
      ...enabledAvailability,
      ownerApprovedLiveExecution: false,
    }, {
      catalog: [syntheticFreeEvidence],
      nowMs: verifiedNow,
    })).toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_OWNER_APPROVAL_REQUIRED",
    }));

    expect(buildOriginAiStudioRuntimePlan({
      ...enabledAvailability,
      apiKeyConfigured: false,
    }, {
      catalog: [syntheticFreeEvidence],
      nowMs: verifiedNow,
    })).toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_API_KEY_NOT_CONFIGURED",
    }));
  });

  it("builds only a zero-cost stateless plan with no retry, fallback, or automatic model selection", () => {
    const result = buildOriginAiStudioRuntimePlan(enabledAvailability, {
      catalog: [syntheticFreeEvidence],
      nowMs: verifiedNow,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan).toEqual({
      providerId: "google-ai-studio-free",
      providerLabel: "ORIGIN AI Studio 無料AI",
      modelId: "gemini-9.9-flash",
      endpoint: ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT,
      freeOnly: true,
      maxEstimatedCostUsd: 0,
      requiresOwnerApproval: false,
      requestPolicy: {
        store: false,
        allowAutomaticRetries: false,
        allowProviderFallbacks: false,
        allowAutomaticModelSelection: false,
      },
      evidence: {
        billingTier: "free",
        verifiedAt: "2030-01-01T00:00:00.000Z",
        reviewAfter: "2030-01-31T23:59:59.999Z",
        pricingSourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
        modelSourceUrl: "https://ai.google.dev/gemini-api/docs/models",
      },
    });
  });

  it.each([
    ["paid tier", { ...syntheticFreeEvidence, billingTier: "paid" }],
    ["nonzero input cost", { ...syntheticFreeEvidence, inputCostUsd: 0.01 }],
    ["nonzero output cost", { ...syntheticFreeEvidence, outputCostUsd: 0.01 }],
    ["stored interaction", { ...syntheticFreeEvidence, store: true }],
    ["unsupported API family", { ...syntheticFreeEvidence, apiFamily: "generateContent" }],
    ["non-official pricing source", { ...syntheticFreeEvidence, pricingSourceUrl: "https://example.test/pricing" }],
    ["preview model", { ...syntheticFreeEvidence, modelId: "gemini-9.9-flash-preview" }],
    ["experimental model", { ...syntheticFreeEvidence, modelId: "gemini-9.9-flash-exp" }],
    ["latest alias", { ...syntheticFreeEvidence, modelId: "gemini-flash-latest" }],
  ])("rejects invalid evidence: %s", (_label, evidence) => {
    expect(buildOriginAiStudioRuntimePlan(enabledAvailability, {
      catalog: [evidence],
      nowMs: verifiedNow,
    })).toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_FREE_CATALOG_INVALID",
    }));
  });

  it("fails closed when otherwise valid evidence is not currently effective", () => {
    expect(buildOriginAiStudioRuntimePlan(enabledAvailability, {
      catalog: [syntheticFreeEvidence],
      nowMs: Date.parse("2030-02-01T00:00:00.000Z"),
    })).toEqual({
      ok: false,
      code: "AI_STUDIO_FREE_EVIDENCE_STALE",
      message: "AI Studio無料モデルの証拠が期限切れのため、再確認まで実行を停止しました。",
    });
  });
});
