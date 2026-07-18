import { describe, expect, it } from "vitest";
import {
  buildOriginExecutionPlan,
  ORIGIN_OPENROUTER_FREE_MODEL,
} from "./OriginExecutionPolicy";

const request = {
  goal: "認証処理の安全性を確認してください",
};

describe("buildOriginExecutionPlan", () => {
  it("selects only the explicit OpenRouter free model when configured", () => {
    const result = buildOriginExecutionPlan(request, { openRouterConfigured: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.modelId).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
    expect(result.plan.modelId.endsWith(":free")).toBe(true);
    expect(result.plan.freeOnly).toBe(true);
    expect(result.plan.estimatedCostUsd).toBe(0);
    expect(result.plan.requiresOwnerApproval).toBe(false);
    expect(result.plan.taskType).toBe("security");
  });

  it("fails closed when no explicitly free provider is configured", () => {
    const result = buildOriginExecutionPlan(request, { openRouterConfigured: false });

    expect(result).toEqual({
      ok: false,
      code: "FREE_PROVIDER_NOT_CONFIGURED",
      message: "明示的に無料と確認できるAIプロバイダーが設定されていません。",
    });
  });

  it("rejects invalid cost and timeout policy values", () => {
    expect(buildOriginExecutionPlan(
      request,
      { openRouterConfigured: true },
      { maxEstimatedCostUsd: -1 },
    )).toEqual(expect.objectContaining({ ok: false, code: "INVALID_EXECUTION_POLICY" }));

    expect(buildOriginExecutionPlan(
      request,
      { openRouterConfigured: true },
      { timeoutMs: 0 },
    )).toEqual(expect.objectContaining({ ok: false, code: "INVALID_EXECUTION_POLICY" }));
  });
});
