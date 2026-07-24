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
    requireZeroDataRetention: false,
  },
  modelEvidence: {
    verifiedAt: "2026-07-25T00:00:00.000Z",
    reviewAfter: "2026-08-01T23:59:59.999Z",
    sourceUrl: "https://openrouter.ai/docs/guides/routing/routers/free-router",
  },
};

const request = {
  plan,
  messages: [{ role: "user" as const, content: "確認してください" }],
  systemInstruction: "安全に回答してください。",
};

function successfulProviderPayload(overrides: Record<string, unknown> = {}) {
  const servedModel = "inclusionai/ling-3.0-flash:free";
  return {
    model: servedModel,
    choices: [{ message: { content: "確認結果です。" } }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cost: 0,
    },
    ...overrides,
  };
}

describe("executeOriginProvider", () => {
  it("enforces the official free router, no fallback, data deny, and zero-cost routing evidence", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = init?.headers as Record<string, string>;

      expect(body.model).toBe("openrouter/free");
      expect(body.messages[0]).toEqual({ role: "system", content: "安全に回答してください。" });
      expect(body.usage).toBeUndefined();
      expect(body.provider).toEqual({
        allow_fallbacks: false,
        data_collection: "deny",
      });
      expect(headers["X-OpenRouter-Title"]).toBe("ORIGIN Personal");
      expect(headers["X-OpenRouter-Metadata"]).toBeUndefined();
      expect(headers["HTTP-Referer"]).toBe("https://myaispecials.ai.studio/");

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
        servedModel: "inclusionai/ling-3.0-flash:free",
        strategy: "free-router",
        provider: "OpenRouter",
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

  it("rejects a plan that permits provider fallback, data collection, or changes the reviewed ZDR mode", async () => {
    const fetchMock = vi.fn();
    const unsafePlan = {
      ...plan,
      providerDataPolicy: {
        allowProviderFallbacks: true,
        dataCollection: "allow",
        requireZeroDataRetention: true,
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

  it("rejects a response served by a model that is not explicitly free", async () => {
    const payload = successfulProviderPayload({
      model: "google/gemini-3.6-flash",
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

  it("normalizes provider errors without returning or logging provider content or credentials", async () => {
    const providerBody = "synthetic provider body Authorization: Bearer upstream-secret-value";
    const apiKey = "synthetic-test-key";
    const fetchMock = vi.fn(async () => new Response(providerBody, { status: 429 }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const thrown = await executeOriginProvider(
        request,
        { OPENROUTER_API_KEY: apiKey },
        fetchMock as unknown as OriginFetch,
      ).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(thrown).toBeInstanceOf(OriginProviderError);
      expect(thrown).toMatchObject({
        code: "PROVIDER_RATE_LIMITED",
        status: 429,
        retryable: true,
        message: "無料AIの利用上限に達しました。時間をおいて再試行してください。",
      });
      expect(String(thrown)).not.toContain(providerBody);
      expect(String(thrown)).not.toContain(apiKey);
      expect(Object.prototype.hasOwnProperty.call(thrown, "body")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(thrown, "response")).toBe(false);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each([
    [401, "PROVIDER_NOT_CONFIGURED", false],
    [402, "PROVIDER_UNAVAILABLE", false],
    [403, "PROVIDER_UNAVAILABLE", false],
    [404, "PROVIDER_UNAVAILABLE", true],
  ] as const)("maps provider HTTP %s to a truthful public error", async (status, code, retryable) => {
    const fetchMock = vi.fn(async () => new Response("provider detail must stay private", { status }));

    await expect(executeOriginProvider(
      request,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code,
      retryable,
    });
  });
});
