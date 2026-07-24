import { describe, expect, it } from "vitest";
import {
  buildOriginExecutionPlan,
  ORIGIN_OPENROUTER_FREE_MODEL,
} from "./OriginExecutionPolicy";

const request = {
  goal: "認証処理の安全性を確認してください",
};

const verifiedNow = Date.parse("2026-07-25T12:00:00.000Z");

describe("buildOriginExecutionPlan", () => {
  it("selects the current evidence-backed OpenRouter free router with data collection denied", () => {
    const result = buildOriginExecutionPlan(
      request,
      { openRouterConfigured: true },
      undefined,
      { nowMs: verifiedNow },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.modelId).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
    expect(result.plan.modelId).toBe("openrouter/free");
    expect(result.plan.freeOnly).toBe(true);
    expect(result.plan.estimatedCostUsd).toBe(0);
    expect(result.plan.requiresOwnerApproval).toBe(false);
    expect(result.plan.taskType).toBe("security");
    expect(result.plan.reason).toContain("品質優位性の主張ではありません");
    expect(result.plan.providerDataPolicy).toEqual({
      allowProviderFallbacks: false,
      dataCollection: "deny",
      requireZeroDataRetention: false,
    });
    expect(result.plan.modelEvidence).toEqual(expect.objectContaining({
      verifiedAt: "2026-07-25T00:00:00.000Z",
      reviewAfter: "2026-08-01T23:59:59.999Z",
      sourceUrl: expect.stringContaining("openrouter.ai"),
    }));
  });

  it("fails closed when no explicitly free provider is configured", () => {
    const result = buildOriginExecutionPlan(
      request,
      { openRouterConfigured: false },
      undefined,
      { nowMs: verifiedNow },
    );

    expect(result).toEqual({
      ok: false,
      code: "FREE_PROVIDER_NOT_CONFIGURED",
      message: "明示的に無料と確認できるAIプロバイダーが設定されていません。",
    });
  });

  it("fails closed after the free-model evidence review date", () => {
    const result = buildOriginExecutionPlan(
      request,
      { openRouterConfigured: true },
      undefined,
      { nowMs: Date.parse("2026-08-19T00:00:00.000Z") },
    );

    expect(result).toEqual({
      ok: false,
      code: "FREE_MODEL_EVIDENCE_STALE",
      message: "無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。",
    });
  });

  it("rejects any nonzero cost ceiling and invalid timeout values", () => {
    for (const maxEstimatedCostUsd of [-1, 0.01, 1]) {
      expect(buildOriginExecutionPlan(
        request,
        { openRouterConfigured: true },
        { maxEstimatedCostUsd },
        { nowMs: verifiedNow },
      )).toEqual(expect.objectContaining({ ok: false, code: "INVALID_EXECUTION_POLICY" }));
    }

    expect(buildOriginExecutionPlan(
      request,
      { openRouterConfigured: true },
      { maxEstimatedCostUsd: 0, timeoutMs: 0 },
      { nowMs: verifiedNow },
    )).toEqual(expect.objectContaining({ ok: false, code: "INVALID_EXECUTION_POLICY" }));
  });
});
