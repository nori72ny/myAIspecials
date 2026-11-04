import { describe, expect, it } from "vitest";
import { buildOriginExecutionPlan, ORIGIN_OPENROUTER_FREE_MODEL, ORIGIN_QUALITY_OBJECTIVE, ORIGIN_QUALITY_SELECTION_POLICY } from "./OriginExecutionPolicy";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "./OriginFreeModelCatalog";

const request = { goal: "認証処理の安全性を確認してください" };
const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedNow = Date.parse(verifiedEvidence.verifiedAt) + 1;

describe("buildOriginExecutionPlan", () => {
  it("always selects the verified OpenRouter free route when it is configured", () => {
    const result = buildOriginExecutionPlan({ goal: "認証処理を実装してください", requiresCodeChanges: true }, { openRouterConfigured: true, googleAiStudioConfigured: true, groqConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("openrouter-free");
    expect(result.plan.modelId).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
    expect(result.plan.freeOnly).toBe(true);
    expect(result.plan.estimatedCostUsd).toBe(0);
    expect(result.plan.capabilityDecision).toEqual({ capability: "coding", reason: "keyword", confidence: "high" });
    expect(result.plan.providerDataPolicy).toEqual({ allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true });
    expect(result.plan.qualityObjective).toBe(ORIGIN_QUALITY_OBJECTIVE);
    expect(result.plan.qualitySelectionPolicy).toBe(ORIGIN_QUALITY_SELECTION_POLICY);
    expect(result.plan.qualityEvidenceStatus).toBe("audited-route-no-superiority-claim");
    expect(result.plan.reason).toContain("費用0円を絶対条件");
    expect(result.plan.reason).toContain("比較評価・料金・プライバシー証拠");
    expect(result.plan.modelEvidence.sourceUrl).toContain("openrouter.ai");
  });

  it("uses OpenRouter for current-information and research tasks", () => {
    const result = buildOriginExecutionPlan({ goal: "最新情報を調査して比較してください", requiresFreshResearch: true }, { openRouterConfigured: true, googleAiStudioConfigured: true, groqConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("openrouter-free");
    expect(result.plan.modelId).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
    expect(result.plan.taskType).toBe("current-information");
    expect(result.plan.capabilityDecision).toEqual({ capability: "research", reason: "keyword", confidence: "high" });
  });

  it("honors an explicit capability without changing the fixed free provider boundary", () => {
    const result = buildOriginExecutionPlan({ goal: "この内容を整理してください", capability: "analysis" }, { openRouterConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.capabilityDecision).toEqual({ capability: "analysis", reason: "explicit", confidence: "high" });
    expect(result.plan.providerId).toBe("openrouter-free");
    expect(result.plan.modelId).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
    expect(result.plan.estimatedCostUsd).toBe(0);
  });

  it("defaults unknown requests to answer capability while preserving deterministic task classification", () => {
    const result = buildOriginExecutionPlan({ goal: "こんにちは" }, { openRouterConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.capabilityDecision).toEqual({ capability: "answer", reason: "default", confidence: "low" });
    expect(result.plan.taskType).toBe("review");
  });

  it("does not claim a quality winner without comparative evidence", () => {
    const result = buildOriginExecutionPlan({ goal: "最高品質の回答を作ってください" }, { openRouterConfigured: true, googleAiStudioConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.qualityObjective).toBe("max-quality-within-verified-zero-cost");
    expect(result.plan.qualityEvidenceStatus).toBe("audited-route-no-superiority-claim");
    expect(result.plan.reason).toContain("優越性を未証明のまま主張せず");
    expect(result.plan.providerId).toBe("openrouter-free");
    expect(result.plan.estimatedCostUsd).toBe(0);
  });

  it("fails closed when OpenRouter is not configured even if legacy providers are configured", () => {
    const result = buildOriginExecutionPlan({ goal: "短い回答をお願いします" }, { openRouterConfigured: false, googleAiStudioConfigured: true, groqConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "FREE_PROVIDER_NOT_CONFIGURED" }));
  });

  it("fails closed when no explicitly verified free provider is configured", () => {
    expect(buildOriginExecutionPlan(request, { openRouterConfigured: false }, undefined, { nowMs: verifiedNow })).toEqual({ ok: false, code: "FREE_PROVIDER_NOT_CONFIGURED", message: "明示的に無料と確認できるOpenRouter無料モデルが設定されていません。" });
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
