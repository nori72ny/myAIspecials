import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeOriginAiStudioOfflineContract,
  type OriginAiStudioOfflineRequest,
} from "./OriginAiStudioOfflineExecutor";
import {
  ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT,
  type OriginAiStudioRuntimePlan,
} from "./OriginAiStudioRuntimePolicy";

const strictPlan: OriginAiStudioRuntimePlan = {
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
    verifiedAt: "2020-01-01T00:00:00.000Z",
    reviewAfter: "2099-12-31T23:59:59.999Z",
    pricingSourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    modelSourceUrl: "https://ai.google.dev/gemini-api/docs/models",
  },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("OriginAiStudioOfflineExecutor", () => {
  it("passes only the offline request contract and returns a policy-verified answer", async () => {
    let captured: OriginAiStudioOfflineRequest | undefined;
    const transport = vi.fn(async (request: OriginAiStudioOfflineRequest) => {
      captured = request;
      return { kind: "success" as const, text: "安全な応答" };
    });

    const result = await executeOriginAiStudioOfflineContract(
      strictPlan,
      "テスト入力",
      transport,
    );

    expect(result).toEqual({
      ok: true,
      text: "安全な応答",
      verificationStatus: "policy-verified",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(captured).toEqual(expect.objectContaining({
      modelId: "gemini-9.9-flash",
      prompt: "テスト入力",
      store: false,
      signal: expect.any(AbortSignal),
    }));
    expect(Object.keys(captured ?? {})).toEqual(["modelId", "prompt", "store", "signal"]);
    expect(JSON.stringify(captured)).not.toMatch(/authorization|api.?key|token/i);
  });

  it.each([
    ["rate_limited", "AI_STUDIO_RATE_LIMITED"],
    ["region_unavailable", "AI_STUDIO_REGION_UNAVAILABLE"],
    ["upstream_rejected", "AI_STUDIO_UPSTREAM_REJECTED"],
    ["malformed_response", "AI_STUDIO_UPSTREAM_MALFORMED"],
  ] as const)("fails closed for %s without retry or fallback", async (kind, code) => {
    const transport = vi.fn(async () => ({ kind }));

    const result = await executeOriginAiStudioOfflineContract(
      strictPlan,
      "一度だけ送信",
      transport,
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code,
      retryable: false,
    }));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty successful response instead of displaying it", async () => {
    const transport = vi.fn(async () => ({ kind: "success" as const, text: "   " }));

    await expect(executeOriginAiStudioOfflineContract(
      strictPlan,
      "入力",
      transport,
    )).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_UPSTREAM_MALFORMED",
    }));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("aborts a timed-out request and does not retry it", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const transport = vi.fn((request: OriginAiStudioOfflineRequest) => {
      observedSignal = request.signal;
      return new Promise<never>(() => undefined);
    });

    const pending = executeOriginAiStudioOfflineContract(
      strictPlan,
      "timeout input",
      transport,
      { timeoutMs: 25 },
    );
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_TIMEOUT",
      retryable: false,
    }));
    expect(observedSignal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not expose prompt, credentials, authorization, or upstream errors in logs", async () => {
    const log = vi.fn();
    const sensitivePrompt = "secret prompt that must not be logged";
    const transport = vi.fn(async () => {
      throw new Error("Authorization: Bearer fake-secret-token upstream body");
    });

    const result = await executeOriginAiStudioOfflineContract(
      strictPlan,
      sensitivePrompt,
      transport,
      { log },
    );

    expect(result).toEqual({
      ok: false,
      code: "AI_STUDIO_UPSTREAM_REJECTED",
      message: "AIサービスの応答を安全に確認できないため、実行を停止しました。",
      retryable: false,
    });
    expect(log).toHaveBeenCalledWith({
      event: "ai_studio_execution_blocked",
      code: "AI_STUDIO_UPSTREAM_REJECTED",
    });
    const serializedLog = JSON.stringify(log.mock.calls);
    expect(serializedLog).not.toContain(sensitivePrompt);
    expect(serializedLog).not.toMatch(/authorization|fake-secret-token|upstream body/i);
  });

  it("revalidates identity, evidence, expiry, and zero-cost policy immediately before execution", async () => {
    const weakenedPlans = [
      { ...strictPlan, maxEstimatedCostUsd: 1 },
      { ...strictPlan, freeOnly: false },
      { ...strictPlan, providerId: "untrusted-provider" },
      { ...strictPlan, endpoint: "https://example.test/interactions" },
      { ...strictPlan, modelId: "gemini-flash-latest" },
      { ...strictPlan, evidence: { ...strictPlan.evidence, billingTier: "paid" } },
      { ...strictPlan, evidence: { ...strictPlan.evidence, reviewAfter: "2020-01-02T00:00:00.000Z" } },
      { ...strictPlan, evidence: { ...strictPlan.evidence, pricingSourceUrl: "https://example.test/pricing" } },
      { ...strictPlan, requestPolicy: { ...strictPlan.requestPolicy, store: true } },
      { ...strictPlan, requestPolicy: { ...strictPlan.requestPolicy, allowAutomaticRetries: true } },
      { ...strictPlan, requestPolicy: { ...strictPlan.requestPolicy, allowProviderFallbacks: true } },
      { ...strictPlan, requestPolicy: { ...strictPlan.requestPolicy, allowAutomaticModelSelection: true } },
    ] as unknown as OriginAiStudioRuntimePlan[];
    const transport = vi.fn(async () => ({ kind: "success" as const, text: "must not run" }));

    for (const plan of weakenedPlans) {
      await expect(executeOriginAiStudioOfflineContract(
        plan,
        "入力",
        transport,
      )).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: "AI_STUDIO_EXECUTION_POLICY_INVALID",
      }));
    }

    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects whitespace input before transport execution", async () => {
    const transport = vi.fn(async () => ({ kind: "success" as const, text: "must not run" }));

    await expect(executeOriginAiStudioOfflineContract(
      strictPlan,
      "   ",
      transport,
    )).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_INPUT_INVALID",
    }));
    expect(transport).not.toHaveBeenCalled();
  });
});
