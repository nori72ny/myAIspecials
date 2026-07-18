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

function successfulProviderPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: ORIGIN_OPENROUTER_FREE_MODEL,
    choices: [{ message: { content: "確認結果です。" } }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cost: 0,
    },
    openrouter_metadata: {
      requested: ORIGIN_OPENROUTER_FREE_MODEL,
      strategy: "free",
      region: "iad",
      attempt: 1,
      endpoints: {
        available: [{
          provider: "Synthetic ZDR Provider",
          model: ORIGIN_OPENROUTER_FREE_MODEL,
          selected: true,
        }],
      },
      attempts: [{
        provider: "Synthetic ZDR Provider",
        model: ORIGIN_OPENROUTER_FREE_MODEL,
        status: 200,
      }],
    },
    ...overrides,
  };
}

describe("executeOriginProvider", () => {
  it("enforces zero max price, no fallback, data deny, ZDR, and routing evidence", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = init?.headers as Record<string, string>;

      expect(body.model).toBe("moonshotai/kimi-k2.6:free");
      expect(body.messages[0]).toEqual({ role: "system", content: "安全に回答してください。" });
      expect(body.usage).toEqual({ include: true });
      expect(body.provider).toEqual({
        allow_fallbacks: false,
        data_collection: "deny",
        zdr: true,
        max_price: {
          prompt: 0,
          completion: 0,
          request: 0,
          image: 0,
        },
      });
      expect(headers["X-OpenRouter-Title"]).toBe("ORIGIN Personal");
      expect(headers["X-OpenRouter-Metadata"]).toBe("enabled");
      expect(headers["HTTP-Referer"]).toBeUndefined();

      return new Response(JSON.stringify(successfulProviderPayload()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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
      routingEvidence: {
        requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
        servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
        strategy: "free",
        provider: "Synthetic ZDR Provider",
        region: "iad",
        attempt: 1,
        fallbackUsed: false,
      },
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
    const payload = successfulProviderPayload({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

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
    const payload = successfulProviderPayload({ usage: { cost: 0.000001 } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

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

  it("rejects a response when router metadata is missing", async () => {
    const payload = successfulProviderPayload({ openrouter_metadata: undefined });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(executeOriginProvider(
      request,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_ROUTING_UNVERIFIED",
      retryable: false,
    });
  });

  it("rejects evidence of a fallback attempt", async () => {
    const payload = successfulProviderPayload({
      openrouter_metadata: {
        requested: ORIGIN_OPENROUTER_FREE_MODEL,
        strategy: "fallback",
        attempt: 2,
        endpoints: {
          available: [{ provider: "Second Provider", selected: true }],
        },
        attempts: [
          { provider: "First Provider", status: 503 },
          { provider: "Second Provider", status: 200 },
        ],
      },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(executeOriginProvider(
      request,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_ROUTING_UNVERIFIED",
      retryable: false,
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
