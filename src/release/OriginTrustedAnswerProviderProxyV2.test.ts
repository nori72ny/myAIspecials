// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  createTrustedAnswerProviderBoundaryV2,
  publicTrustedAnswerProviderErrorV2,
  validateTrustedAnswerProviderRequestV2,
} from "./OriginTrustedAnswerProviderProxyV2.js";

function request() {
  return {
    plan: {
      providerId: "openrouter-free" as const,
      providerLabel: "ORIGIN 無料AI",
      modelId: ORIGIN_OPENROUTER_FREE_MODEL,
      taskType: "review" as const,
      freeOnly: true as const,
      estimatedCostUsd: 0 as const,
      timeoutMs: 20_000,
      requiresOwnerApproval: false as const,
      reason: "test",
      providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
      modelEvidence: {
        providerId: "openrouter-free" as const,
        verifiedAt: "2026-09-23T00:00:00.000Z",
        reviewAfter: "2026-10-01T00:00:00.000Z",
        sourceUrl: "https://openrouter.ai/models",
      },
    },
    messages: [{ role: "user" as const, content: "Explain recursion simply." }],
    systemInstruction: "Answer clearly.",
  };
}

function result() {
  return {
    text: "Recursion is when a function solves a problem by calling itself on a smaller version.",
    actualCostUsd: 0 as const,
    providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
    routingEvidence: {
      requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      strategy: "adaptive-primary",
      provider: "OpenRouter",
      attempt: 1 as const,
      fallbackUsed: false,
    },
    usage: { costUsd: 0 as const },
  };
}

describe("AQ V2 trusted answer provider boundary", () => {
  it("accepts a bounded plain-answer request under the exact zero-cost policy", () => {
    expect(validateTrustedAnswerProviderRequestV2(request())).toEqual(request());
  });

  it("blocks tool contracts, paid/fallback policy changes and oversized messages", () => {
    expect(() => validateTrustedAnswerProviderRequestV2({
      ...request(),
      requiredTool: { name: "write_file", description: "write", parameters: {} },
    })).toThrow("TRUSTED_ANSWER_PROVIDER_TOOL_BLOCKED");

    expect(() => validateTrustedAnswerProviderRequestV2({
      ...request(),
      plan: {
        ...request().plan,
        providerDataPolicy: { ...DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, allowProviderFallbacks: true },
      },
    })).toThrow("TRUSTED_ANSWER_PROVIDER_POLICY_VIOLATION");

    expect(() => validateTrustedAnswerProviderRequestV2({
      ...request(),
      messages: [{ role: "user", content: "x".repeat(32_001) }],
    })).toThrow("TRUSTED_ANSWER_PROVIDER_MESSAGES_INVALID");
  });

  it("permits exactly one provider request for one leased AQ case", async () => {
    const execute = vi.fn(async () => result());
    const token = "a".repeat(64);
    const boundary = createTrustedAnswerProviderBoundaryV2({ token, execute });

    await expect(boundary.execute(token, request())).resolves.toEqual(result());
    expect(boundary.used()).toBe(1);
    expect(boundary.remaining()).toBe(0);
    await expect(boundary.execute(token, request())).rejects.toThrow("TRUSTED_ANSWER_PROVIDER_BUDGET_EXHAUSTED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not expose internal errors or accept the wrong capability token", async () => {
    const token = "a".repeat(64);
    const boundary = createTrustedAnswerProviderBoundaryV2({
      token,
      execute: async () => { throw new Error("secret upstream detail"); },
    });
    await expect(boundary.execute("b".repeat(64), request())).rejects.toThrow("TRUSTED_ANSWER_PROVIDER_UNAUTHORIZED");
    expect(publicTrustedAnswerProviderErrorV2(new Error("secret upstream detail"))).toEqual({
      code: "TRUSTED_ANSWER_PROVIDER_EXECUTION_FAILED",
      status: 502,
    });
  });
});
