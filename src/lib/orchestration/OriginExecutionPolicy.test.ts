import { describe, expect, it } from "vitest";
import { buildOriginExecutionPlan, ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL, ORIGIN_GROQ_FREE_MODEL, ORIGIN_OPENROUTER_FREE_MODEL } from "./OriginExecutionPolicy";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "./OriginFreeModelCatalog";

const request = { goal: "認証処理の安全性を確認してください" };
const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedNow = Date.parse(verifiedEvidence.verifiedAt) + 1;

describe("buildOriginExecutionPlan", () => {
  it("selects Gemini for implementation/security when Gemini is configured", () => {
    const result = buildOriginExecutionPlan({ goal: "認証処理を実装してください", requiresCodeChanges: true }, { openRouterConfigured: true, googleAiStudioConfigured: true, groqConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("google-ai-studio-free");
    expect(result.plan.modelId).toBe(ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL);
    expect(result.plan.freeOnly).toBe(true);
    expect(result.plan.estimatedCostUsd).toBe(0);
    expect(result.plan.providerDataPolicy.dataCollection).toBe("deny");
  });

  it("selects OpenRouter for research when it is configured", () => {
    const result = buildOriginExecutionPlan({ goal: "最新情報を調査して比較してください", requiresFreshResearch: true }, { openRouterConfigured: true, googleAiStudioConfigured: true, groqConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("openrouter-free");
    expect(result.plan.modelId).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
    expect(result.plan.modelEvidence.sourceUrl).toContain("openrouter.ai");
  });

  it("falls back to Groq when it is the only configured provider", () => {
    const result = buildOriginExecutionPlan({ goal: "短い回答をお願いします" }, { openRouterConfigured: false, googleAiStudioConfigured: false, groqConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("groq-free");
    expect(result.plan.modelId).toBe(ORIGIN_GROQ_FREE_MODEL);
    expect(result.plan.estimatedCostUsd).toBe(0);
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
    expect(buildOriginExecutionPlan(request, { openRouterConfigured: true }, { maxEstimatedCostUsd: 0, timeoutMs: 0 }, { nowMs: verifiedNow })).toEqual(expect.objectContaining({ ok: false, code: "INVALID_EXECUTION_POLICY" }));
  });
});
