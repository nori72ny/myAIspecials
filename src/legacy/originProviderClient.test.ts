import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertOriginZeroCostExecutionResult, executeOriginProvider, originCompletionTokenBudget, OriginProviderError, resetOriginProviderCooldownForTests, type OriginFetch } from "./originProviderClient";
import { ORIGIN_OPENROUTER_FREE_MODEL, type OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";

const plan: OriginExecutionPlan = {
  providerId: "openrouter-free", providerLabel: "ORIGIN 無料AI", modelId: ORIGIN_OPENROUTER_FREE_MODEL, taskType: "review", freeOnly: true, estimatedCostUsd: 0, timeoutMs: 30_000, requiresOwnerApproval: false, reason: "test",
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  modelEvidence: { providerId: "openrouter-free", verifiedAt: "2026-09-07T00:00:00.000Z", reviewAfter: "2026-09-17T00:00:00.000Z", sourceUrl: "https://openrouter.ai/google/gemma-4-26b-a4b-it:free" },
};
const request = { plan, messages: [{ role: "user" as const, content: "確認してください" }], systemInstruction: "安全に回答してください。" };
function successfulProviderPayload(overrides: Record<string, unknown> = {}) { return { model: ORIGIN_OPENROUTER_FREE_MODEL, choices: [{ message: { content: "確認結果です。" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0, is_byok: false }, ...overrides }; }

describe("executeOriginProvider", () => {
  it("does not retry HTTP 429 because failed attempts consume the free daily quota", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "120" },
    }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({
        code: "PROVIDER_RATE_LIMITED",
        status: 429,
        retryable: false,
        retryAfterSeconds: 120,
        diagnostic: { transportRequestCount: 1 },
      });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([400, 403, 404, 422])("preserves upstream HTTP %s as a safe diagnostic without parsing its body as an answer", async (status) => {
    const fetchMock = vi.fn(async () => new Response("private upstream body", { status }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 503, retryable: false, diagnostic: { upstreamStatus: status } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => resetOriginProviderCooldownForTests());
  it("rejects a paid or substituted executor result before a router can render its text", () => { const result = { text: "表示してはいけない応答", transportRequestCount: 1, actualCostUsd: 0.000001, providerDataPolicy: plan.providerDataPolicy, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const }, usage: { costUsd: 0.000001 } } as unknown as Awaited<ReturnType<typeof executeOriginProvider>>; expect(() => assertOriginZeroCostExecutionResult(result)).toThrow("0ドル固定ポリシー"); expect(() => assertOriginZeroCostExecutionResult({ ...result, actualCostUsd: null, reportedUsageCostUsd: 0, policyMaxCostUsd: 0, costEvidenceStatus: "NOT_MEASURED", billingEvidence: { reportedUsageCostUsd: 0, isByok: false }, usage: { reportedCostUsd: 0 }, routingEvidence: { ...result.routingEvidence, servedModel: "paid-model" } })).toThrow("許可された無料Provider/Modelの証跡を確認できません。"); });
  it("rejects otherwise valid execution evidence when transport count is missing or zero", () => {
    const validWithoutCount = {
      text: "回答",
      actualCostUsd: null as const, reportedUsageCostUsd: 0 as const, policyMaxCostUsd: 0 as const, costEvidenceStatus: "NOT_MEASURED" as const, billingEvidence: { reportedUsageCostUsd: 0 as const, isByok: false as const },
      providerDataPolicy: plan.providerDataPolicy,
      routingEvidence: {
        requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
        servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
        strategy: "adaptive-primary",
        // Use the canonical provider ID so this fixture isolates transport-count validation.
        provider: "openrouter",
        attempt: 1 as const,
        fallbackUsed: false as const,
      },
      usage: { reportedCostUsd: 0 as const },
    };
    expect(() => assertOriginZeroCostExecutionResult(validWithoutCount as unknown as Parameters<typeof assertOriginZeroCostExecutionResult>[0]))
      .toThrow("実際のProvider HTTP送信回数を確認できません。");
    expect(() => assertOriginZeroCostExecutionResult({
      ...validWithoutCount,
      transportRequestCount: 0,
    } as unknown as Parameters<typeof assertOriginZeroCostExecutionResult>[0]))
      .toThrow("実際のProvider HTTP送信回数を確認できません。");
  });
  it("enforces the fixed free model, one provider attempt, denied data collection, ZDR, and zero-cost routing evidence", async () => { const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { const body = JSON.parse(String(init?.body)); const headers = init?.headers as Record<string, string>; expect(body.model).toBe(ORIGIN_OPENROUTER_FREE_MODEL); expect(body.messages[0]).toEqual({ role: "system", content: "安全に回答してください。" }); expect(body.max_tokens).toBe(4096); expect(body.reasoning).toBeUndefined(); expect(body.temperature).toBe(0.2); expect(body.top_p).toBe(0.9); expect(body.usage).toEqual({ include: true }); expect(body.provider).toEqual({ allow_fallbacks: false, data_collection: "deny", zdr: true, max_price: { prompt: 0, completion: 0, request: 0 } }); expect(body.provider.only).toBeUndefined(); expect(body.provider.sort).toBeUndefined(); expect(headers["X-OpenRouter-Title"]).toBe("ORIGIN Personal"); expect(headers["X-OpenRouter-Metadata"]).toBeUndefined(); expect(headers["HTTP-Referer"]).toBe("https://myaispecials.ai.studio/"); return new Response(JSON.stringify(successfulProviderPayload()), { status: 200, headers: { "Content-Type": "application/json" } }); }); const result = await executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch); expect(result).toEqual({ text: "確認結果です。", transportRequestCount: 1, actualCostUsd: null, reportedUsageCostUsd: 0, policyMaxCostUsd: 0, costEvidenceStatus: "NOT_MEASURED", providerDataPolicy: plan.providerDataPolicy, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false }, billingEvidence: { reportedUsageCostUsd: 0, isByok: false }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, reportedCostUsd: 0 } }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("does not retry transient HTTP failures because failed free-tier attempts consume quota", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("temporary failure", { status: 503 }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        retryable: false,
        diagnostic: { upstreamStatus: 503, transportRequestCount: 1 },
      });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([403, 404])("does not relax strict ZDR or retry after HTTP %s", async (status) => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.provider).toEqual({
        allow_fallbacks: false,
        data_collection: "deny",
        zdr: true,
        max_price: { prompt: 0, completion: 0, request: 0 },
      });
      return new Response("strict privacy policy unavailable", { status });
    });
    await expect(executeOriginProvider(
      request,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      fetchMock as unknown as OriginFetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      status: 503,
      retryable: false,
      diagnostic: { upstreamStatus: status, transportRequestCount: 1 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses a bounded, task-aware one-request output budget without under-answering complex work", () => { expect(originCompletionTokenBudget("test")).toBe(2400); expect(originCompletionTokenBudget("ux")).toBe(4096); expect(originCompletionTokenBudget("review")).toBe(4096); expect(originCompletionTokenBudget("documentation")).toBe(6144); expect(originCompletionTokenBudget("implementation")).toBe(6144); });
  it("accepts normalized text-part content returned by compatible providers", async () => { const payload = successfulProviderPayload({ choices: [{ message: { content: [{ type: "text", text: "結論です。" }, { type: "text", text: "具体案です。" }] } }] }); const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })); const result = await executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch); expect(result.text).toBe("結論です。\n\n具体案です。"); });
  it("honors the execution-plan timeout instead of the legacy six-second transport limit", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(JSON.stringify(successfulProviderPayload()), { status: 200, headers: { "Content-Type": "application/json" } })), 7_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }));
      const pending = executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch);
      await vi.advanceTimersByTimeAsync(7_000);
      await expect(pending).resolves.toMatchObject({ text: "確認結果です。", actualCostUsd: null, reportedUsageCostUsd: 0, policyMaxCostUsd: 0, costEvidenceStatus: "NOT_MEASURED" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("fails closed on a non-empty length-limited answer without a continuation request", async () => { const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(successfulProviderPayload({ choices: [{ message: { content: "結論と理由の前半です。" }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0, is_byok: false } })), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: false }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("never issues a hidden continuation request when a structured answer reaches the output limit", async () => { const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(successfulProviderPayload({ choices: [{ message: { content: "## 重要点\\n\\n- 推論AI\\n- エージェントAI" }, finish_reason: "length" }] })), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("fails closed after the single bounded provider request", async () => { const fetchMock = vi.fn(async () => new Response(JSON.stringify(successfulProviderPayload({ choices: [{ message: { content: "まだ続く回答です。" }, finish_reason: "length" }] })), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: false }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("fails closed on an empty response without automatic retry", async () => { const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(successfulProviderPayload({ choices: [{ message: { content: "" }, finish_reason: "length" }] })), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: false }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("maps a provider error embedded in a successful HTTP response", async () => { const payload = successfulProviderPayload({ choices: [{ message: { content: "" }, finish_reason: "error", error: { metadata: { error_type: "provider_unavailable" } } }] }); const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: false, diagnostic: { upstreamErrorType: "provider_unavailable" } }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("fails closed instead of attempting another provider when unconfigured", async () => { const fetchMock = vi.fn(); await expect(executeOriginProvider(request, {}, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED", status: 503, retryable: false, diagnostic: { transportRequestCount: 0 } }); expect(fetchMock).not.toHaveBeenCalled(); });
  it("rejects a non-free or unexpected execution plan before network access", async () => { const fetchMock = vi.fn(); const unsafePlan = { ...plan, modelId: "google/gemini-2.5-flash" } as unknown as OriginExecutionPlan; await expect(executeOriginProvider({ ...request, plan: unsafePlan }, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toBeInstanceOf(OriginProviderError); expect(fetchMock).not.toHaveBeenCalled(); });
  it("rejects a different free model plan before network access", async () => { const fetchMock = vi.fn(); const switchedPlan = { ...plan, modelId: "google/gemma-3-27b-it:free" } as unknown as OriginExecutionPlan; await expect(executeOriginProvider({ ...request, plan: switchedPlan }, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false }); expect(fetchMock).not.toHaveBeenCalled(); });
  it.each([
    { allowProviderFallbacks: true, dataCollection: "deny", requireZeroDataRetention: true },
    { allowProviderFallbacks: false, dataCollection: "provider-free-tier", requireZeroDataRetention: true },
    { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: false },
  ])("rejects an unsafe provider data policy before egress", async (providerDataPolicy) => { const fetchMock = vi.fn(); const unsafePlan = { ...plan, providerDataPolicy } as unknown as OriginExecutionPlan; await expect(executeOriginProvider({ ...request, plan: unsafePlan }, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false }); expect(fetchMock).not.toHaveBeenCalled(); });
  it.each([undefined, null, true, "false"])( "requires is_byok to be the literal boolean false", async (is_byok) => {
    const payload = successfulProviderPayload({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0, is_byok } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false });
  });
  it.each([["missing", undefined], ["string zero", "0"], ["negative zero", -0], ["nonzero", 1e-9]])("rejects usage.cost when it is %s", async (_label, reportedCost) => {
    const payload = successfulProviderPayload({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, ...(reportedCost === undefined ? {} : { cost: reportedCost }), is_byok: false } });
    let body = JSON.stringify(payload);
    if (Object.is(reportedCost, -0)) body = body.replace('"cost":0', '"cost":-0');
    const fetchMock = vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: expect.stringMatching(/PROVIDER_(POLICY_VIOLATION|COST_UNVERIFIED)/), retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response when zero cost cannot be verified", async () => { const payload = successfulProviderPayload({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }); const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_COST_UNVERIFIED", retryable: false }); });
  it("discards the response when a nonzero cost is reported", async () => { const payload = successfulProviderPayload({ usage: { cost: 0.000001 } }); const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false }); });
  it.each([[{ billing_tier: "paid" }, "a paid billing tier"], [{ is_free: false }, "an explicit paid-model flag"], [{ pricing: { prompt: "0.000001", completion: "0" } }, "nonzero model pricing"], [{ usage: { cost: 0, is_byok: false, cost_details: { upstream_inference_cost: 0.000001 } } }, "an upstream inference charge"], [{ usage: { cost: 0, is_byok: true } }, "a bring-your-own-key billing route"]] as const)("discards zero-cost-looking responses containing %s", async (overrides, _description) => { const payload = successfulProviderPayload(overrides as Record<string, unknown>); const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false }); });
  it.each([
    [undefined, "omitted"],
    [null, "null"],
    ["", "empty"],
    ["   ", "whitespace-only"],
    [42, "numeric"],
    [true, "boolean"],
  ])("fails closed when the provider served-model identity is %s (%s)", async (servedModel, _description: string) => {
    const payload = successfulProviderPayload({ model: servedModel });
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
