import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertOriginZeroCostExecutionResultWithFailover,
  executeOriginProviderStreamWithFailover,
  executeOriginProviderWithFailover,
  ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS,
  resetOriginProviderFailoverCircuitForTests,
} from "./originProviderFailover";

// The circuit breaker is process-level state; every test starts from a closed
// breaker so cases stay independent of execution order.
beforeEach(() => {
  resetOriginProviderFailoverCircuitForTests();
});
import {
  OriginProviderError,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient";
import { OriginCloudflarePreflightError } from "./originCloudflareProviderClient";
import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy";
import { ORIGIN_CLOUDFLARE_FREE_MODEL } from "../lib/orchestration/OriginCloudflareFreeModelCatalog";

const NOW_MS = Date.parse("2026-11-06T12:00:00.000Z");
const enabledEnv = { ORIGIN_CF_FAILOVER_ENABLED: "true" } as NodeJS.ProcessEnv;

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
const request: OriginProviderExecutionRequest = {
  plan: primaryPlan,
  messages: [{ role: "user", content: "確認してください" }],
  systemInstruction: "安全に回答してください。",
};

function primarySuccessResult(): OriginProviderExecutionResult {
  return {
    text: "第1経路の回答です。",
    transportRequestCount: 1,
    actualCostUsd: 0,
    providerDataPolicy: primaryPlan.providerDataPolicy,
    routingEvidence: {
      requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      strategy: "adaptive-primary",
      provider: "OpenRouter",
      attempt: 1,
      fallbackUsed: false,
    },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
  };
}

function cloudflareSuccessResult(): OriginProviderExecutionResult {
  return {
    text: "第2経路の回答です。",
    transportRequestCount: 4,
    actualCostUsd: 0,
    providerDataPolicy: primaryPlan.providerDataPolicy,
    routingEvidence: {
      requestedModel: ORIGIN_CLOUDFLARE_FREE_MODEL,
      servedModel: ORIGIN_CLOUDFLARE_FREE_MODEL,
      strategy: "verified-free-failover",
      provider: "Cloudflare",
      attempt: 2,
      fallbackUsed: true,
      neurons: 36,
    },
    usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, costUsd: 0 },
  };
}

function rateLimitedError(): OriginProviderError {
  return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, 120, { transportRequestCount: 1 });
}

describe("executeOriginProviderWithFailover", () => {
  it("is a transparent pass-through when the failover flag is unset", async () => {
    const primaryError = rateLimitedError();
    const primaryExecute = vi.fn(async () => { throw primaryError; });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const error = await executeOriginProviderWithFailover(request, {} as NodeJS.ProcessEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    }).catch((caught: unknown) => caught);
    expect(error).toBe(primaryError);
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });

  it("records a single successful primary attempt when the flag is enabled", async () => {
    const primaryExecute = vi.fn(async () => primarySuccessResult());
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const result = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    expect(result.text).toBe("第1経路の回答です。");
    expect(result.attempts).toEqual([{
      providerId: "openrouter-free",
      modelId: ORIGIN_OPENROUTER_FREE_MODEL,
      outcome: "succeeded",
      transportRequestCount: 1,
    }]);
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("fails over to the Cloudflare route on a primary rate limit and records both attempts", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async (_injectedRequest: OriginProviderExecutionRequest) => cloudflareSuccessResult());
    const result = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(result.routingEvidence.fallbackUsed).toBe(true);
    expect(result.transportRequestCount).toBe(5);
    expect(result.attempts).toEqual([
      {
        providerId: "openrouter-free",
        modelId: ORIGIN_OPENROUTER_FREE_MODEL,
        outcome: "availability-error",
        errorCode: "PROVIDER_RATE_LIMITED",
        transportRequestCount: 1,
      },
      {
        providerId: "cloudflare-workers-ai-free",
        modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
        outcome: "succeeded",
        transportRequestCount: 4,
      },
    ]);
    const cloudflareRequest = cloudflareExecute.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    expect(cloudflareRequest.plan.providerId).toBe("cloudflare-workers-ai-free");
    expect(cloudflareRequest.plan.modelId).toBe(ORIGIN_CLOUDFLARE_FREE_MODEL);
    expect(cloudflareRequest.plan.providerDataPolicy).toEqual(primaryPlan.providerDataPolicy);
    expect(cloudflareRequest.requiredTool).toBeUndefined();
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("surfaces the primary error when the Cloudflare route is skipped by its plan proof", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async () => {
      throw new OriginCloudflarePreflightError("plan-proof-failed", "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED");
    });
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.diagnostic?.failoverAttempts).toEqual([
      {
        providerId: "openrouter-free",
        modelId: ORIGIN_OPENROUTER_FREE_MODEL,
        outcome: "availability-error",
        errorCode: "PROVIDER_RATE_LIMITED",
        transportRequestCount: 1,
      },
      {
        providerId: "cloudflare-workers-ai-free",
        modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
        outcome: "skipped",
        skipReason: "plan-proof-failed:CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED",
        transportRequestCount: 0,
      },
    ]);
  });

  it("surfaces the Cloudflare error when both routes fail with availability errors", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportRequestCount: 3 });
    });
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.outcome)).toEqual(["availability-error", "availability-error"]);
  });

  it.each(["PROVIDER_COST_UNVERIFIED", "PROVIDER_POLICY_VIOLATION", "PROVIDER_ROUTING_UNVERIFIED"] as const)(
    "never fails over an integrity failure (%s)",
    async (code) => {
      const primaryExecute = vi.fn(async () => {
        throw new OriginProviderError(code, "integrity failure", 502, false, undefined, { transportRequestCount: 1 });
      });
      const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
      const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
        nowMs: NOW_MS, primaryExecute, cloudflareExecute,
      }).catch((caught: unknown) => caught) as OriginProviderError;
      expect(error.code).toBe(code);
      expect(cloudflareExecute).not.toHaveBeenCalled();
    },
  );

  it("never fails over a required-tool request", async () => {
    const toolRequest: OriginProviderExecutionRequest = {
      ...request,
      requiredTool: { name: "emit_result", description: "test", parameters: { type: "object" } },
    };
    const primaryError = rateLimitedError();
    const primaryExecute = vi.fn(async () => { throw primaryError; });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const error = await executeOriginProviderWithFailover(toolRequest, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    }).catch((caught: unknown) => caught);
    expect(error).toBe(primaryError);
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });

  it("rethrows unexpected non-provider errors untouched", async () => {
    const boom = new Error("boom");
    const primaryExecute = vi.fn(async () => { throw boom; });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    }).catch((caught: unknown) => caught);
    expect(error).toBe(boom);
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });
});

