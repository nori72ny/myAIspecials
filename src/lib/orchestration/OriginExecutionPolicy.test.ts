import { describe, expect, it } from "vitest";
import { buildOriginExecutionPlan, ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL, ORIGIN_GROQ_FREE_MODEL, ORIGIN_OPENROUTER_FREE_MODEL } from "./OriginExecutionPolicy";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "./OriginFreeModelCatalog";

const request = { goal: "認証処理の安全性を確認してください" };
const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedNow = Date.parse(verifiedEvidence.verifiedAt) + 1;
const providerEvidence = {
  "google-ai-studio-free": {
    providerId: "google-ai-studio-free" as const,
    verifiedAt: verifiedEvidence.verifiedAt,
    reviewAfter: verifiedEvidence.reviewAfter,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  "groq-free": {
    providerId: "groq-free" as const,
    verifiedAt: verifiedEvidence.verifiedAt,
    reviewAfter: verifiedEvidence.reviewAfter,
    sourceUrl: "https://console.groq.com/docs/your-data",
  },
} as const;

describe("buildOriginExecutionPlan", () => {
  it("selects Gemini for implementation/security when Gemini is configured and its own evidence is supplied", () => {
    const result = buildOriginExecutionPlan({ goal: "認証処理を実装してください", requiresCodeChanges: true }, { openRouterConfigured: true, googleAiStudioConfigured: true, groqConfigured: true }, undefined, { nowMs: verifiedNow, providerEvidence });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("google-ai-studio-free");
    expect(result.plan.modelId).toBe(ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL);
    expect(result.plan.freeOnly).toBe(true);
    expect(result.plan.estimatedCostUsd).toBe(0);
    expect(result.plan.providerDataPolicy.dataCollection).toBe("deny");
    expect(result.plan.modelEvidence.sourceUrl).toContain("ai.google.dev");
  });

  it("selects OpenRouter for research when it is configured", () => {
    const result = buildOriginExecutionPlan({ goal: "最新情報を調査して比較してください", requiresFreshResearch: true }, { openRouterConfigured: true, googleAiStudioConfigured: true, groqConfigured: true }, undefined, { nowMs: verifiedNow, providerEvidence });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("openrouter-free");
    expect(result.plan.modelId).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
    expect(result.plan.modelEvidence.sourceUrl).toContain("openrouter.ai");
    expect(result.plan.modelEvidence.providerId).toBe("openrouter-free");
  });

  it("selects Groq when it is the only configured provider and its own evidence is supplied", () => {
    const result = buildOriginExecutionPlan({ goal: "短い回答をお願いします" }, { openRouterConfigured: false, googleAiStudioConfigured: false, groqConfigured: true }, undefined, { nowMs: verifiedNow, providerEvidence });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("groq-free");
    expect(result.plan.modelId).toBe(ORIGIN_GROQ_FREE_MODEL);
    expect(result.plan.estimatedCostUsd).toBe(0);
    expect(result.plan.modelEvidence.sourceUrl).toContain("groq.com");
    expect(result.plan.modelEvidence.providerId).toBe("groq-free");
  });

  it("fails closed when a non-OpenRouter provider has no provider-specific evidence", () => {
    const result = buildOriginExecutionPlan({ goal: "短い回答をお願いします" }, { openRouterConfigured: false, googleAiStudioConfigured: false, groqConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "FREE_MODEL_EVIDENCE_STALE" }));
  });

  it("fails closed when provider evidence is from a different provider", () => {
    const mismatched = {
      "groq-free": {
        providerId: "google-ai-studio-free" as const,
        verifiedAt: verifiedEvidence.verifiedAt,
        reviewAfter: verifiedEvidence.reviewAfter,
        sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
      },
    } as const;
    const result = buildOriginExecutionPlan({ goal: "短い回答をお願いします" }, { openRouterConfigured: false, googleAiStudioConfigured: false, groqConfigured: true }, undefined, { nowMs: verifiedNow, providerEvidence: mismatched });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" }));
  });

  it("fails closed when no explicitly free provider is configured", () => {
    expect(buildOriginExecutionPlan(request, { openRouterConfigured: false }, undefined, { nowMs: verifiedNow })).toEqual({ ok: false, code: "FREE_PROVIDER_NOT_CONFIGURED", message: "明示的に無料と確認できるAIプロバイダーが設定されていません。" });
  });

  it("fails closed after the fixed OpenRouter model evidence expires", () => {
    const result = buildOriginExecutionPlan(request, { openRouterConfigured: true }, undefined, { nowMs: Date.parse(verifiedEvidence.reviewAfter) + 1 });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "FREE_MODEL_EVIDENCE_STALE" }));
  });

  it("keeps the server reliability timeout bounded and rejects invalid cost/timeout policies", () => {
    const defaultResult = buildOriginExecutionPlan(request, { openRouterConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(defaultResult.ok).toBe(true);
    if (defaultResult.ok) expect(defaultResult.plan.timeoutMs).toBe(20_000);

    const explicitLongResult = buildOriginExecutionPlan(request, { openRouterConfigured: true }, { maxEstimatedCostUsd: 0, timeoutMs: 120_000 }, { nowMs: verifiedNow });
    expect(explicitLongResult.ok).toBe(true);
    if (explicitLongResult.ok) expect(explicitLongResult.plan.timeoutMs).toBe(20_000);

    for (const maxEstimatedCostUsd of [-1, 0.01, 1]) {
      expect(buildOriginExecutionPlan(request, { openRouterConfigured: true }, { maxEstimatedCostUsd }, { nowMs: verifiedNow })).toEqual(expect.objectContaining({ ok: false, code: "INVALID_EXECUTION_POLICY" }));
    }
    expect(buildOriginExecutionPlan(request, { openRouterConfigured: true }, { maxEstimatedCostUsd: 0, timeoutMs: 0 }, undefined)).toEqual(expect.objectContaining({ ok: false, code: "INVALID_EXECUTION_POLICY" }));
  });
});
