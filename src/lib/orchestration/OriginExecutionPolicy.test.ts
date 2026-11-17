import { describe, expect, it } from "vitest";
import { buildOriginExecutionPlan, ORIGIN_OPENROUTER_FREE_MODEL } from "./OriginExecutionPolicy";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG, type OriginFreeModelEvidence } from "./OriginFreeModelCatalog";

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

  it("fails closed when OpenRouter is not configured even if legacy providers are configured", () => {
    const result = buildOriginExecutionPlan({ goal: "短い回答をお願いします" }, { openRouterConfigured: false, googleAiStudioConfigured: true, groqConfigured: true }, undefined, { nowMs: verifiedNow });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "FREE_PROVIDER_NOT_CONFIGURED" }));
  });

  it("fails closed when no explicitly verified free provider is configured", () => {
    expect(buildOriginExecutionPlan(request, { openRouterConfigured: false }, undefined, { nowMs: verifiedNow })).toEqual({ ok: false, code: "FREE_PROVIDER_NOT_CONFIGURED", message: "明示的に無料と確認できるOpenRouter無料モデルが設定されていません。" });
  });

  it("still builds the plan after the stopped route's model evidence expires (PKG-4 PR-2)", () => {
    // The OpenRouter route is dispositioned stopped and never executed, so
    // its evidence freshness no longer gates plan building: the plan is the
    // shared shell for the Cloudflare/Groq failover routes, which verify
    // their own evidence. The stale entry is carried as the evidence record.
    const result = buildOriginExecutionPlan(request, { openRouterConfigured: true }, undefined, { nowMs: Date.parse(verifiedEvidence.reviewAfter) + 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("openrouter-free");
    expect(result.plan.modelId).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
    expect(result.plan.modelEvidence.verifiedAt).toBe(verifiedEvidence.verifiedAt);
    expect(result.plan.modelEvidence.reviewAfter).toBe(verifiedEvidence.reviewAfter);
  });

  it("fails closed on a malformed OpenRouter catalog even under the stopped disposition", () => {
    const malformed = [{ ...verifiedEvidence, modelId: "someone/else:free" }] as unknown as readonly OriginFreeModelEvidence[];
    const result = buildOriginExecutionPlan(request, { openRouterConfigured: true }, undefined, { nowMs: verifiedNow, freeModelCatalog: malformed });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" }));
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
