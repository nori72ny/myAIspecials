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

  it("does not retry an SSE rate_limit_exceeded event on the free plan", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ error: { metadata: { error_type: "rate_limit_exceeded" } } }),
    ]));
    await expect(executeOriginProviderStream(
      providerRequest,
      { onDelta: () => undefined },
      { OPENROUTER_API_KEY: "synthetic-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      status: 429,
      retryable: false,
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

  it("stops the policy-stage progression at a rate limit after a 403, without a third send", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("policy unavailable", { status: 403 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "120" } }))
      .mockResolvedValue(new Response("must not be sent", { status: 200 }));
    await expect(executeOriginProviderStream(
      providerRequest,
      { onDelta: () => undefined },
      { OPENROUTER_API_KEY: "synthetic-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      status: 429,
      retryable: false,
      diagnostic: { transportRequestCount: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forwards each fragment as it arrives in incremental release mode, without a final full-text release", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "OR" }, finish_reason: null }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "IG" }, finish_reason: null }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "IN" }, finish_reason: null }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: 0, is_byok: false } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    const result = await executeOriginProviderStream(
      { ...providerRequest, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      { OPENROUTER_API_KEY: "synthetic-key" },
      fetchMock as unknown as OriginFetch,
    );
    // Progressive display: the handler receives the genuine fragments in order,
    // never one held-back full-text release at the end.
    expect(deltas).toEqual(["OR", "IG", "IN"]);
    expect(result.text).toBe("ORIGIN");
    expect(result.transportRequestCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("releases the first fragment before the stream completes in incremental release mode", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
    });
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    }));
    const deltas: string[] = [];
    const pending = executeOriginProviderStream(
      { ...providerRequest, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      { OPENROUTER_API_KEY: "synthetic-key" },
      fetchMock as unknown as OriginFetch,
    );
    streamController!.enqueue(encoder.encode(event({
      model: ORIGIN_OPENROUTER_FREE_MODEL,
      choices: [{ delta: { content: "first" }, finish_reason: null }],
    })));
    // The stream is still open (generation in progress), yet the first fragment
    // has already been released for display: time-to-first-character no longer
    // waits for the full generation.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(deltas).toEqual(["first"]);
    streamController!.enqueue(encoder.encode(event({
      model: ORIGIN_OPENROUTER_FREE_MODEL,
      choices: [{ delta: { content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5, cost: 0, is_byok: false },
    })));
    streamController!.enqueue(encoder.encode("data: [DONE]\n\n"));
    streamController!.close();
    const result = await pending;
    expect(result.text).toBe("first");
    expect(deltas).toEqual(["first"]);
  });

  it("still fails closed on a non-zero terminal usage cost in incremental release mode", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "partial" }, finish_reason: null }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { cost: 0.000001, is_byok: false } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      { ...providerRequest, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      { OPENROUTER_API_KEY: "synthetic-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false });
    // The fragment was shown provisionally, but the execution still fails
    // closed: no result is returned, so downstream admission (which requires
    // the verified completion event) discards the provisional text.
    expect(deltas).toEqual(["partial"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry after a fragment was released in incremental release mode", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Deliver the first fragment first and let the reader forward it;
        // only then sever the connection mid-stream.
        setTimeout(() => {
          controller.enqueue(encoder.encode(event({
            model: ORIGIN_OPENROUTER_FREE_MODEL,
            choices: [{ delta: { content: "partial" }, finish_reason: null }],
          })));
          setTimeout(() => controller.error(new Error("connection reset")), 10);
        }, 0);
      },
    });
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    }));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      { ...providerRequest, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      { OPENROUTER_API_KEY: "synthetic-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      diagnostic: { transportFailure: "network", transportRequestCount: 1 },
    });
    // A retry would duplicate the already-displayed fragment; the transient
    // network failure is surfaced instead (same rule as the failover
    // dispatcher's no-switch-after-first-byte).
    expect(deltas).toEqual(["partial"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a length-limited streamed answer as a verified partial result flagged truncated (hold mode)", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "partial" }, finish_reason: "length" }], usage: { cost: 0, is_byok: false } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    const result = await executeOriginProviderStream(providerRequest, { onDelta: (text) => deltas.push(text) }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch);
    expect(result.text).toBe("partial");
    expect(result.truncated).toBe(true);
    expect(result.actualCostUsd).toBe(0);
    // Hold mode releases the accumulated partial text once, at the end,
    // exactly like a completed answer — the truncation rides on the result.
    expect(deltas).toEqual(["partial"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps incrementally released fragments and flags the result truncated instead of failing the stream", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "part one " }, finish_reason: null }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "part two" }, finish_reason: "length" }], usage: { cost: 0, is_byok: false } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    const result = await executeOriginProviderStream(
      { ...providerRequest, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      { OPENROUTER_API_KEY: "synthetic-key" },
      fetchMock as unknown as OriginFetch,
    );
    expect(result.text).toBe("part one part two");
    expect(result.truncated).toBe(true);
    expect(deltas).toEqual(["part one ", "part two"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
