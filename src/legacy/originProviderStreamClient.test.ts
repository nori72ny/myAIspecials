import { describe, expect, it, vi } from "vitest";
import { ORIGIN_OPENROUTER_FREE_MODEL, type OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";
import { executeOriginProviderStream } from "./originProviderStreamClient";
import type { OriginFetch } from "./originProviderClient";

const plan: OriginExecutionPlan = {
  providerId: "openrouter-free",
  providerLabel: "ORIGIN 無料AI",
  modelId: ORIGIN_OPENROUTER_FREE_MODEL,
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 30_000,
  requiresOwnerApproval: false,
  reason: "stream test",
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  modelEvidence: {
    providerId: "openrouter-free",
    verifiedAt: "2026-09-07T23:20:00.000Z",
    reviewAfter: "2026-09-15T00:00:00.000Z",
    sourceUrl: "https://openrouter.ai/google/gemma-4-31b-it:free",
  },
};

const providerRequest = {
  plan,
  messages: [{ role: "user" as const, content: "ストリーミングを確認" }],
  systemInstruction: "安全に回答してください。",
};

const encoder = new TextEncoder();
function streamingResponse(parts: string[], status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

describe("executeOriginProviderStream", () => {
  it("reports zero streamed transport sends when the provider is not configured", async () => {
    const fetchMock = vi.fn();
    await expect(executeOriginProviderStream(providerRequest, { onDelta: () => undefined }, {}, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({
        code: "PROVIDER_NOT_CONFIGURED",
        diagnostic: { transportRequestCount: 0 },
      });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards genuine upstream deltas and verifies the final zero-cost usage evidence", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.stream).toBe(true);
      expect(body.model).toBe(ORIGIN_OPENROUTER_FREE_MODEL);
      expect(body.provider).toEqual({ allow_fallbacks: false, data_collection: "deny", zdr: true, max_price: { prompt: 0, completion: 0, request: 0 } });
      return streamingResponse([
        ": OPENROUTER PROCESSING\n\n",
        event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "OR" }, finish_reason: null }] }).slice(0, 37),
        event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "OR" }, finish_reason: null }] }).slice(37),
        event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "IGIN" }, finish_reason: null }] }),
        event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: 0, is_byok: false } }),
        "data: [DONE]\n\n",
      ]);
    });
    const deltas: string[] = [];
    const result = await executeOriginProviderStream(providerRequest, { onDelta: (text) => deltas.push(text) }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(["ORIGIN"]);
    expect(result).toEqual(expect.objectContaining({
      text: "ORIGIN",
      transportRequestCount: 1,
      actualCostUsd: 0,
      routingEvidence: expect.objectContaining({ requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, provider: "OpenRouter", attempt: 1, fallbackUsed: false }),
      usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6, costUsd: 0 },
    }));
  });

  it("does not retry or advance policy stages after HTTP 429 free-quota exhaustion", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "120" },
    }));
    await expect(executeOriginProviderStream(
      providerRequest,
      { onDelta: () => undefined },
      { OPENROUTER_API_KEY: "synthetic-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      status: 429,
      retryable: false,
      retryAfterSeconds: 120,
      diagnostic: { transportRequestCount: 1 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("counts every streamed HTTP send across a 403 policy-stage fallback", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("policy unavailable", { status: 403 }))
      .mockResolvedValueOnce(streamingResponse([
        event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "ORIGIN" }, finish_reason: null }] }),
        event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: 0, is_byok: false } }),
        "data: [DONE]\n\n",
      ]));
    const result = await executeOriginProviderStream(providerRequest, { onDelta: () => undefined }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.transportRequestCount).toBe(2);
  });

  it("accumulates streamed HTTP sends across a retry of one logical execution", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
        .mockResolvedValueOnce(streamingResponse([
          event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "ORIGIN" }, finish_reason: null }] }),
          event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: 0, is_byok: false } }),
          "data: [DONE]\n\n",
        ]));
      const pending = executeOriginProviderStream(providerRequest, { onDelta: () => undefined }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch);
      await vi.advanceTimersByTimeAsync(700);
      const result = await pending;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.transportRequestCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when the terminal usage cost is non-zero, after never retrying", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "partial" }, finish_reason: null }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { cost: 0.000001, is_byok: false } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(providerRequest, { onDelta: (text) => deltas.push(text) }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false });
    expect(deltas).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, true, "false"])( "rejects missing or non-boolean false BYOK metadata without emitting text", async (is_byok) => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "must-not-render" }, finish_reason: null }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { cost: 0, is_byok } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(providerRequest, { onDelta: (text) => deltas.push(text) }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false });
    expect(deltas).toEqual([]);
  });

  it("rejects a substituted served model before forwarding its content", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: "paid-or-substituted-model", choices: [{ delta: { content: "must-not-render" }, finish_reason: "stop" }], usage: { cost: 0, is_byok: false } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(providerRequest, { onDelta: (text) => deltas.push(text) }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_ROUTING_UNVERIFIED", retryable: false });
    expect(deltas).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, "omitted"],
    [null, "null"],
    ["", "empty"],
    ["   ", "whitespace-only"],
    [42, "numeric"],
    [true, "boolean"],
  ])("rejects streamed content before forwarding when served-model identity is %s (%s)", async (servedModel, _description: string) => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: servedModel, choices: [{ delta: { content: "must-not-render" }, finish_reason: "stop" }], usage: { cost: 0, is_byok: false } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(providerRequest, { onDelta: (text) => deltas.push(text) }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_ROUTING_UNVERIFIED", retryable: false });
    expect(deltas).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a truncated stream without DONE and does not retry", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "partial" }, finish_reason: "stop" }], usage: { cost: 0, is_byok: false } }),
    ]));
    await expect(executeOriginProviderStream(providerRequest, { onDelta: () => undefined }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not issue continuation calls when a streamed answer hits the output limit", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "partial" }, finish_reason: "length" }], usage: { cost: 0, is_byok: false } }),
      "data: [DONE]\n\n",
    ]));
    await expect(executeOriginProviderStream(providerRequest, { onDelta: () => undefined }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
