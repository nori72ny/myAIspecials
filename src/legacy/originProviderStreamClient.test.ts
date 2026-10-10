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
    sourceUrl: "https://openrouter.ai/inclusionai/ling-3.0-flash-sante:free",
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
        event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: 0 } }),
        "data: [DONE]\n\n",
      ]);
    });
    const deltas: string[] = [];
    const result = await executeOriginProviderStream(providerRequest, { onDelta: (text) => deltas.push(text) }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(["OR", "IGIN"]);
    expect(result).toEqual(expect.objectContaining({
      text: "ORIGIN",
      actualCostUsd: 0,
      routingEvidence: expect.objectContaining({ requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, provider: "OpenRouter", attempt: 1, fallbackUsed: false }),
      usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6, costUsd: 0 },
    }));
  });

  it("never reveals upstream deltas when the terminal usage cost is non-zero", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "partial" }, finish_reason: null }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { cost: 0.000001 } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(providerRequest, { onDelta: (text) => deltas.push(text) }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false });
    expect(deltas).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not release text when terminal usage proof is absent", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "unverified" }, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      providerRequest, { onDelta: value => deltas.push(value) },
      { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    expect(deltas).toEqual([]);
  });

  it("does not release text if terminal usage.cost is absent", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "unverified" }, finish_reason: "stop" }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, usage: { prompt_tokens: 3, completion_tokens: 2 } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      providerRequest, { onDelta: value => deltas.push(value) },
      { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({ code: "PROVIDER_COST_UNVERIFIED" });
    expect(deltas).toEqual([]);
  });

  it("discards buffered text when any later chunk switches to a paid model", async () => {
    const paidAlias = ORIGIN_OPENROUTER_FREE_MODEL.replace(/:free$/, "");
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "do not show" }, finish_reason: null }] }),
      event({ model: paidAlias, choices: [{ delta: { content: "or this" }, finish_reason: "stop" }], usage: { cost: 0 } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      providerRequest, { onDelta: value => deltas.push(value) },
      { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({ code: "PROVIDER_ROUTING_UNVERIFIED", retryable: false });
    expect(deltas).toEqual([]);
  });

  it("does not emit bounded-buffer overflow beyond a maximum of 200000 chars", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "a".repeat(200001) }, finish_reason: "stop" }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, usage: { cost: 0 } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      providerRequest, { onDelta: value => deltas.push(value) },
      { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: false });
    expect(deltas).toEqual([]);
  });

  it("rejects a substituted served model before forwarding its content", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: "paid-or-substituted-model", choices: [{ delta: { content: "must-not-render" }, finish_reason: "stop" }], usage: { cost: 0 } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(providerRequest, { onDelta: (text) => deltas.push(text) }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_ROUTING_UNVERIFIED", retryable: false });
    expect(deltas).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never forwards the canonical paid alias even when the provider reports zero cost", async () => {
    const paidCanonicalId = ORIGIN_OPENROUTER_FREE_MODEL.replace(/:free$/, "");
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: paidCanonicalId, choices: [{ delta: { content: "hidden-paid-content" }, finish_reason: "stop" }], usage: { cost: 0 } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      providerRequest,
      { onDelta: text => deltas.push(text) },
      { OPENROUTER_API_KEY: "synthetic-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({ code: "PROVIDER_ROUTING_UNVERIFIED", retryable: false });
    expect(deltas).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { pricing: { prompt: 1e-18, completion: "0" }, expectedCode: "PROVIDER_POLICY_VIOLATION" },
    { pricing: { prompt: "1e-9999", completion: "0" }, expectedCode: "PROVIDER_POLICY_VIOLATION" },
    { pricing: { prompt: " ", completion: "0" }, expectedCode: "PROVIDER_POLICY_VIOLATION" },
    { pricing: { prompt: false, completion: "0" }, expectedCode: "PROVIDER_COST_UNVERIFIED" },
  ])("rejects coerced or tiny positive streamed prices before forwarding output: %j", async ({ expectedCode, ...metadata }) => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, ...metadata, choices: [{ delta: { content: "must-not-render" }, finish_reason: "stop" }], usage: { cost: 0 } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      providerRequest, { onDelta: value => deltas.push(value) },
      { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({ code: expectedCode, retryable: false });
    expect(deltas).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts many small valid SSE events delivered in one large network chunk", async () => {
    const events = Array.from({ length: 6_000 }, () =>
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "x" }, finish_reason: null }] }),
    );
    const fetchMock = vi.fn(async () => streamingResponse([
      events.join(""),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { cost: 0 } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    const result = await executeOriginProviderStream(
      providerRequest, { onDelta: value => deltas.push(value) },
      { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch,
    );
    expect(result.text).toHaveLength(6_000);
    expect(deltas.join("")).toHaveLength(6_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { charge: 0.000000000000000001, expectedCode: "PROVIDER_POLICY_VIOLATION" },
    { charge: "0.000000000000000001", expectedCode: "PROVIDER_POLICY_VIOLATION" },
    { charge: "0.000000", expectedCode: null },
    { charge: 0, expectedCode: null },
  ])("verifies server-tool billing evidence in streamed usage: %j", async ({ charge, expectedCode }) => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "verified" }, finish_reason: "stop" }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, usage: { cost: 0, cost_details: { server_tool_cost: charge } } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    const execution = executeOriginProviderStream(
      providerRequest, { onDelta: value => deltas.push(value) },
      { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch,
    );
    if (expectedCode) {
      await expect(execution).rejects.toMatchObject({ code: expectedCode, retryable: false });
      expect(deltas).toEqual([]);
    } else {
      await expect(execution).resolves.toMatchObject({ text: "verified", actualCostUsd: 0 });
      expect(deltas).toEqual(["verified"]);
    }
  });

  it("rejects oversized newline-free SSE frames before parsing or emitting output", async () => {
    const fetchMock = vi.fn(async () => streamingResponse(["data: " + "x".repeat(1_000_001)]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      providerRequest, { onDelta: value => deltas.push(value) },
      { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: false });
    expect(deltas).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects hidden server-tool charges without emitting streamed text", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "must-not-render" }, finish_reason: "stop" }] }),
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, usage: { cost: 0, cost_details: { server_tool_cost: 0.000001 } } }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginProviderStream(
      providerRequest, { onDelta: value => deltas.push(value) },
      { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false });
    expect(deltas).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects content before forwarding when served-model evidence is absent", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ choices: [{ delta: { content: "must-not-render" }, finish_reason: "stop" }], usage: { cost: 0 } }),
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
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "partial" }, finish_reason: "stop" }], usage: { cost: 0 } }),
    ]));
    await expect(executeOriginProviderStream(providerRequest, { onDelta: () => undefined }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not issue continuation calls when a streamed answer hits the output limit", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([
      event({ model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ delta: { content: "partial" }, finish_reason: "length" }], usage: { cost: 0 } }),
      "data: [DONE]\n\n",
    ]));
    await expect(executeOriginProviderStream(providerRequest, { onDelta: () => undefined }, { OPENROUTER_API_KEY: "synthetic-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