describe("executeOriginProviderStreamWithFailover", () => {
  it("fails over before the first byte when the primary stream hits a rate limit", async () => {
    const streamExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      request,
      { onDelta: (text) => { deltas.push(text); } },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareExecute },
    );
    expect(result.text).toBe("第2経路の回答です。");
    expect(deltas).toEqual(["第2経路の回答です。"]);
    expect(result.attempts).toHaveLength(2);
  });

  it("never switches after a byte was delivered downstream", async () => {
    const streamExecute = vi.fn(async (_req: OriginProviderExecutionRequest, handlers: { onDelta: (text: string) => void }) => {
      handlers.onDelta("部分的な回答");
      throw rateLimitedError();
    });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const error = await executeOriginProviderStreamWithFailover(
      request,
      { onDelta: () => undefined },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareExecute },
    ).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });

  it("is a transparent pass-through when the failover flag is unset", async () => {
    const streamed = primarySuccessResult();
    const streamExecute = vi.fn(async () => streamed);
    const result = await executeOriginProviderStreamWithFailover(
      request,
      { onDelta: () => undefined },
      {} as NodeJS.ProcessEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute },
    );
    expect(result).toBe(streamed);
    expect(result.attempts).toBeUndefined();
  });
});

describe("assertOriginZeroCostExecutionResultWithFailover", () => {
  function compositeResult(): OriginProviderExecutionResult {
    return {
      ...cloudflareSuccessResult(),
      transportRequestCount: 5,
      attempts: [
        {
          providerId: "openrouter-free",
          modelId: ORIGIN_OPENROUTER_FREE_MODEL,
          outcome: "availability-error",
          errorCode: "PROVIDER_RATE_LIMITED",
          transportRequestCount: 1,
        },
        {
          providerId: "cloudflare-workers-ai-free",
          modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
          outcome: "succeeded",
          transportRequestCount: 4,
        },
      ],
    };
  }

  it("accepts a verified composite result", () => {
    expect(() => assertOriginZeroCostExecutionResultWithFailover(compositeResult(), ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("rejects a composite whose serving model was substituted", () => {
    const result = compositeResult();
    result.attempts = [
      result.attempts![0],
      { ...result.attempts![1], modelId: "some-paid-model" },
    ];
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("許可された無料Provider/Modelの証跡を確認できません。");
  });

  it("rejects a composite whose first attempt was not an availability failure", () => {
    const result = compositeResult();
    result.attempts = [
      { ...result.attempts![0], errorCode: "PROVIDER_POLICY_VIOLATION" },
      result.attempts![1],
    ];
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("許可された無料Provider/Modelの証跡を確認できません。");
  });

  it("rejects a composite whose transport count does not match its attempts", () => {
    const result = { ...compositeResult(), transportRequestCount: 99 };
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("実際のProvider HTTP送信回数を確認できません。");
  });

  it("rejects a composite with a nonzero cost", () => {
    const result = { ...compositeResult(), actualCostUsd: 0.01 } as unknown as OriginProviderExecutionResult;
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("0ドル固定ポリシー");
  });

  it("delegates results without attempts to the original assertion", () => {
    expect(() => assertOriginZeroCostExecutionResultWithFailover(primarySuccessResult(), ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
    const paid = { ...primarySuccessResult(), actualCostUsd: 0.5 } as unknown as OriginProviderExecutionResult;
    expect(() => assertOriginZeroCostExecutionResultWithFailover(paid, ORIGIN_OPENROUTER_FREE_MODEL)).toThrow();
  });
});

describe("primary attempt budget", () => {
  it("cuts off a hanging primary within the budget and answers from the Cloudflare route", async () => {
    const primaryExecute = vi.fn(async () => new Promise<OriginProviderExecutionResult>(() => undefined));
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const startedAt = Date.now();
    const result = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, primaryAttemptBudgetMs: 50,
    });
    const elapsedMs = Date.now() - startedAt;
    expect(result.text).toBe("第2経路の回答です。");
    expect(elapsedMs).toBeLessThan(1_500);
    expect(result.attempts).toEqual([
      {
        providerId: "openrouter-free",
        modelId: ORIGIN_OPENROUTER_FREE_MODEL,
        outcome: "availability-error",
        errorCode: "PROVIDER_TIMEOUT",
        transportRequestCount: 0,
      },
      {
        providerId: "cloudflare-workers-ai-free",
        modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
        outcome: "succeeded",
        transportRequestCount: 4,
      },
    ]);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("aborts the hanging attempt's in-flight fetch and counts the requests it actually sent", async () => {
    const signals: AbortSignal[] = [];
    const hangingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    const primaryExecute = vi.fn(async (
      _injectedRequest: OriginProviderExecutionRequest,
      _env: NodeJS.ProcessEnv,
      fetchImpl: typeof fetch,
    ) => {
      await fetchImpl("https://openrouter.invalid/api/v1/chat/completions", { method: "POST" });
      return primarySuccessResult();
    });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const result = await executeOriginProviderWithFailover(request, enabledEnv, hangingFetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, primaryAttemptBudgetMs: 50,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(result.attempts?.[0]).toMatchObject({ outcome: "availability-error", errorCode: "PROVIDER_TIMEOUT", transportRequestCount: 1 });
    expect(result.transportRequestCount).toBe(5);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("raises the Cloudflare route plan timeout without modifying the primary plan", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async (_injectedRequest: OriginProviderExecutionRequest) => cloudflareSuccessResult());
    await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    const cloudflareRequest = cloudflareExecute.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    expect(cloudflareRequest.plan.timeoutMs).toBe(ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS);
    expect(request.plan.timeoutMs).toBe(30_000);
  });

  it("cuts off a hanging primary stream before the first byte and fails over", async () => {
    const streamExecute = vi.fn(async () => new Promise<OriginProviderExecutionResult>(() => undefined));
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      request,
      { onDelta: (text) => { deltas.push(text); } },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareExecute, primaryAttemptBudgetMs: 50 },
    );
    expect(result.text).toBe("第2経路の回答です。");
    expect(deltas).toEqual(["第2経路の回答です。"]);
    expect(result.attempts?.[0]).toMatchObject({ outcome: "availability-error", errorCode: "PROVIDER_TIMEOUT" });
  });

  it("never abandons a primary stream after a byte was delivered, even past the budget", async () => {
    const streamExecute = vi.fn(async (
      _injectedRequest: OriginProviderExecutionRequest,
      handlers: { onDelta: (text: string) => void },
    ) => {
      handlers.onDelta("部分的な回答");
      await new Promise((resolve) => setTimeout(resolve, 300));
      return primarySuccessResult();
    });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      request,
      { onDelta: (text) => { deltas.push(text); } },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareExecute, primaryAttemptBudgetMs: 50 },
    );
    expect(result.text).toBe("第1経路の回答です。");
    expect(deltas).toEqual(["部分的な回答"]);
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });
});

describe("primary circuit breaker", () => {
  const COOLDOWN_MS = 300_000;

  it("skips the primary during the cooldown after a rate-limit failure and records the skip", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const first = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    expect(first.attempts?.[0]?.outcome).toBe("availability-error");
    expect(primaryExecute).toHaveBeenCalledTimes(1);

    const second = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS + 60_000, primaryExecute, cloudflareExecute,
    });
    expect(primaryExecute).toHaveBeenCalledTimes(1);
    expect(second.text).toBe("第2経路の回答です。");
    expect(second.transportRequestCount).toBe(4);
    expect(second.attempts).toEqual([
      {
        providerId: "openrouter-free",
        modelId: ORIGIN_OPENROUTER_FREE_MODEL,
        outcome: "skipped",
        skipReason: "primary-circuit-open",
        errorCode: "PROVIDER_RATE_LIMITED",
        transportRequestCount: 0,
      },
      {
        providerId: "cloudflare-workers-ai-free",
        modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
        outcome: "succeeded",
        transportRequestCount: 4,
      },
    ]);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(second, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("half-opens after the cooldown: a primary success closes the breaker", async () => {
    let primaryBehavior: "fail" | "succeed" = "fail";
    const primaryExecute = vi.fn(async () => {
      if (primaryBehavior === "fail") throw rateLimitedError();
      return primarySuccessResult();
    });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    primaryBehavior = "succeed";
    const trialed = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS + COOLDOWN_MS + 1, primaryExecute, cloudflareExecute,
    });
    expect(trialed.text).toBe("第1経路の回答です。");
    expect(primaryExecute).toHaveBeenCalledTimes(2);
    const after = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS + COOLDOWN_MS + 2, primaryExecute, cloudflareExecute,
    });
    expect(after.text).toBe("第1経路の回答です。");
    expect(primaryExecute).toHaveBeenCalledTimes(3);
  });

  it("re-opens the breaker when the half-open trial fails with a rate limit again", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS + COOLDOWN_MS + 1, primaryExecute, cloudflareExecute,
    });
    expect(primaryExecute).toHaveBeenCalledTimes(2);
    const skipped = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS + COOLDOWN_MS + 2, primaryExecute, cloudflareExecute,
    });
    expect(primaryExecute).toHaveBeenCalledTimes(2);
    expect(skipped.attempts?.[0]).toMatchObject({ outcome: "skipped", skipReason: "primary-circuit-open" });
  });

  it("does not open the breaker for a non-rate-limit availability failure", async () => {
    const primaryExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportRequestCount: 1 });
    });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS + 1_000, primaryExecute, cloudflareExecute,
    });
    expect(primaryExecute).toHaveBeenCalledTimes(2);
  });

  it("surfaces the opening failure code when both routes are unavailable during the cooldown", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const okCloudflare = vi.fn(async () => cloudflareSuccessResult());
    await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute: okCloudflare,
    });
    const proofSkippedCloudflare = vi.fn(async () => {
      throw new OriginCloudflarePreflightError("plan-proof-failed", "CLOUDFLARE_WORKERS_PLAN_UNVERIFIED");
    });
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS + 30_000, primaryExecute, cloudflareExecute: proofSkippedCloudflare,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(270);
    expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.outcome)).toEqual(["skipped", "skipped"]);
  });
});

