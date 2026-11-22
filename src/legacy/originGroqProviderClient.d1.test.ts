// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeOriginGroqProvider,
  type OriginGroqExecutionOptions,
} from "./originGroqProviderClient";
import {
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
} from "./originProviderClient";
import {
  recordOriginProviderPacingSend,
  resetOriginProviderPacingForTests,
} from "./originProviderPacing";
import { resetOriginCapacityLedgerForTests } from "./originProviderCapacityLedger";
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

/**
 * Stage D-1 (FREE_CAPACITY_EXPANSION_DESIGN_2026-11-22): planned
 * allocation of analyzer chunk calls onto the rotation model's bucket,
 * plus per-model pacing. The request below estimates to 18 input tokens
 * and the "review" completion budget is 4,096, so one send's pacing
 * footprint is 4,114 against a safety line of 6,400 (80% of 8,000).
 */

// Synthetic test fixture only; not a real credential (kept clearly fake on purpose).
const SYNTHETIC_KEY = "synthetic-groq-api-key-for-tests-only";
const NOW_MS = Date.parse("2026-11-17T12:00:00.000Z");

const KEY_FIELD = "GROQ" + "_API_KEY";
const groqEnv = { [KEY_FIELD]: SYNTHETIC_KEY } as NodeJS.ProcessEnv;
const d1Env = { [KEY_FIELD]: SYNTHETIC_KEY, ORIGIN_GROQ_PACING_ALLOCATION_ENABLED: "true" } as NodeJS.ProcessEnv;

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

const analyzerRequest: OriginProviderExecutionRequest = {
  ...request,
  groqCapacityAllocation: "agent-analyzer-chunk",
};

function groqJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function successBody(model: string, content = "回答です。"): Record<string, unknown> {
  return {
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  };
}

const rateLimitResponse = () => groqJson({ error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, 429);

/** A fetch that answers per requested model and records the model order. */
function modelRoutingFetch(handler: (model: string) => Response): { fetchMock: OriginFetch; models: string[] } {
  const models: string[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init: { body: string }) => {
    const model = (JSON.parse(init.body) as { model: string }).model;
    models.push(model);
    return handler(model);
  }) as unknown as OriginFetch;
  return { fetchMock, models };
}

let pacingNow = NOW_MS;
let sleeps: number[] = [];

function pacingOptions(extra: Partial<OriginGroqExecutionOptions> = {}): OriginGroqExecutionOptions {
  return {
    nowMs: NOW_MS,
    pacingNowMs: () => pacingNow,
    pacingSleepMs: async (ms: number) => {
      sleeps.push(ms);
      pacingNow += ms;
    },
    ...extra,
  };
}

beforeEach(() => {
  resetOriginProviderPacingForTests();
  resetOriginCapacityLedgerForTests();
  pacingNow = NOW_MS;
  sleeps = [];
});

