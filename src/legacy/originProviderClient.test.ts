import { describe, expect, it, vi } from "vitest";
import {
  executeOriginProvider,
  OriginProviderError,
  type OriginFetch,
} from "./originProviderClient";
import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy";

const plan: OriginExecutionPlan = {
  providerId: "openrouter-free",
  providerLabel: "ORIGIN 無料AI",
  modelId: ORIGIN_OPENROUTER_FREE_MODEL,
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 30_000,
  requiresOwnerApproval: false,
  reason: "test",
};

const request = {
  plan,
  messages: [{ role: "user" as const, content: "確認してください" }],
  systemInstruction: "安全に回答してください。",
};

describe("executeOriginProvider", () => {
  it("executes the exact explicit :free model and reports zero cost", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
      expect(body.model.endsWith(":free")).toBe(true);
      expect(body.messages[0]).toEqual({ role: "system", content: "安全に回答してください。" });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "確認結果です。" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await executeOriginProvider(
      request,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    );

    expect(result).toEqual({
      text: "確認結果です。",
      actualCostUsd: 0,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of attempting another provider when unconfigured", async () => {
    const fetchMock = vi.fn();

    await expect(executeOriginProvider(
      request,
      {},
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
      status: 503,
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-free or unexpected execution plan before network access", async () => {
    const fetchMock = vi.fn();
    const unsafePlan = {
      ...plan,
      modelId: "google/gemini-2.5-flash",
    } as unknown as OriginExecutionPlan;

    await expect(executeOriginProvider(
      { ...request, plan: unsafePlan },
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toBeInstanceOf(OriginProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes provider errors without including provider response content", async () => {
    const fetchMock = vi.fn(async () => new Response("synthetic provider body", { status: 429 }));

    await expect(executeOriginProvider(
      request,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      status: 429,
      retryable: true,
      message: "無料AIの利用上限に達しました。時間をおいて再試行してください。",
    });
  });
});
