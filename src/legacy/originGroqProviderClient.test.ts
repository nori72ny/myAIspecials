import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  estimateOriginGroqInputTokens,
  executeOriginGroqProvider,
  executeOriginGroqProviderStream,
  isOriginGroqQwenRotationEnabled,
  isOriginGroqRouteConfigured,
  OriginGroqPreflightError,
  ORIGIN_GROQ_ROUTE_INPUT_TOKEN_BUDGET,
  ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT,
  trimOriginGroqRouteHistory,
} from "./originGroqProviderClient";
import {
  originChatSystemInstruction,
  originGroqRouteSystemInstruction,
} from "./originChatResponsePolicy";
import { sanitizePreEgress } from "../services/securitySanitizer";
import {
  buildOriginProviderFailureDiagnostic,
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
} from "./originProviderClient";
import {
  buildOriginGroqRoutePlan,
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy";
import {
  DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG,
  ORIGIN_GROQ_FREE_MODEL_ID,
  ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
  ORIGIN_GROQ_QWEN_MODEL_ID,
  type OriginGroqFreeModelEvidence,
} from "../lib/orchestration/OriginGroqFreeModelCatalog";
import { getOriginCapacityLedgerSnapshot, resetOriginCapacityLedgerForTests } from "./originProviderCapacityLedger";

// Synthetic test fixture only; not a real credential (kept clearly fake on purpose).
const SYNTHETIC_KEY = "synthetic-groq-api-key-for-tests-only";
const NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");
const AFTER_REVIEW_MS = Date.parse("2026-12-07T00:00:00.000Z");

const groqEnv = { GROQ_API_KEY: SYNTHETIC_KEY } as NodeJS.ProcessEnv;

const primaryPlan: OriginExecutionPlan = {
  providerId: "openrouter-free",
  providerLabel: "ORIGIN 無料AI",
  modelId: ORIGIN_OPENROUTER_FREE_MODEL,
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 30_000,
  requiresOwnerApproval: false,
  reason: "test",
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  modelEvidence: { providerId: "openrouter-free", verifiedAt: "2026-11-05T09:30:00.000Z", reviewAfter: "2026-11-15T09:30:00.000Z", sourceUrl: "https://openrouter.ai/google/gemma-4-31b-it:free" },
};

function groqPlan(): OriginExecutionPlan {
  const result = buildOriginGroqRoutePlan(primaryPlan, { nowMs: NOW_MS });
  if (!result.ok) throw new Error("groq route plan must build inside the evidence window");
  return result.plan;
}

const request: OriginProviderExecutionRequest = {
  plan: groqPlan(),
  messages: [{ role: "user", content: "確認してください" }],
  systemInstruction: "安全に回答してください。",
};

function groqJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function successBody(content = "第3経路の回答です。"): Record<string, unknown> {
  return {
    model: ORIGIN_GROQ_FREE_MODEL_ID,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  };
}

describe("isOriginGroqRouteConfigured", () => {
  it("is false without a key and true with a plausible key", () => {
    expect(isOriginGroqRouteConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqRouteConfigured({ GROQ_API_KEY: "short" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqRouteConfigured(groqEnv)).toBe(true);
  });
});

describe("executeOriginGroqProvider", () => {
  it("is completely disabled without GROQ_API_KEY: preflight skip, no network", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, {} as NodeJS.ProcessEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginGroqPreflightError);
    expect((error as OriginGroqPreflightError).reason).toBe("not-configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed before sending when the evidence is stale", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: AFTER_REVIEW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginGroqPreflightError);
    expect((error as OriginGroqPreflightError).reason).toBe("evidence-stale");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips before sending when the estimated input would exceed the TPM ceiling", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const hugeRequest: OriginProviderExecutionRequest = {
      ...request,
      messages: [{ role: "user", content: "あ".repeat(20_000) }],
    };
    expect(estimateOriginGroqInputTokens(["あ".repeat(20_000)])).toBeGreaterThan(ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT);
    const error = await executeOriginGroqProvider(hugeRequest, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginGroqPreflightError);
    expect((error as OriginGroqPreflightError).reason).toBe("token-budget-exceeded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("executes once against the Groq OpenAI-compatible endpoint with the key only in the header", async () => {
    const fetchMock = vi.fn(async () => groqJson(successBody())) as unknown as OriginFetch;
    const result = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS });
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.transportRequestCount).toBe(1);
    expect(result.actualCostUsd).toBe(0);
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 40, totalTokens: 160, costUsd: 0 });
    expect(result.routingEvidence).toEqual({
      requestedModel: ORIGIN_GROQ_FREE_MODEL_ID,
      servedModel: ORIGIN_GROQ_FREE_MODEL_ID,
      strategy: "verified-free-failover",
      provider: "Groq",
      attempt: 3,
      fallbackUsed: true,
    });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_KEY);

    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
    const body = JSON.parse(String(init.body)) as { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    // taskType "review" budgets 4,096 completion tokens; the small input leaves it uncapped.
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: "確認してください" });
  });

  it("returns exactly the pre-diagnostics result shape on success (observation-only change)", async () => {
    const fetchMock = vi.fn(async () => groqJson(successBody())) as unknown as OriginFetch;
    const result = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS });
    expect(result).toEqual({
      text: "第3経路の回答です。",
      transportRequestCount: 1,
      actualCostUsd: 0,
      providerDataPolicy: request.plan.providerDataPolicy,
      routingEvidence: {
        requestedModel: ORIGIN_GROQ_FREE_MODEL_ID,
        servedModel: ORIGIN_GROQ_FREE_MODEL_ID,
        strategy: "verified-free-failover",
        provider: "Groq",
        attempt: 3,
        fallbackUsed: true,
      },
      usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160, costUsd: 0 },
    });
  });

  it("records the finish reason and usage on the diagnostic when the completion body is empty", async () => {
    // The long-input failure mode: the TPM gate compressed max_tokens, the
    // model spent the whole completion on reasoning, and the body came back
    // empty with finish_reason "length". The classification is the same
    // PROVIDER_INVALID_RESPONSE as before; only the diagnostic is new.
    const fetchMock = vi.fn(async () => groqJson({
      model: ORIGIN_GROQ_FREE_MODEL_ID,
      choices: [{ message: { content: "" }, finish_reason: "length" }],
      usage: {
        prompt_tokens: 7_400,
        completion_tokens: 620,
        total_tokens: 8_020,
        completion_tokens_details: { reasoning_tokens: 620 },
      },
    })) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error).toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", status: 502, retryable: true });
    expect((error as OriginProviderError).diagnostic).toEqual({
      finishReason: "length",
      usagePromptTokens: 7_400,
      usageCompletionTokens: 620,
      usageReasoningTokens: 620,
      transportRequestCount: 1,
    });
  });

  it("caps max_tokens so input plus completion stays under the TPM ceiling", async () => {
    const fetchMock = vi.fn(async () => groqJson(successBody())) as unknown as OriginFetch;
    const longRequest: OriginProviderExecutionRequest = {
      ...request,
      messages: [{ role: "user", content: "あ".repeat(12_000) }],
    };
    const result = await executeOriginGroqProvider(longRequest, groqEnv, fetchMock, { nowMs: NOW_MS });
    expect(result.text).toBe("第3経路の回答です。");
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse(String((calls[0] as [string, RequestInit])[1].body)) as { max_tokens: number };
    expect(body.max_tokens).toBeLessThan(4096);
    expect(body.max_tokens).toBeGreaterThanOrEqual(256);
  });

  it("maps HTTP 429 to PROVIDER_RATE_LIMITED with the transport count attached (both models rate-limited: the rotation was sent too)", async () => {
    const fetchMock = vi.fn(async () => groqJson({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, 429)) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    // The primary model was sent once, then the in-route rotation sent the
    // rotation model once; the honest transport count covers both sends.
    expect((error as OriginProviderError).diagnostic?.transportRequestCount).toBe(2);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("carries the provider's Retry-After wait on the rate-limit error", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "1800" } },
    )) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught) as OriginProviderError;
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    // The surfaced error is the rotation model's failure; its own stated
    // wait is what reaches the chat API as retryAfterSeconds.
    expect(error.retryAfterSeconds).toBe(1800);
  });

  it("accepts an HTTP-date Retry-After header", async () => {
    const retryAt = new Date(Date.now() + 30 * 60 * 1000).toUTCString();
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": retryAt } },
    )) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.retryAfterSeconds).toBeGreaterThan(29 * 60);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(30 * 60);
  });

  it("leaves retryAfterSeconds unset when the provider sends no Retry-After header", async () => {
    const fetchMock = vi.fn(async () => groqJson({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, 429)) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it("keeps the raw Groq error code in the diagnostic without the upstream message text", async () => {
    const fetchMock = vi.fn(async () => groqJson({ error: { code: "rate_limit_exceeded", message: "Rate limit reached; key gsk_syntheticsecretmaterial" } }, 429)) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught) as OriginProviderError;
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.diagnostic?.upstreamStatus).toBe(429);
    expect(error.diagnostic?.upstreamErrorCode).toBe("rate_limit_exceeded");
    expect(JSON.stringify(error.diagnostic)).not.toContain("gsk_syntheticsecretmaterial");
  });

  it("fails closed when the served model identity differs from the fixed free model", async () => {
    const fetchMock = vi.fn(async () => groqJson({ ...successBody(), model: "openai/gpt-oss-20b" })) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_ROUTING_UNVERIFIED");
  });

  it("rejects a plan that relaxes the ZDR data policy before any network call", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const relaxedRequest: OriginProviderExecutionRequest = {
      ...request,
      plan: {
        ...groqPlan(),
        providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: false },
      },
    };
    const error = await executeOriginGroqProvider(relaxedRequest, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_POLICY_VIOLATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps required-tool requests off this route", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const toolRequest: OriginProviderExecutionRequest = { ...request, requiredTool: { name: "lookup", description: "test", parameters: {} } };
    const error = await executeOriginGroqProvider(toolRequest, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_POLICY_VIOLATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The production-assembled standard instruction measured on the production code
// path (RATE_LIMIT_COUNTERMEASURES_2026-11-08 §1.3): the base instruction plus the
// intent / requirement / work-plan / assignment / quality guidance blocks.
function productionAssembledInstruction(): string {
  const base = originChatSystemInstruction();
  const padding = "x".repeat(Math.max(0, 15_713 - base.length));
  return `${base}\n\n${padding}`;
}

describe("executeOriginGroqProvider analyzer reasoning bound (Basel diagnosis 2026-11-26, 案B)", () => {
  const bodyOf = async (marked: OriginProviderExecutionRequest) => {
    const fetchMock = vi.fn(async () => groqJson(successBody())) as unknown as OriginFetch;
    await executeOriginGroqProvider(marked, groqEnv, fetchMock, { nowMs: NOW_MS });
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    return JSON.parse(String((calls[0] as [string, RequestInit])[1].body)) as { model: string; reasoning_effort?: string };
  };

  it("sends reasoning_effort low to gpt-oss for an analyzer-marked request", async () => {
    // The Basel failure shape: an analyzer chunk call whose
    // unbounded gpt-oss reasoning ate the completion budget and
    // returned an empty body. The mark is the capacity-allocation
    // hint only agent chunk calls carry.
    const body = await bodyOf({ ...request, groqCapacityAllocation: "agent-analyzer-chunk" });
    expect(body.model).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(body.reasoning_effort).toBe("low");
  });

  it("sends reasoning_effort low for the primary-first analyzer mark too", async () => {
    const body = await bodyOf({ ...request, groqCapacityAllocation: "agent-analyzer-chunk-primary" });
    expect(body.model).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(body.reasoning_effort).toBe("low");
  });

  it("sends no reasoning_effort to gpt-oss for an unmarked request", async () => {
    const body = await bodyOf(request);
    expect(body.model).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(body.reasoning_effort).toBeUndefined();
  });
});

describe("executeOriginGroqProvider route activation (compact instruction)", () => {
  it("regression: the production-assembled standard instruction alone still skips before sending", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const standardRequest: OriginProviderExecutionRequest = {
      ...request,
      systemInstruction: productionAssembledInstruction(),
      messages: [{ role: "user", content: "日本の首都はどこですか？" }],
    };
    const error = await executeOriginGroqProvider(standardRequest, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginGroqPreflightError);
    expect((error as OriginGroqPreflightError).reason).toBe("token-budget-exceeded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the shortest question when the compact route instruction is carried, using it as the system message", async () => {
    const fetchMock = vi.fn(async () => groqJson(successBody("東京です。"))) as unknown as OriginFetch;
    const activatedRequest: OriginProviderExecutionRequest = {
      ...request,
      systemInstruction: productionAssembledInstruction(),
      groqSystemInstruction: originGroqRouteSystemInstruction(),
      messages: [{ role: "user", content: "日本の首都はどこですか？" }],
    };
    const result = await executeOriginGroqProvider(activatedRequest, groqEnv, fetchMock, { nowMs: NOW_MS });
    expect(result.text).toBe("東京です。");
    expect(result.routingEvidence.provider).toBe("Groq");

    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String((calls[0] as [string, RequestInit])[1].body)) as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    // The payload carries the compact substitute, not the 15,713-character original.
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(sanitizePreEgress(originGroqRouteSystemInstruction()));
    expect(body.messages[0].content.length).toBeLessThanOrEqual(6_700); // I-4: compact budget 3,800 (INTENT_I4_DESIGN_2026-11-21); CB-4: raised to 4,800 (CODEBENCH_CB4_DESIGN_2026-11-23); CB-5: raised to 5,600 (CODEBENCH_CB5_DESIGN_2026-11-23); CB-6: raised to 6,000 (CODEBENCH_CB6_DESIGN_2026-11-25); CB-7: raised to 6,200 (CODE_E05_E02_DIAGNOSIS_2026-11-26); V-1: raised to 6,700 (CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27)
    expect(body.messages[1]).toEqual({ role: "user", content: "日本の首都はどこですか？" });
    // The gate math on the sent payload: estimated input plus the granted completion
    // stays under the tokens/minute ceiling, with real headroom (not the old 129).
    const estimatedInput = estimateOriginGroqInputTokens(body.messages.map((message) => message.content));
    expect(estimatedInput + body.max_tokens).toBeLessThanOrEqual(ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT);
    expect(body.max_tokens).toBeGreaterThanOrEqual(1_024);
  });

  it("trims long history oldest-first so a standard long conversation still sends", async () => {
    const fetchMock = vi.fn(async () => groqJson(successBody())) as unknown as OriginFetch;
    const history = Array.from({ length: 11 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `履歴${index} ` + "あ".repeat(2_000),
    }));
    const longHistoryRequest: OriginProviderExecutionRequest = {
      ...request,
      groqSystemInstruction: originGroqRouteSystemInstruction(),
      messages: [...history, { role: "user", content: "では、その続きを教えてください。" }],
    };
    // Without trimming this payload estimates far above the ceiling and would skip.
    expect(
      estimateOriginGroqInputTokens([
        originGroqRouteSystemInstruction(),
        ...longHistoryRequest.messages.map((message) => message.content),
      ]),
    ).toBeGreaterThan(ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT);

    const result = await executeOriginGroqProvider(longHistoryRequest, groqEnv, fetchMock, { nowMs: NOW_MS });
    expect(result.text).toBe("第3経路の回答です。");
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String((calls[0] as [string, RequestInit])[1].body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const sentContents = body.messages.map((message) => message.content);
    // The current user turn always survives; the oldest history is what was dropped.
    expect(sentContents[sentContents.length - 1]).toBe("では、その続きを教えてください。");
    expect(sentContents.some((content) => content.startsWith("履歴0 "))).toBe(false);
    expect(sentContents.some((content) => content.startsWith("履歴10 "))).toBe(true);
    expect(body.messages.length).toBeLessThan(1 + longHistoryRequest.messages.length);
    expect(estimateOriginGroqInputTokens(sentContents)).toBeLessThanOrEqual(ORIGIN_GROQ_ROUTE_INPUT_TOKEN_BUDGET);
    // The caller's window is not mutated by route-3 trimming.
    expect(longHistoryRequest.messages).toHaveLength(12);
  });

  it("still skips when the final user message alone exceeds the ceiling, compact instruction notwithstanding", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const hugeTurnRequest: OriginProviderExecutionRequest = {
      ...request,
      groqSystemInstruction: originGroqRouteSystemInstruction(),
      messages: [
        { role: "assistant", content: "承知しました。" },
        { role: "user", content: "あ".repeat(20_000) },
      ],
    };
    const error = await executeOriginGroqProvider(hugeTurnRequest, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginGroqPreflightError);
    expect((error as OriginGroqPreflightError).reason).toBe("token-budget-exceeded");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("executeOriginGroqProvider in-route model rotation", () => {
  const rotationSuccessBody = (content = "第3経路（持ち回り先）の回答です。"): Record<string, unknown> => ({
    model: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 110, completion_tokens: 30, total_tokens: 140 },
  });
  const rateLimitResponse = () => groqJson({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, 429);
  function sequencedFetch(steps: Array<() => Response>): OriginFetch {
    let index = 0;
    return vi.fn(async () => {
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      return step();
    }) as unknown as OriginFetch;
  }

  it("rotates to gpt-oss-20b after the primary model is rate-limited and serves its answer", async () => {
    const fetchMock = sequencedFetch([rateLimitResponse, () => groqJson(rotationSuccessBody())]);
    const result = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS });
    expect(result.text).toBe("第3経路（持ち回り先）の回答です。");
    expect(result.transportRequestCount).toBe(2);
    expect(result.actualCostUsd).toBe(0);
    expect(result.routingEvidence).toEqual({
      requestedModel: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
      servedModel: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
      strategy: "verified-free-failover",
      provider: "Groq",
      attempt: 3,
      fallbackUsed: true,
    });
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const firstBody = JSON.parse(String((calls[0] as [string, RequestInit])[1].body)) as { model: string };
    const secondBody = JSON.parse(String((calls[1] as [string, RequestInit])[1].body)) as { model: string };
    expect(firstBody.model).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(secondBody.model).toBe(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID);
  });

  it("rotates after an upstream 503 overload response", async () => {
    const fetchMock = sequencedFetch([
      () => groqJson({ error: { code: "service_unavailable", message: "Service unavailable" } }, 503),
      () => groqJson(rotationSuccessBody()),
    ]);
    const result = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS });
    expect(result.text).toBe("第3経路（持ち回り先）の回答です。");
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID);
    expect(result.transportRequestCount).toBe(2);
  });

  it("does not rotate on an auth failure", async () => {
    const fetchMock = vi.fn(async () => groqJson({ error: { code: "invalid_api_key", message: "Invalid API key" } }, 401)) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_NOT_CONFIGURED");
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("does not rotate when the primary response fails served-model verification", async () => {
    const fetchMock = vi.fn(async () => groqJson({ ...successBody(), model: "openai/gpt-oss-safeguard-20b" })) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_ROUTING_UNVERIFIED");
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("holds the rotation model to the same served-model identity standard", async () => {
    const fetchMock = sequencedFetch([
      rateLimitResponse,
      // Answers as the primary model although the rotation model was requested.
      () => groqJson(successBody()),
    ]);
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_ROUTING_UNVERIFIED");
    expect((error as OriginProviderError).diagnostic?.transportRequestCount).toBe(2);
  });

  it("does not rotate when the rotation model's evidence is stale, surfacing the primary failure after one send", async () => {
    const staleRotationCatalog: OriginGroqFreeModelEvidence[] = DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG.map((entry) =>
      entry.modelId === ORIGIN_GROQ_FREE_ROTATION_MODEL_ID
        ? { ...entry, verifiedAt: "2026-10-25T00:00:00.000Z", reviewAfter: "2026-11-05T00:00:00.000Z" }
        : entry);
    const fetchMock = vi.fn(async () => rateLimitResponse()) as unknown as OriginFetch;
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: NOW_MS, catalog: staleRotationCatalog })
      .catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    expect((error as OriginProviderError).diagnostic?.transportRequestCount).toBe(1);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("isOriginGroqQwenRotationEnabled (kill switch, default OFF)", () => {
  it("is false when unset and for every value except the exact string 'true'", () => {
    expect(isOriginGroqQwenRotationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqQwenRotationEnabled({ ORIGIN_GROQ_QWEN_ROTATION_ENABLED: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqQwenRotationEnabled({ ORIGIN_GROQ_QWEN_ROTATION_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqQwenRotationEnabled({ ORIGIN_GROQ_QWEN_ROTATION_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqQwenRotationEnabled({ ORIGIN_GROQ_QWEN_ROTATION_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("executeOriginGroqProvider qwen second rotation stage", () => {
  // Inside all three evidence windows: gpt-oss entries run 2026-11-22 to
  // 2026-12-06, the qwen entry runs 2026-11-10 to 2026-12-10.
  const QWEN_NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");
  const qwenEnv = { GROQ_API_KEY: SYNTHETIC_KEY, ORIGIN_GROQ_QWEN_ROTATION_ENABLED: "true" } as NodeJS.ProcessEnv;
  const qwenSuccessBody = (content = "第3経路（第2ローテーション先）の回答です。"): Record<string, unknown> => ({
    model: ORIGIN_GROQ_QWEN_MODEL_ID,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 110, completion_tokens: 30, total_tokens: 140 },
  });
  const rateLimitResponse = () => groqJson({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, 429);
  function sequencedFetch(steps: Array<() => Response>): OriginFetch {
    let index = 0;
    return vi.fn(async () => {
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      return step();
    }) as unknown as OriginFetch;
  }

  it("stays off by default: both gpt-oss models rate-limited means two sends and the rotation failure, no qwen attempt", async () => {
    const fetchMock = sequencedFetch([rateLimitResponse, rateLimitResponse, () => groqJson(qwenSuccessBody())]);
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock, { nowMs: QWEN_NOW_MS })
      .catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    expect((error as OriginProviderError).diagnostic?.transportRequestCount).toBe(2);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("rotates to qwen last when enabled and both gpt-oss models are rate-limited, sending reasoning_effort none only to qwen", async () => {
    const fetchMock = sequencedFetch([rateLimitResponse, rateLimitResponse, () => groqJson(qwenSuccessBody())]);
    const result = await executeOriginGroqProvider(request, qwenEnv, fetchMock, { nowMs: QWEN_NOW_MS });
    expect(result.text).toBe("第3経路（第2ローテーション先）の回答です。");
    expect(result.transportRequestCount).toBe(3);
    expect(result.actualCostUsd).toBe(0);
    expect(result.routingEvidence).toEqual({
      requestedModel: ORIGIN_GROQ_QWEN_MODEL_ID,
      servedModel: ORIGIN_GROQ_QWEN_MODEL_ID,
      strategy: "verified-free-failover",
      provider: "Groq",
      attempt: 3,
      fallbackUsed: true,
    });
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(3);
    const bodies = calls.map((call) => JSON.parse(String((call as [string, RequestInit])[1].body)) as { model: string; reasoning_effort?: string });
    expect(bodies[0].model).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(bodies[0].reasoning_effort).toBeUndefined();
    expect(bodies[1].model).toBe(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID);
    expect(bodies[1].reasoning_effort).toBeUndefined();
    expect(bodies[2].model).toBe(ORIGIN_GROQ_QWEN_MODEL_ID);
    expect(bodies[2].reasoning_effort).toBe("none");
  });

  it("does not reach for qwen when the first rotation fails with a non-trigger error", async () => {
    const fetchMock = sequencedFetch([
      rateLimitResponse,
      () => groqJson({ error: { code: "invalid_api_key", message: "Invalid API key" } }, 401),
      () => groqJson(qwenSuccessBody()),
    ]);
    const error = await executeOriginGroqProvider(request, qwenEnv, fetchMock, { nowMs: QWEN_NOW_MS })
      .catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_NOT_CONFIGURED");
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("fails closed per model: stale qwen evidence surfaces the first rotation failure after two sends", async () => {
    const staleQwenCatalog: OriginGroqFreeModelEvidence[] = DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG.map((entry) =>
      entry.modelId === ORIGIN_GROQ_QWEN_MODEL_ID
        ? { ...entry, verifiedAt: "2026-10-26T00:00:00.000Z", reviewAfter: "2026-11-05T00:00:00.000Z" }
        : entry);
    const fetchMock = sequencedFetch([rateLimitResponse, rateLimitResponse, () => groqJson(qwenSuccessBody())]);
    const error = await executeOriginGroqProvider(request, qwenEnv, fetchMock, { nowMs: QWEN_NOW_MS, catalog: staleQwenCatalog })
      .catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    expect((error as OriginProviderError).diagnostic?.transportRequestCount).toBe(2);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("holds qwen to the same served-model identity standard", async () => {
    const fetchMock = sequencedFetch([
      rateLimitResponse,
      rateLimitResponse,
      // Answers as the primary model although qwen was requested.
      () => groqJson(successBody()),
    ]);
    const error = await executeOriginGroqProvider(request, qwenEnv, fetchMock, { nowMs: QWEN_NOW_MS })
      .catch((caught: unknown) => caught);
    expect((error as OriginProviderError).code).toBe("PROVIDER_ROUTING_UNVERIFIED");
    expect((error as OriginProviderError).diagnostic?.transportRequestCount).toBe(3);
  });
});

describe("trimOriginGroqRouteHistory", () => {
  const system = "s".repeat(1_000);

  it("returns the history unchanged when it already fits the route budget", () => {
    const messages = [
      { role: "user" as const, content: "質問です" },
      { role: "assistant" as const, content: "回答です" },
      { role: "user" as const, content: "次の質問です" },
    ];
    expect(trimOriginGroqRouteHistory(messages, system)).toEqual(messages);
  });

  it("drops oldest messages first and keeps the most recent ones", () => {
    const messages = Array.from({ length: 6 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${index}-` + "a".repeat(2_000),
    }));
    const trimmed = trimOriginGroqRouteHistory(messages, system);
    expect(trimmed.length).toBeLessThan(messages.length);
    expect(trimmed[trimmed.length - 1]).toEqual(messages[messages.length - 1]);
    expect(trimmed[0]).not.toEqual(messages[0]);
    expect(
      estimateOriginGroqInputTokens([system, ...trimmed.map((message) => message.content)]),
    ).toBeLessThanOrEqual(ORIGIN_GROQ_ROUTE_INPUT_TOKEN_BUDGET);
  });

  it("always keeps the final message even when it alone exceeds the budget", () => {
    const messages = [
      { role: "assistant" as const, content: "前の回答" },
      { role: "user" as const, content: "あ".repeat(20_000) },
    ];
    expect(trimOriginGroqRouteHistory(messages, system)).toEqual([messages[1]]);
  });

  it("handles an empty history", () => {
    expect(trimOriginGroqRouteHistory([], system)).toEqual([]);
  });
});

describe("executeOriginGroqProviderStream", () => {
  const streamEncoder = new TextEncoder();
  function groqSseResponse(parts: string[], status = 200) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(streamEncoder.encode(part));
        controller.close();
      },
    });
    return new Response(body, { status, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  }
  const groqEvent = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  const contentChunk = (model: string, content: string) => groqEvent({ model, choices: [{ delta: { content }, finish_reason: null }] });

  function successStream(model: string = ORIGIN_GROQ_FREE_MODEL_ID, fragments: string[] = ["第3", "経路の", "回答です。"]) {
    return groqSseResponse([
      ...fragments.map((fragment) => contentChunk(model, fragment)),
      groqEvent({ model, choices: [{ delta: {}, finish_reason: "stop" }] }),
      groqEvent({ model, choices: [], usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 } }),
      "data: [DONE]\n\n",
    ]);
  }

  it("forwards each fragment as it arrives in incremental release mode and returns the joined text", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
      expect(body.model).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
      return successStream();
    });
    const deltas: string[] = [];
    const result = await executeOriginGroqProviderStream(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    );
    expect(deltas).toEqual(["第3", "経路の", "回答です。"]);
    expect(result.text).toBe("第3経路の回答です。");
    expect(result.transportRequestCount).toBe(1);
    expect(result.routingEvidence).toEqual(expect.objectContaining({
      provider: "Groq",
      servedModel: ORIGIN_GROQ_FREE_MODEL_ID,
      attempt: 3,
      fallbackUsed: true,
    }));
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 40, totalTokens: 160, costUsd: 0 });
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
    const pending = executeOriginGroqProviderStream(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    );
    await vi.waitFor(() => { expect(streamController).toBeDefined(); });
    streamController!.enqueue(streamEncoder.encode(contentChunk(ORIGIN_GROQ_FREE_MODEL_ID, "最初の")));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(deltas).toEqual(["最初の"]);
    streamController!.enqueue(streamEncoder.encode(contentChunk(ORIGIN_GROQ_FREE_MODEL_ID, "断片です。")));
    streamController!.enqueue(streamEncoder.encode(groqEvent({ model: ORIGIN_GROQ_FREE_MODEL_ID, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })));
    streamController!.enqueue(streamEncoder.encode("data: [DONE]\n\n"));
    streamController!.close();
    const result = await pending;
    expect(result.text).toBe("最初の断片です。");
    expect(deltas).toEqual(["最初の", "断片です。"]);
  });

  it("holds all text until the stream terminates in hold mode and releases it once", async () => {
    const fetchMock = vi.fn(async () => successStream(ORIGIN_GROQ_FREE_MODEL_ID, ["保持", "対象の回答"]));
    const deltas: string[] = [];
    const result = await executeOriginGroqProviderStream(
      request,
      { onDelta: (text) => deltas.push(text) },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    );
    expect(deltas).toEqual(["保持対象の回答"]);
    expect(result.text).toBe("保持対象の回答");
  });

  it("rejects a substituted served model mid-stream before forwarding its content", async () => {
    const fetchMock = vi.fn(async () => groqSseResponse([
      contentChunk(ORIGIN_GROQ_FREE_MODEL_ID, "正規の"),
      contentChunk("paid-or-substituted-model", "混入テキスト"),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    await expect(executeOriginGroqProviderStream(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    )).rejects.toMatchObject({ code: "PROVIDER_ROUTING_UNVERIFIED", retryable: false });
    expect(deltas).toEqual(["正規の"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rotates to the second model when the first is rate-limited before any fragment", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.model === ORIGIN_GROQ_FREE_MODEL_ID) {
        return groqJson({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, 429);
      }
      return successStream(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, ["回転後の", "回答です。"]);
    });
    const deltas: string[] = [];
    const result = await executeOriginGroqProviderStream(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    );
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID);
    expect(result.text).toBe("回転後の回答です。");
    expect(deltas).toEqual(["回転後の", "回答です。"]);
    expect(result.transportRequestCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rotates when an in-stream rate-limit error arrives before any fragment", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.model === ORIGIN_GROQ_FREE_MODEL_ID) {
        return groqSseResponse([
          groqEvent({ error: { code: "rate_limit_exceeded", type: "tokens", message: "Rate limit reached" } }),
        ]);
      }
      return successStream(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, ["回転後の回答です。"]);
    });
    const result = await executeOriginGroqProviderStream(
      { ...request, streamRelease: "incremental" },
      { onDelta: () => undefined },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    );
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never rotates after a fragment was released, even on a rotation-trigger failure", async () => {
    const fetchMock = vi.fn(async () => groqSseResponse([
      contentChunk(ORIGIN_GROQ_FREE_MODEL_ID, "表示済みの"),
      groqEvent({ error: { code: "rate_limit_exceeded", type: "tokens", message: "Rate limit reached" } }),
    ]));
    const deltas: string[] = [];
    await expect(executeOriginGroqProviderStream(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => deltas.push(text) },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    )).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", diagnostic: { transportRequestCount: 1 } });
    // A rotation would re-send the request and duplicate the displayed
    // fragment; the failure is surfaced instead.
    expect(deltas).toEqual(["表示済みの"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records an empty-content breakdown with finish reason and usage when reasoning consumes the whole completion", async () => {
    // The diagnosed long-input failure as an SSE fixture: the model is
    // named and the stream terminates cleanly, but no content delta ever
    // arrives — the finish reason is "length" and every completion token
    // was spent on reasoning. Before the diagnostics existed this was a
    // bare PROVIDER_INVALID_RESPONSE with no way to confirm the mechanism.
    const fetchMock = vi.fn(async () => groqSseResponse([
      groqEvent({ model: ORIGIN_GROQ_FREE_MODEL_ID, choices: [{ delta: {}, finish_reason: null }] }),
      groqEvent({ model: ORIGIN_GROQ_FREE_MODEL_ID, choices: [{ delta: {}, finish_reason: "length" }] }),
      groqEvent({
        model: ORIGIN_GROQ_FREE_MODEL_ID,
        choices: [],
        usage: {
          prompt_tokens: 7_400,
          completion_tokens: 620,
          total_tokens: 8_020,
          completion_tokens_details: { reasoning_tokens: 620 },
        },
      }),
      "data: [DONE]\n\n",
    ]));
    const error = await executeOriginGroqProviderStream(
      request,
      { onDelta: () => undefined },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error).toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", status: 502, retryable: true });
    expect((error as OriginProviderError).diagnostic).toEqual({
      streamFailure: "empty-content",
      finishReason: "length",
      usagePromptTokens: 7_400,
      usageCompletionTokens: 620,
      usageReasoningTokens: 620,
      transportRequestCount: 1,
    });
    // The breakdown reaches the surfaced failure diagnostic (the log line
    // and the failure response) unchanged: numbers and fixed codes only.
    expect(buildOriginProviderFailureDiagnostic(error as OriginProviderError)).toEqual({
      streamFailure: "empty-content",
      finishReason: "length",
      usagePromptTokens: 7_400,
      usageCompletionTokens: 620,
      usageReasoningTokens: 620,
      transportRequestCount: 1,
      failoverAttempts: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records a no-done breakdown when the stream ends without its [DONE] terminator", async () => {
    const fetchMock = vi.fn(async () => groqSseResponse([
      contentChunk(ORIGIN_GROQ_FREE_MODEL_ID, "途中で切れた"),
      groqEvent({ model: ORIGIN_GROQ_FREE_MODEL_ID, choices: [{ delta: {}, finish_reason: "stop" }] }),
    ]));
    const error = await executeOriginGroqProviderStream(
      request,
      { onDelta: () => undefined },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error).toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", status: 502, retryable: true });
    // Termination outranks content in the breakdown: text did arrive, but
    // the stream never terminated, and no usage was ever reported.
    expect((error as OriginProviderError).diagnostic).toEqual({
      streamFailure: "no-done",
      finishReason: "stop",
      usagePromptTokens: 0,
      usageCompletionTokens: 0,
      transportRequestCount: 1,
    });
  });

  it("records a no-model breakdown when no chunk ever names the served model", async () => {
    const fetchMock = vi.fn(async () => groqSseResponse([
      groqEvent({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      groqEvent({ choices: [], usage: { prompt_tokens: 90, completion_tokens: 12, total_tokens: 102 } }),
      "data: [DONE]\n\n",
    ]));
    const error = await executeOriginGroqProviderStream(
      request,
      { onDelta: () => undefined },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error).toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", status: 502, retryable: true });
    expect((error as OriginProviderError).diagnostic).toEqual({
      streamFailure: "no-model",
      finishReason: "stop",
      usagePromptTokens: 90,
      usageCompletionTokens: 12,
      transportRequestCount: 1,
    });
  });

  it("returns exactly the pre-diagnostics result shape on a successful stream", async () => {
    const fetchMock = vi.fn(async () => successStream());
    const result = await executeOriginGroqProviderStream(
      request,
      { onDelta: () => undefined },
      groqEnv,
      fetchMock as unknown as OriginFetch,
      { nowMs: NOW_MS },
    );
    expect(result).toEqual({
      text: "第3経路の回答です。",
      transportRequestCount: 1,
      actualCostUsd: 0,
      providerDataPolicy: request.plan.providerDataPolicy,
      routingEvidence: {
        requestedModel: ORIGIN_GROQ_FREE_MODEL_ID,
        servedModel: ORIGIN_GROQ_FREE_MODEL_ID,
        strategy: "verified-free-failover",
        provider: "Groq",
        attempt: 3,
        fallbackUsed: true,
      },
      usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160, costUsd: 0 },
    });
  });

  it("is completely disabled without GROQ_API_KEY, exactly like the blocking executor", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;
    const error = await executeOriginGroqProviderStream(request, { onDelta: () => undefined }, {} as NodeJS.ProcessEnv, fetchMock, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginGroqPreflightError);
    expect((error as OriginGroqPreflightError).reason).toBe("not-configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Groq rate-limit header observation (capacity D-0)", () => {
  const EXPECTED_SNAPSHOT = {
    limitRequests: 1000,
    remainingRequests: 999,
    limitTokens: 200000,
    remainingTokens: 199500,
    resetRequestsSeconds: 2,
    resetTokensSeconds: 0.5,
  };

  beforeEach(() => {
    resetOriginCapacityLedgerForTests();
  });

  function groqJsonWithRateLimitHeaders(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "x-ratelimit-limit-requests": "1000",
        "x-ratelimit-remaining-requests": "999",
        "x-ratelimit-limit-tokens": "200000",
        "x-ratelimit-remaining-tokens": "199500",
        "x-ratelimit-reset-requests": "2s",
        "x-ratelimit-reset-tokens": "0.5s",
      },
    });
  }

  it("attaches the reported snapshot to a blocking success and records it in the ledger", async () => {
    const fetchMock = vi.fn(async () => groqJsonWithRateLimitHeaders(successBody()));
    const result = await executeOriginGroqProvider(request, groqEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS });
    expect(result.rateLimit).toEqual(EXPECTED_SNAPSHOT);
    const entry = getOriginCapacityLedgerSnapshot().rateLimits.find((candidate) => candidate.modelId === ORIGIN_GROQ_FREE_MODEL_ID);
    expect(entry).toMatchObject({ providerId: "groq-free", source: "observed", limitHit: false, snapshot: EXPECTED_SNAPSHOT });
  });

  it("records a limit hit and carries the snapshot on the failure diagnostic when the route is rate limited", async () => {
    const fetchMock = vi.fn(async () => groqJsonWithRateLimitHeaders({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, 429));
    const error = await executeOriginGroqProvider(request, groqEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.diagnostic?.rateLimit).toEqual(EXPECTED_SNAPSHOT);
    const entry = getOriginCapacityLedgerSnapshot().rateLimits.find((candidate) => candidate.modelId === ORIGIN_GROQ_FREE_MODEL_ID);
    expect(entry).toMatchObject({ limitHit: true, snapshot: EXPECTED_SNAPSHOT });
  });

  it("leaves the result without a snapshot when the response reports no rate-limit headers", async () => {
    const fetchMock = vi.fn(async () => groqJson(successBody()));
    const result = await executeOriginGroqProvider(request, groqEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS });
    expect(result.rateLimit).toBeUndefined();
    expect(getOriginCapacityLedgerSnapshot().rateLimits).toEqual([]);
  });

  it("attaches the reported snapshot to a streaming success", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model: ORIGIN_GROQ_FREE_MODEL_ID, choices: [{ delta: { content: "第3経路の回答です。" }, finish_reason: null }] })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model: ORIGIN_GROQ_FREE_MODEL_ID, choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "x-ratelimit-remaining-requests": "999", "x-ratelimit-reset-requests": "2s" },
    }));
    const result = await executeOriginGroqProviderStream(request, { onDelta: () => undefined }, groqEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS });
    expect(result.rateLimit).toEqual({ remainingRequests: 999, resetRequestsSeconds: 2 });
  });
});

describe("Groq deck completion-budget floor (DOCUMENT_WAVE2 unit 3)", () => {
  beforeEach(() => {
    resetOriginCapacityLedgerForTests();
  });

  const captureBody = async (deckRequest: OriginProviderExecutionRequest) => {
    const fetchMock = vi.fn(async () => groqJson(successBody())) as unknown as OriginFetch;
    await executeOriginGroqProvider(deckRequest, groqEnv, fetchMock, { nowMs: NOW_MS });
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    return JSON.parse(String((calls[0] as [string, RequestInit])[1].body)) as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
  };

  it("guarantees the 4,096 completion floor for deck requests by trimming the input harder", async () => {
    // Six ~1,004-token messages (~6,034 estimated input tokens with the
    // system instruction): the standard 6,000 input budget keeps five
    // and leaves under 3,000 completion tokens; the deck input budget
    // (3,904) keeps three and restores the full floor.
    const history = Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: "あ".repeat(2_000),
    }));
    const baseRequest: OriginProviderExecutionRequest = { ...request, messages: history };

    const standard = await captureBody(baseRequest);
    expect(standard.max_tokens).toBeLessThan(4_096);
    expect(standard.messages).toHaveLength(6);

    const deck = await captureBody({ ...baseRequest, deckRequest: true });
    expect(deck.max_tokens).toBe(4_096);
    expect(deck.messages).toHaveLength(4);
    // The final message (the current user turn) is always kept.
    expect(deck.messages[deck.messages.length - 1].content).toBe("あ".repeat(2_000));
  });

  it("raises the completion budget up to the floor when the task-type budget is lower", async () => {
    // taskType "test" falls in the 2,400 default budget class.
    const lowBudgetRequest: OriginProviderExecutionRequest = {
      ...request,
      plan: { ...groqPlan(), taskType: "test" },
    };
    const standard = await captureBody(lowBudgetRequest);
    expect(standard.max_tokens).toBe(2_400);
    const deck = await captureBody({ ...lowBudgetRequest, deckRequest: true });
    expect(deck.max_tokens).toBe(4_096);
  });

  it("leaves a small deck request's payload shape otherwise unchanged", async () => {
    const standard = await captureBody(request);
    const deck = await captureBody({ ...request, deckRequest: true });
    // taskType "review" already budgets 4,096 and the input is small:
    // the floor changes nothing.
    expect(deck.max_tokens).toBe(standard.max_tokens);
    expect(deck.messages).toEqual(standard.messages);
  });
});
