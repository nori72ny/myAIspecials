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
  providerDataPolicy: {
    allowProviderFallbacks: false,
    dataCollection: "deny",
    requireZeroDataRetention: true,
  },
  modelEvidence: {
    verifiedAt: "2026-07-19T00:00:00.000Z",
    reviewAfter: "2026-08-18T23:59:59.999Z",
    sourceUrl: "https://openrouter.ai/moonshotai/kimi-k2.6:free/pricing",
  },
};

const request = {
  plan,
  messages: [{ role: "user" as const, content: "確認してください" }],
  systemInstruction: "安全に回答してください。",
};

describe("executeOriginProvider", () => {
  it("enforces no fallback, no data collection, ZDR, and reconciled zero cost", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = init?.headers as Record<string, string>;

      expect(body.model).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
      expect(body.model).toBe("moonshotai/kimi-k2.6:free");
      expect(body.model.endsWith(":free")).toBe(true);
      expect(body.messages[0]).toEqual({ role: "system", content: "安全に回答してください。" });
      expect(body.provider).toEqual({
        allow_fallbacks: false,
        data_collection: "deny",
        zdr: true,
      });
      expect(headers["X-OpenRouter-Title"]).toBe("ORIGIN Personal");
      expect(headers["HTTP-Referer"]).toBeUndefined();

      return new Response(JSON.stringify({
        choices: [{ message: { content: "確認結果です。" } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cost: 0,
        },
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
      providerDataPolicy: plan.providerDataPolicy,
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        costUsd: 0,
      },
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

  it("rejects a plan that permits provider fallback or data retention", async () => {
    const fetchMock = vi.fn();
    const unsafePlan = {
      ...plan,
      providerDataPolicy: {
        allowProviderFallbacks: true,
        dataCollection: "allow",
        requireZeroDataRetention: false,
      },
    } as unknown as OriginExecutionPlan;

    await expect(executeOriginProvider(
      { ...request, plan: unsafePlan },
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_POLICY_VIOLATION",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a response when zero cost cannot be verified", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "確認結果です。" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(executeOriginProvider(
      request,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_COST_UNVERIFIED",
      retryable: false,
      message: "無料実行であることを利用明細から確認できなかったため、回答を返しません。",
    });
  });

  it("discards the response when a nonzero cost is reported", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "返してはいけない回答" } }],
      usage: { cost: 0.000001 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(executeOriginProvider(
      request,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_POLICY_VIOLATION",
      retryable: false,
      message: "無料モデルの実行で0ドルを超える利用額が報告されたため、回答を破棄しました。",
    });
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