describe("assertOriginZeroCostExecutionResultWithFailover circuit-skip shapes", () => {
  function circuitSkipResult(): OriginProviderExecutionResult {
    return {
      ...cloudflareSuccessResult(),
      transportRequestCount: 4,
      attempts: [
        {
          providerId: "openrouter-free",
          modelId: ORIGIN_OPENROUTER_FREE_MODEL,
          outcome: "skipped",
          skipReason: "primary-circuit-open",
          errorCode: "PROVIDER_RATE_LIMITED",
          transportRequestCount: 0,
        },
        {
          providerId: "cloudflare-workers-ai-free",
          modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
          outcome: "succeeded",
          transportRequestCount: 4,
        },
      ],
    };
  }

  it("accepts a verified circuit-breaker skip composite", () => {
    expect(() => assertOriginZeroCostExecutionResultWithFailover(circuitSkipResult(), ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("rejects a skipped first attempt without the breaker skip reason", () => {
    const result = circuitSkipResult();
    result.attempts = [
      { ...result.attempts![0], skipReason: "plan-proof-failed" },
      result.attempts![1],
    ];
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("許可された無料Provider/Modelの証跡を確認できません。");
  });

  it("rejects a circuit skip that claims transport requests were sent", () => {
    const result = circuitSkipResult();
    result.attempts = [
      { ...result.attempts![0], transportRequestCount: 1 },
      result.attempts![1],
    ];
    result.transportRequestCount = 5;
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("許可された無料Provider/Modelの証跡を確認できません。");
  });

  it("rejects a circuit skip opened by a non-circuit error code", () => {
    const result = circuitSkipResult();
    result.attempts = [
      { ...result.attempts![0], errorCode: "PROVIDER_UNAVAILABLE" },
      result.attempts![1],
    ];
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("許可された無料Provider/Modelの証跡を確認できません。");
  });
});