describe("executeOriginGroqProvider D-1 allocation (switch and hint gating)", () => {
  it("with the switch OFF, a marked request keeps the standard cascade exactly (primary first)", async () => {
    const { fetchMock, models } = modelRoutingFetch((model) => groqJson(successBody(model)));
    const result = await executeOriginGroqProvider(analyzerRequest, groqEnv, fetchMock, pacingOptions());
    expect(models).toEqual([ORIGIN_GROQ_FREE_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(sleeps).toEqual([]);
  });

  it("with the switch ON, an unmarked request (direct chat) is never allocated or paced", async () => {
    const { fetchMock, models } = modelRoutingFetch((model) => groqJson(successBody(model)));
    const result = await executeOriginGroqProvider(request, d1Env, fetchMock, pacingOptions());
    expect(models).toEqual([ORIGIN_GROQ_FREE_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(sleeps).toEqual([]);
  });

  it("with the switch ON, a marked request is planned onto the rotation model's bucket first", async () => {
    const { fetchMock, models } = modelRoutingFetch((model) => groqJson(successBody(model)));
    const result = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, pacingOptions());
    expect(models).toEqual([ORIGIN_GROQ_FREE_ROTATION_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID);
    expect(result.transportRequestCount).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("falls back to the standard cascade when the rotation model's evidence is stale", async () => {
    const staleCatalog: OriginGroqFreeModelEvidence[] = DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG.map((entry) => (
      entry.modelId === ORIGIN_GROQ_FREE_ROTATION_MODEL_ID
        ? { ...entry, verifiedAt: "2026-11-01T00:00:00.000Z", reviewAfter: "2026-11-10T00:00:00.000Z" }
        : entry
    ));
    const { fetchMock, models } = modelRoutingFetch((model) => groqJson(successBody(model)));
    const result = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, pacingOptions({ catalog: staleCatalog }));
    expect(models).toEqual([ORIGIN_GROQ_FREE_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
  });
});

describe("executeOriginGroqProvider D-1 allocated cascade failure semantics", () => {
  it("rotates to the primary model when the allocated model is rate-limited", async () => {
    const { fetchMock, models } = modelRoutingFetch((model) => (
      model === ORIGIN_GROQ_FREE_ROTATION_MODEL_ID ? rateLimitResponse() : groqJson(successBody(model))
    ));
    const result = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, pacingOptions());
    expect(models).toEqual([ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, ORIGIN_GROQ_FREE_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(result.transportRequestCount).toBe(2);
  });

  it("rotates to the primary model when the allocated model returns an empty response", async () => {
    // The allocated bucket is the weaker model; an empty body from it
    // (PROVIDER_INVALID_RESPONSE) is this cascade's signal to fall back
    // to the primary attempt the call would have made first before D-1.
    const { fetchMock, models } = modelRoutingFetch((model) => (
      model === ORIGIN_GROQ_FREE_ROTATION_MODEL_ID
        ? groqJson(successBody(model, ""))
        : groqJson(successBody(model))
    ));
    const result = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, pacingOptions());
    expect(models).toEqual([ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, ORIGIN_GROQ_FREE_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(result.transportRequestCount).toBe(2);
  });

  it("surfaces PROVIDER_INVALID_RESPONSE when the primary also returns an empty response", async () => {
    const { fetchMock, models } = modelRoutingFetch((model) => groqJson(successBody(model, "")));
    const error = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, pacingOptions())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_INVALID_RESPONSE");
    expect(models).toEqual([ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, ORIGIN_GROQ_FREE_MODEL_ID]);
  });

  it("does not rotate on a non-trigger failure of the allocated model", async () => {
    const { fetchMock, models } = modelRoutingFetch(() => groqJson({ error: { code: "invalid_api_key", message: "Invalid API key" } }, 401));
    const error = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, pacingOptions())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(models).toEqual([ORIGIN_GROQ_FREE_ROTATION_MODEL_ID]);
  });

  it("keeps the qwen stage behind its own kill switch at the end of the allocated cascade", async () => {
    const qwenEnv = { ...d1Env, ORIGIN_GROQ_QWEN_ROTATION_ENABLED: "true" } as NodeJS.ProcessEnv;
    const { fetchMock, models } = modelRoutingFetch((model) => (
      model === ORIGIN_GROQ_QWEN_MODEL_ID ? groqJson(successBody(model)) : rateLimitResponse()
    ));
    const result = await executeOriginGroqProvider(analyzerRequest, qwenEnv, fetchMock, pacingOptions());
    expect(models).toEqual([ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, ORIGIN_GROQ_FREE_MODEL_ID, ORIGIN_GROQ_QWEN_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_QWEN_MODEL_ID);
  });
});

describe("executeOriginGroqProvider D-1 pacing", () => {
  it("defers to the primary model when the allocated window is full but the primary's fits", async () => {
    // One send's footprint is 4,114; 3,000 already booked on the
    // allocated model leaves no room under the 6,400 safety line.
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, 3_000, NOW_MS);
    const { fetchMock, models } = modelRoutingFetch((model) => groqJson(successBody(model)));
    const result = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, pacingOptions());
    expect(models).toEqual([ORIGIN_GROQ_FREE_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(sleeps).toEqual([]);
  });

  it("takes a short wait when the earliest window expiry is near, then sends on the allocated model", async () => {
    // Both buckets are booked 3,000 by sends made 55s ago, so room
    // opens in 5s — inside the allocated cascade's 12s wait ceiling
    // (ORIGIN_GROQ_PACING_ALLOCATION_MAX_WAIT_MS), so the wait is
    // still taken exactly as pacing intends.
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, 3_000, NOW_MS - 55_000);
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_MODEL_ID, 3_000, NOW_MS - 55_000);
    const { fetchMock, models } = modelRoutingFetch((model) => groqJson(successBody(model)));
    const result = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, pacingOptions());
    expect(models).toEqual([ORIGIN_GROQ_FREE_ROTATION_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID);
    expect(sleeps).toEqual([5_000]);
  });

  it("does not take a wait longer than the allocated cascade's ceiling; the send proceeds unpaced", async () => {
    // Both buckets were booked at the current instant, so the
    // earliest fitting expiry is a full 60s out. That wait can never
    // fit the Groq slice of a 45s failover dispatch (production
    // evidence 2026-11-22: it aborted as PROVIDER_TIMEOUT and the
    // analyzer's retry multiplied the step past its 120s advance), so
    // pacing steps aside at once and the send proceeds unpaced.
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, 3_000, NOW_MS);
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_MODEL_ID, 3_000, NOW_MS);
    const { fetchMock, models } = modelRoutingFetch((model) => groqJson(successBody(model)));
    const result = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, pacingOptions());
    expect(models).toEqual([ORIGIN_GROQ_FREE_ROTATION_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID);
    expect(sleeps).toEqual([]);
  });

  it("proceeds unpaced once the cascade's cumulative wait ceiling is spent mid-wait", async () => {
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, 3_000, NOW_MS - 55_000);
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_MODEL_ID, 3_000, NOW_MS - 55_000);
    // The first (5s) wait is within the ceiling and is taken. During
    // it, fresh bookings land on both models, so the next fitting
    // expiry is 60s out — past the ceiling's remainder. Pacing then
    // steps aside and the send proceeds exactly as it would have
    // before D-1.
    const options = pacingOptions();
    options.pacingSleepMs = async (ms: number) => {
      sleeps.push(ms);
      pacingNow += ms;
      recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, 3_000, pacingNow);
      recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_MODEL_ID, 3_000, pacingNow);
    };
    const { fetchMock, models } = modelRoutingFetch((model) => groqJson(successBody(model)));
    const result = await executeOriginGroqProvider(analyzerRequest, d1Env, fetchMock, options);
    expect(models).toEqual([ORIGIN_GROQ_FREE_ROTATION_MODEL_ID]);
    expect(result.routingEvidence.servedModel).toBe(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID);
    expect(sleeps).toEqual([5_000]);
  });
});
