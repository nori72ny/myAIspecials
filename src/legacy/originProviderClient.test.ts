import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertOriginZeroCostExecutionResult, buildOriginProviderFailureDiagnostic, executeOriginProvider, originCompletionTokenBudget, OriginProviderError, resetOriginProviderCooldownForTests, safeOriginUpstreamErrorCode, type OriginFetch } from "./originProviderClient";
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
  it.each([400, 404, 422])("preserves upstream HTTP %s as a safe diagnostic without parsing its body as an answer", async (status) => {
    const fetchMock = vi.fn(async () => new Response("private upstream body", { status }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 503, retryable: false, diagnostic: { upstreamStatus: status } });
    expect(fetchMock).toHaveBeenCalledTimes(status === 404 ? 3 : 1);
  });
  beforeEach(() => resetOriginProviderCooldownForTests());
  it("rejects a paid or substituted executor result before a router can render its text", () => { const result = { text: "表示してはいけない応答", transportRequestCount: 1, actualCostUsd: 0.000001, providerDataPolicy: plan.providerDataPolicy, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const }, usage: { costUsd: 0.000001 } } as unknown as Awaited<ReturnType<typeof executeOriginProvider>>; expect(() => assertOriginZeroCostExecutionResult(result)).toThrow("0ドル固定ポリシー"); expect(() => assertOriginZeroCostExecutionResult({ ...result, actualCostUsd: 0, usage: { costUsd: 0 }, routingEvidence: { ...result.routingEvidence, servedModel: "paid-model" } })).toThrow("許可された無料Provider/Modelの証跡を確認できません。"); });
  it("rejects otherwise valid execution evidence when transport count is missing or zero", () => {
    const validWithoutCount = {
      text: "回答",
      actualCostUsd: 0 as const,
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
      usage: { costUsd: 0 as const },
    };
    expect(() => assertOriginZeroCostExecutionResult(validWithoutCount as unknown as Parameters<typeof assertOriginZeroCostExecutionResult>[0]))
      .toThrow("実際のProvider HTTP送信回数を確認できません。");
    expect(() => assertOriginZeroCostExecutionResult({
      ...validWithoutCount,
      transportRequestCount: 0,
    } as unknown as Parameters<typeof assertOriginZeroCostExecutionResult>[0]))
      .toThrow("実際のProvider HTTP送信回数を確認できません。");
  });
  it("enforces the fixed free model, one provider attempt, denied data collection, ZDR, and zero-cost routing evidence", async () => { const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { const body = JSON.parse(String(init?.body)); const headers = init?.headers as Record<string, string>; expect(body.model).toBe(ORIGIN_OPENROUTER_FREE_MODEL); expect(body.messages[0]).toEqual({ role: "system", content: "安全に回答してください。" }); expect(body.max_tokens).toBe(4096); expect(body.reasoning).toBeUndefined(); expect(body.temperature).toBe(0.2); expect(body.top_p).toBe(0.9); expect(body.usage).toEqual({ include: true }); expect(body.provider).toEqual({ allow_fallbacks: false, data_collection: "deny", zdr: true, max_price: { prompt: 0, completion: 0, request: 0 } }); expect(body.provider.only).toBeUndefined(); expect(body.provider.sort).toBeUndefined(); expect(headers["X-OpenRouter-Title"]).toBe("ORIGIN Personal"); expect(headers["X-OpenRouter-Metadata"]).toBeUndefined(); expect(headers["HTTP-Referer"]).toBe("https://myaispecials.ai.studio/"); return new Response(JSON.stringify(successfulProviderPayload()), { status: 200, headers: { "Content-Type": "application/json" } }); }); const result = await executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch); expect(result).toEqual({ text: "確認結果です。", transportRequestCount: 1, actualCostUsd: 0, providerDataPolicy: plan.providerDataPolicy, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 } }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("reports all transport sends when the provider exhausts retries", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockResolvedValue(new Response("temporary failure", { status: 503 }));
      const pending = executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch);
      const rejection = expect(pending).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        diagnostic: { transportRequestCount: 3 },
      });
      await vi.advanceTimersByTimeAsync(2_500);
      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("counts every HTTP send across a 403 policy-stage fallback", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("policy unavailable", { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(successfulProviderPayload()), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.transportRequestCount).toBe(2);
  });
  it("stops at the rate limit after a 404 policy-stage progression, without a third send", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("no matching endpoint", { status: 404 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "120" } }))
      .mockResolvedValue(new Response("must not be sent", { status: 200 }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({
        code: "PROVIDER_RATE_LIMITED",
        status: 429,
        retryable: false,
        diagnostic: { transportRequestCount: 2, upstreamStatus: 429 },
      });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("stops at the rate limit after one transient-failure retry, without further sends", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
        .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
        .mockResolvedValue(new Response("must not be sent", { status: 200 }));
      const pending = executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch);
      const rejection = expect(pending).rejects.toMatchObject({
        code: "PROVIDER_RATE_LIMITED",
        diagnostic: { transportRequestCount: 2 },
      });
      await vi.advanceTimersByTimeAsync(700);
      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("counts retry sends separately from a single logical provider execution", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(successfulProviderPayload()), { status: 200, headers: { "Content-Type": "application/json" } }));
      const pending = executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch);
      await vi.advanceTimersByTimeAsync(700);
      const result = await pending;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.transportRequestCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
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
      await expect(pending).resolves.toMatchObject({ text: "確認結果です。", actualCostUsd: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("fails closed on a non-empty length-limited answer without a continuation request", async () => { const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(successfulProviderPayload({ choices: [{ message: { content: "結論と理由の前半です。" }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0, is_byok: false } })), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: true }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("never issues a hidden continuation request when a structured answer reaches the output limit", async () => { const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(successfulProviderPayload({ choices: [{ message: { content: "## 重要点\\n\\n- 推論AI\\n- エージェントAI" }, finish_reason: "length" }] })), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("fails closed after the single bounded provider request", async () => { const fetchMock = vi.fn(async () => new Response(JSON.stringify(successfulProviderPayload({ choices: [{ message: { content: "まだ続く回答です。" }, finish_reason: "length" }] })), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: true }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("fails closed on an empty response without automatic retry", async () => { const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(successfulProviderPayload({ choices: [{ message: { content: "" }, finish_reason: "length" }] })), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", retryable: true }); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("maps a provider error embedded in a successful HTTP response", async () => { const payload = successfulProviderPayload({ choices: [{ message: { content: "" }, finish_reason: "error", error: { metadata: { error_type: "provider_unavailable" } } }] }); const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true, diagnostic: { upstreamErrorType: "provider_unavailable" } }); expect(fetchMock).toHaveBeenCalledTimes(1); });
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
  it("rejects a response when zero cost cannot be verified", async () => { const payload = successfulProviderPayload({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }); const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })); await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "synthetic-test-key" }, fetchMock as unknown as OriginFetch)).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION", retryable: false }); });
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

describe("buildOriginProviderFailureDiagnostic", () => {
  it("surfaces the per-route attempts with upstream status and raw error codes", () => {
    const error = new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, 120, {
      upstreamStatus: 429,
      upstreamErrorCode: "10023",
      transportRequestCount: 4,
      failoverAttempts: [
        { providerId: "openrouter-free", modelId: "google/gemma-4-31b-it:free", outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", upstreamStatus: 429, upstreamErrorType: "rate_limit_exceeded", transportRequestCount: 1 },
        { providerId: "cloudflare-workers-ai-free", modelId: "@cf/google/gemma-4-26b-a4b-it", outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", upstreamStatus: 429, upstreamErrorCode: "10023", transportRequestCount: 4 },
        { providerId: "groq-free", modelId: "openai/gpt-oss-120b", outcome: "skipped", skipReason: "token-budget-exceeded", transportRequestCount: 0 },
      ],
    });
    expect(buildOriginProviderFailureDiagnostic(error)).toEqual({
      upstreamStatus: 429,
      upstreamErrorCode: "10023",
      transportRequestCount: 4,
      failoverAttempts: [
        { providerId: "openrouter-free", modelId: "google/gemma-4-31b-it:free", outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", upstreamStatus: 429, upstreamErrorType: "rate_limit_exceeded", transportRequestCount: 1 },
        { providerId: "cloudflare-workers-ai-free", modelId: "@cf/google/gemma-4-26b-a4b-it", outcome: "availability-error", errorCode: "PROVIDER_RATE_LIMITED", upstreamStatus: 429, upstreamErrorCode: "10023", transportRequestCount: 4 },
        { providerId: "groq-free", modelId: "openai/gpt-oss-120b", outcome: "skipped", skipReason: "token-budget-exceeded", transportRequestCount: 0 },
      ],
    });
  });

  it("drops free-form values, unknown fields and secret-shaped data instead of passing them through", () => {
    const poisoned = {
      upstreamStatus: 429,
      upstreamErrorType: "secret-diagnostic-value",
      upstreamErrorCode: "sk-live-supersecretvalue1234567890",
      transportRequestCount: 2,
      apiKey: "sk-live-supersecretvalue1234567890",
      failoverAttempts: [
        {
          providerId: "openrouter-free",
          modelId: "google/gemma-4-31b-it:free",
          outcome: "failed",
          errorCode: "PROVIDER_UNAVAILABLE",
          skipReason: "Authorization: Bearer supersecretvalue",
          upstreamStatus: 503,
          upstreamErrorType: "private upstream sentence with spaces",
          upstreamErrorCode: "Error: quota for project supersecretvalue exhausted",
          transportRequestCount: 1,
          requestBody: "{\"messages\":[{\"content\":\"private user text\"}]}",
        },
      ],
    } as unknown as ConstructorParameters<typeof OriginProviderError>[5];
    const error = new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, poisoned);
    const summary = buildOriginProviderFailureDiagnostic(error);
    expect(summary.upstreamStatus).toBe(429);
    expect(summary.upstreamErrorType).toBeUndefined();
    expect(summary.upstreamErrorCode).toBeUndefined();
    expect(summary.failoverAttempts).toEqual([
      { providerId: "openrouter-free", modelId: "google/gemma-4-31b-it:free", outcome: "failed", errorCode: "PROVIDER_UNAVAILABLE", upstreamStatus: 503, transportRequestCount: 1 },
    ]);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("requestBody");
  });

  it("keeps only allowlisted upstream error types and provider-vocabulary error codes", () => {
    expect(safeOriginUpstreamErrorCode(10023)).toBe("10023");
    expect(safeOriginUpstreamErrorCode("4006")).toBe("4006");
    expect(safeOriginUpstreamErrorCode("rate_limit_exceeded")).toBe("rate_limit_exceeded");
    expect(safeOriginUpstreamErrorCode("Rate limit reached for model")).toBeUndefined();
    expect(safeOriginUpstreamErrorCode("sk-live-supersecretvalue1234567890")).toBeUndefined();
    expect(safeOriginUpstreamErrorCode(0)).toBeUndefined();
    expect(safeOriginUpstreamErrorCode(-1)).toBeUndefined();
    expect(safeOriginUpstreamErrorCode(undefined)).toBeUndefined();
    const typed = new OriginProviderError("PROVIDER_TIMEOUT", "無料AIの応答が時間内に返りませんでした。", 504, true, undefined, { upstreamErrorType: "timeout", transportFailure: "timeout" });
    expect(buildOriginProviderFailureDiagnostic(typed)).toEqual({ upstreamErrorType: "timeout", transportFailure: "timeout", failoverAttempts: [] });
  });
});
