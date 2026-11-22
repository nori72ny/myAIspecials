import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertOriginZeroCostExecutionResultWithFailover,
  executeOriginProviderStreamWithFailover,
  executeOriginProviderWithFailover,
  ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS,
  ORIGIN_PRIMARY_ROUTE_STOPPED_SKIP_REASON,
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
import { ORIGIN_GROQ_FREE_MODEL_ID } from "../lib/orchestration/OriginGroqFreeModelCatalog";

const NOW_MS = Date.parse("2026-11-17T12:00:00.000Z");
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

  it("records the route-stopped skip and serves from the Cloudflare route without attempting the primary (PKG-4 PR-2)", async () => {
    // The primary route is dispositioned stopped: even a primary executor
    // that would succeed is never invoked, and the first attempt record is
    // the route-stopped skip (no error code, zero transport requests).
    const primaryExecute = vi.fn(async () => primarySuccessResult());
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const result = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第2経路の回答です。");
    expect(result.transportRequestCount).toBe(4);
    expect(result.attempts).toEqual([
      {
        providerId: "openrouter-free",
        modelId: ORIGIN_OPENROUTER_FREE_MODEL,
        outcome: "skipped",
        skipReason: "route-stopped",
        transportRequestCount: 0,
      },
      {
        providerId: "cloudflare-workers-ai-free",
        modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
        outcome: "succeeded",
        rateLimitHit: false,
        transportRequestCount: 4,
        durationMs: expect.any(Number),
      },
    ]);
    expect(ORIGIN_PRIMARY_ROUTE_STOPPED_SKIP_REASON).toBe("route-stopped");
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("records the route-stopped primary skip and serves from the Cloudflare route", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async (_injectedRequest: OriginProviderExecutionRequest) => cloudflareSuccessResult());
    const result = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第2経路の回答です。");
    expect(result.routingEvidence.fallbackUsed).toBe(true);
    expect(result.transportRequestCount).toBe(4);
    expect(result.attempts).toEqual([
      {
        providerId: "openrouter-free",
        modelId: ORIGIN_OPENROUTER_FREE_MODEL,
        outcome: "skipped",
        skipReason: "route-stopped",
        transportRequestCount: 0,
      },
      {
        providerId: "cloudflare-workers-ai-free",
        modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
        outcome: "succeeded",
        rateLimitHit: false,
        transportRequestCount: 4,
        durationMs: expect.any(Number),
      },
    ]);
    const cloudflareRequest = cloudflareExecute.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    expect(cloudflareRequest.plan.providerId).toBe("cloudflare-workers-ai-free");
    expect(cloudflareRequest.plan.modelId).toBe(ORIGIN_CLOUDFLARE_FREE_MODEL);
    expect(cloudflareRequest.plan.providerDataPolicy).toEqual(primaryPlan.providerDataPolicy);
    expect(cloudflareRequest.requiredTool).toBeUndefined();
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("passes the route-2 deduplicated instruction through to the Cloudflare route", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async (_injectedRequest: OriginProviderExecutionRequest) => cloudflareSuccessResult());
    const dedupedRequest: OriginProviderExecutionRequest = {
      ...request,
      cloudflareSystemInstruction: "経路2向け重複除去済み指示",
    };
    const result = await executeOriginProviderWithFailover(dedupedRequest, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第2経路の回答です。");
    const cloudflareRequest = cloudflareExecute.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    expect(cloudflareRequest.cloudflareSystemInstruction).toBe("経路2向け重複除去済み指示");
    expect(cloudflareRequest.systemInstruction).toBe(request.systemInstruction);
  });

  it("surfaces the route-stopped unavailability when the Cloudflare route is skipped by its plan proof", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async () => {
      throw new OriginCloudflarePreflightError("plan-proof-failed", "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED");
    });
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(OriginProviderError);
    // No primary attempt ran in this request, so the honest surfaced error
    // is the synthesized route-stopped unavailability (503, zero transport).
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.diagnostic?.failoverAttempts).toEqual([
      {
        providerId: "openrouter-free",
        modelId: ORIGIN_OPENROUTER_FREE_MODEL,
        outcome: "skipped",
        skipReason: "route-stopped",
        transportRequestCount: 0,
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

  it("records a pool-exhausted Cloudflare skip and surfaces the route-stopped unavailability", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async () => {
      throw new OriginCloudflarePreflightError("pool-exhausted");
    });
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.diagnostic?.failoverAttempts).toEqual([
      {
        providerId: "openrouter-free",
        modelId: ORIGIN_OPENROUTER_FREE_MODEL,
        outcome: "skipped",
        skipReason: "route-stopped",
        transportRequestCount: 0,
      },
      {
        providerId: "cloudflare-workers-ai-free",
        modelId: ORIGIN_CLOUDFLARE_FREE_MODEL,
        outcome: "skipped",
        skipReason: "pool-exhausted",
        transportRequestCount: 0,
      },
    ]);
  });

  it("surfaces the Cloudflare error when the second route fails with an availability error", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportRequestCount: 3 });
    });
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    }).catch((caught: unknown) => caught) as OriginProviderError;
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.outcome)).toEqual(["skipped", "availability-error"]);
  });

  it.each(["PROVIDER_COST_UNVERIFIED", "PROVIDER_POLICY_VIOLATION", "PROVIDER_ROUTING_UNVERIFIED"] as const)(
    "never fails over an integrity failure on the Cloudflare route (%s)",
    async (code) => {
      const primaryExecute = vi.fn(async () => primarySuccessResult());
      const cloudflareExecute = vi.fn(async () => {
        throw new OriginProviderError(code, "integrity failure", 502, false, undefined, { transportRequestCount: 4 });
      });
      const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
        nowMs: NOW_MS, primaryExecute, cloudflareExecute,
      }).catch((caught: unknown) => caught) as OriginProviderError;
      expect(primaryExecute).not.toHaveBeenCalled();
      expect(error.code).toBe(code);
      expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.outcome)).toEqual(["skipped", "failed"]);
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
    const primaryExecute = vi.fn(async () => primarySuccessResult());
    const cloudflareExecute = vi.fn(async () => { throw boom; });
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    }).catch((caught: unknown) => caught);
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(error).toBe(boom);
  });
});

describe("executeOriginProviderStreamWithFailover", () => {
  it("streams the second route without ever starting the stopped primary stream (PKG-4 PR-2)", async () => {
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
    expect(streamExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第2経路の回答です。");
    expect(deltas).toEqual(["第2経路の回答です。"]);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.[0]).toEqual({
      providerId: "openrouter-free",
      modelId: ORIGIN_OPENROUTER_FREE_MODEL,
      outcome: "skipped",
      skipReason: "route-stopped",
      transportRequestCount: 0,
    });
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("never starts the primary stream even when it would deliver a fragment before failing", async () => {
    // The mid-delivery no-switch guard now applies to the failover routes
    // themselves (covered by the progressive-failover describe below); the
    // stopped primary stream is not started at all, whatever it would do.
    const streamExecute = vi.fn(async (_req: OriginProviderExecutionRequest, handlers: { onDelta: (text: string) => void }) => {
      handlers.onDelta("部分的な回答");
      throw rateLimitedError();
    });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      request,
      { onDelta: (text) => { deltas.push(text); } },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareExecute },
    );
    expect(streamExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第2経路の回答です。");
    expect(deltas).toEqual(["第2経路の回答です。"]);
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

describe("primary route disposition (PKG-4 PR-2)", () => {
  // The primary attempt budget and circuit-breaker entry tests that used to
  // live here covered machinery that is dormant while the route carries the
  // stopped disposition: the entries never reach it. The circuit-skip
  // assertion shapes stay covered by the dedicated assertion describes
  // below; if the disposition is ever reverted (with renewed evidence), the
  // entry-level budget/breaker tests must be restored with it.

  it("never attempts the primary across repeated requests: every first attempt is the route-stopped skip", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    for (const nowMs of [NOW_MS, NOW_MS + 60_000, NOW_MS + 600_000]) {
      const result = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
        nowMs, primaryExecute, cloudflareExecute,
      });
      expect(result.attempts?.[0]).toEqual({
        providerId: "openrouter-free",
        modelId: ORIGIN_OPENROUTER_FREE_MODEL,
        outcome: "skipped",
        skipReason: "route-stopped",
        transportRequestCount: 0,
      });
      expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
    }
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(cloudflareExecute).toHaveBeenCalledTimes(3);
  });

  it("raises the Cloudflare route plan timeout without modifying the primary plan", async () => {
    const primaryExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareExecute = vi.fn(async (_injectedRequest: OriginProviderExecutionRequest) => cloudflareSuccessResult());
    await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute,
    });
    expect(primaryExecute).not.toHaveBeenCalled();
    const cloudflareRequest = cloudflareExecute.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    expect(cloudflareRequest.plan.timeoutMs).toBe(ORIGIN_CLOUDFLARE_ROUTE_TIMEOUT_MS);
    expect(request.plan.timeoutMs).toBe(30_000);
  });
});

describe("chat total time budget", () => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("reaches the second route inside the total budget", async () => {
    const primaryExecute = vi.fn(async () => primarySuccessResult());
    const cloudflareExecute = vi.fn(async () => { await delay(120); return cloudflareSuccessResult(); });
    const startedAt = Date.now();
    const result = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, totalBudgetMs: 2_000,
    });
    const elapsedMs = Date.now() - startedAt;
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(result.text).toBe("第2経路の回答です。");
    expect(elapsedMs).toBeLessThan(2_000);
    expect(result.attempts).toHaveLength(2);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("sends nothing to the stopped primary: the second route is the first executed attempt (PKG-4 PR-2)", async () => {
    const primaryExecute = vi.fn(async () => primarySuccessResult());
    const cloudflareExecute = vi.fn(async () => cloudflareSuccessResult());
    const result = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, primaryExecute, cloudflareExecute, totalBudgetMs: 2_000,
    });
    expect(result.text).toBe("第2経路の回答です。");
    expect(primaryExecute).not.toHaveBeenCalled();
    expect(cloudflareExecute).toHaveBeenCalledTimes(1);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.[0]).toEqual({
      providerId: "openrouter-free",
      modelId: ORIGIN_OPENROUTER_FREE_MODEL,
      outcome: "skipped",
      skipReason: "route-stopped",
      transportRequestCount: 0,
    });
    expect(result.attempts?.[1]?.outcome).toBe("succeeded");
  });

  it("stops waiting at the total budget when the second route hangs", async () => {
    const cloudflareExecute = vi.fn(async () => new Promise<OriginProviderExecutionResult>(() => undefined));
    const startedAt = Date.now();
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, cloudflareExecute, totalBudgetMs: 300,
    }).catch((caught: unknown) => caught);
    const elapsedMs = Date.now() - startedAt;
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_TIMEOUT");
    expect(elapsedMs).toBeLessThan(1_500);
    const attempts = (error as OriginProviderError).diagnostic?.failoverAttempts;
    expect(attempts).toHaveLength(2);
    expect(attempts?.[1]).toMatchObject({
      providerId: "cloudflare-workers-ai-free",
      outcome: "availability-error",
      errorCode: "PROVIDER_TIMEOUT",
    });
  });

  it("bounds the composed stack: a hanging second route still ends at the total budget", async () => {
    const cloudflareExecute = vi.fn(async () => new Promise<OriginProviderExecutionResult>(() => undefined));
    const startedAt = Date.now();
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, cloudflareExecute, totalBudgetMs: 400,
    }).catch((caught: unknown) => caught);
    const elapsedMs = Date.now() - startedAt;
    expect((error as OriginProviderError).code).toBe("PROVIDER_TIMEOUT");
    expect(elapsedMs).toBeLessThan(1_500);
    expect(elapsedMs).toBeGreaterThanOrEqual(300);
  });

  it("aborts the second route's in-flight fetch when the total budget expires", async () => {
    const signals: AbortSignal[] = [];
    const hangingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    const cloudflareExecute = vi.fn(async (
      _injectedRequest: OriginProviderExecutionRequest,
      _env: NodeJS.ProcessEnv,
      fetchImpl: typeof fetch,
    ) => {
      await fetchImpl("https://api.cloudflare.com/client/v4/accounts/test/ai/run/model", { method: "POST" });
      return cloudflareSuccessResult();
    });
    const startedAt = Date.now();
    const error = await executeOriginProviderWithFailover(request, enabledEnv, hangingFetch, {
      nowMs: NOW_MS, cloudflareExecute, totalBudgetMs: 300,
    }).catch((caught: unknown) => caught);
    const elapsedMs = Date.now() - startedAt;
    expect((error as OriginProviderError).code).toBe("PROVIDER_TIMEOUT");
    expect(elapsedMs).toBeLessThan(1_500);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("applies no third-route reserve while the Groq route is not configured: the second route keeps the full remaining budget (PKG-4 PR-1)", async () => {
    const cloudflareExecute = vi.fn(async () => new Promise<OriginProviderExecutionResult>(() => undefined));
    const startedAt = Date.now();
    const error = await executeOriginProviderWithFailover(request, enabledEnv, fetch, {
      nowMs: NOW_MS, cloudflareExecute, totalBudgetMs: 300,
    }).catch((caught: unknown) => caught);
    const elapsedMs = Date.now() - startedAt;
    expect((error as OriginProviderError).code).toBe("PROVIDER_TIMEOUT");
    // enabledEnv carries no GROQ_API_KEY, so no reserve is held back: the second
    // route waits out the whole remaining budget (~300ms) instead of being cut
    // immediately by the 10s reserve, and its attempt records that duration.
    expect(elapsedMs).toBeGreaterThanOrEqual(250);
    expect(elapsedMs).toBeLessThan(1_500);
    const attempts = (error as OriginProviderError).diagnostic?.failoverAttempts;
    expect(attempts?.[1]?.durationMs).toBeGreaterThanOrEqual(250);
  });
});

// The entry-level "primary circuit breaker" tests were removed by PKG-4
// PR-2: while the primary route carries the stopped disposition the entries
// never consult the breaker (it stays dormant in the dispatcher). The
// circuit-skip evidence shapes remain pinned by the assertion describes
// below and in originProviderFailoverGroq.test.ts; restoring the route
// (reverting the disposition, with renewed evidence) must restore those
// entry tests with it.

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

describe("assertOriginZeroCostExecutionResultWithFailover route-stopped shapes (PKG-4 PR-2)", () => {
  function routeStoppedResult(): OriginProviderExecutionResult {
    return {
      ...cloudflareSuccessResult(),
      transportRequestCount: 4,
      attempts: [
        {
          providerId: "openrouter-free",
          modelId: ORIGIN_OPENROUTER_FREE_MODEL,
          outcome: "skipped",
          skipReason: "route-stopped",
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

  it("accepts a verified route-stopped composite", () => {
    expect(() => assertOriginZeroCostExecutionResultWithFailover(routeStoppedResult(), ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("rejects a route-stopped skip that carries an error code", () => {
    const result = routeStoppedResult();
    result.attempts = [
      { ...result.attempts![0], errorCode: "PROVIDER_RATE_LIMITED" },
      result.attempts![1],
    ];
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("許可された無料Provider/Modelの証跡を確認できません。");
  });

  it("rejects a route-stopped skip that claims transport requests were sent", () => {
    const result = routeStoppedResult();
    result.attempts = [
      { ...result.attempts![0], transportRequestCount: 1 },
      result.attempts![1],
    ];
    result.transportRequestCount = 5;
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("許可された無料Provider/Modelの証跡を確認できません。");
  });

  it("rejects a first-attempt skip with an unrecognized skip reason", () => {
    const result = routeStoppedResult();
    result.attempts = [
      { ...result.attempts![0], skipReason: "route_stopped" },
      result.attempts![1],
    ];
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL))
      .toThrow("許可された無料Provider/Modelの証跡を確認できません。");
  });
});

describe("second-route circuit breaker without a third route (speed wave 1)", () => {
  it("never skips the second route while the Groq route is not configured: it is the last route", async () => {
    let cfBehavior: "timeout" | "ok" = "timeout";
    const cloudflareExecute = vi.fn(async () => {
      if (cfBehavior === "timeout") {
        throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, {
          transportFailure: "timeout",
          transportRequestCount: 4,
        });
      }
      return cloudflareSuccessResult();
    });
    // enabledEnv carries no GROQ_API_KEY. Every request enters through the
    // route-stopped primary skip (PKG-4 PR-2).
    const options = { cloudflareExecute };
    const first = await executeOriginProviderWithFailover(request, enabledEnv, fetch, { ...options, nowMs: NOW_MS })
      .catch((caught: unknown) => caught) as OriginProviderError;
    expect(first.code).toBe("PROVIDER_TIMEOUT");
    const second = await executeOriginProviderWithFailover(request, enabledEnv, fetch, { ...options, nowMs: NOW_MS + 1_000 })
      .catch((caught: unknown) => caught) as OriginProviderError;
    expect(second.code).toBe("PROVIDER_TIMEOUT");
    // Two counted failures opened the breaker internally, but with no third
    // route configured the second route is the last chance: it still runs —
    // and can still serve — on the next request.
    cfBehavior = "ok";
    const third = await executeOriginProviderWithFailover(request, enabledEnv, fetch, { ...options, nowMs: NOW_MS + 2_000 });
    expect(cloudflareExecute).toHaveBeenCalledTimes(3);
    expect(third.text).toBe("第2経路の回答です。");
    expect(() => assertOriginZeroCostExecutionResultWithFailover(third, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });
});

describe("executeOriginProviderStreamWithFailover progressive failover routes", () => {
  const bothEnv = {
    ORIGIN_CF_FAILOVER_ENABLED: "true",
    GROQ_API_KEY: "synthetic-groq-api-key-for-tests-only",
  } as NodeJS.ProcessEnv;

  function groqSuccessResult(): OriginProviderExecutionResult {
    return {
      text: "第3経路の回答です。",
      transportRequestCount: 1,
      actualCostUsd: 0,
      providerDataPolicy: primaryPlan.providerDataPolicy,
      routingEvidence: {
        requestedModel: ORIGIN_GROQ_FREE_MODEL_ID,
        servedModel: ORIGIN_GROQ_FREE_MODEL_ID,
        strategy: "verified-free-failover",
        provider: "Groq",
        attempt: 3,
        fallbackUsed: true,
      },
      usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160, costUsd: 0 },
    };
  }

  function cloudflareStreamOk(fragments: string[]) {
    return vi.fn(async (
      _injectedRequest: OriginProviderExecutionRequest,
      handlers: { onDelta: (text: string) => void },
    ) => {
      for (const fragment of fragments) handlers.onDelta(fragment);
      return cloudflareSuccessResult();
    });
  }

  it("streams the second route's fragments progressively without starting the stopped primary stream", async () => {
    const streamExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareStreamExecute = cloudflareStreamOk(["第2", "経路の", "回答です。"]);
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => { deltas.push(text); } },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareStreamExecute },
    );
    expect(streamExecute).not.toHaveBeenCalled();
    // The failover route's own fragments reach the client as they are
    // generated — not one composed full-text delta after the generation.
    expect(deltas).toEqual(["第2", "経路の", "回答です。"]);
    expect(deltas.join("")).toBe(result.text);
    expect(result.text).toBe("第2経路の回答です。");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.[0]).toMatchObject({ outcome: "skipped", skipReason: "route-stopped" });
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
    // The route plan conversion and the release policy both reach the
    // streaming route executor.
    const routeRequest = cloudflareStreamExecute.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    expect(routeRequest.plan.providerId).toBe("cloudflare-workers-ai-free");
    expect(routeRequest.streamRelease).toBe("incremental");
  });

  it("threads the hold release policy to the failover route unchanged", async () => {
    const streamExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareStreamExecute = cloudflareStreamOk(["第2経路の回答です。"]);
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      { ...request, streamRelease: "hold-until-verified" },
      { onDelta: (text) => { deltas.push(text); } },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareStreamExecute },
    );
    const routeRequest = cloudflareStreamExecute.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    expect(routeRequest.streamRelease).toBe("hold-until-verified");
    expect(result.text).toBe("第2経路の回答です。");
    expect(deltas).toEqual(["第2経路の回答です。"]);
  });

  it("passes the route-2 deduplicated instruction through to the streaming Cloudflare route", async () => {
    const streamExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareStreamExecute = cloudflareStreamOk(["第2経路の回答です。"]);
    const result = await executeOriginProviderStreamWithFailover(
      { ...request, streamRelease: "incremental", cloudflareSystemInstruction: "経路2向け重複除去済み指示" },
      { onDelta: () => {} },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareStreamExecute },
    );
    expect(result.text).toBe("第2経路の回答です。");
    const routeRequest = cloudflareStreamExecute.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    expect(routeRequest.cloudflareSystemInstruction).toBe("経路2向け重複除去済み指示");
    expect(routeRequest.systemInstruction).toBe(request.systemInstruction);
  });

  it("never switches to the third route after the second route delivered a fragment", async () => {
    const streamExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareStreamExecute = vi.fn(async (
      _injectedRequest: OriginProviderExecutionRequest,
      handlers: { onDelta: (text: string) => void },
    ) => {
      handlers.onDelta("第2経路の途中まで");
      throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportRequestCount: 4 });
    });
    const groqStreamExecute = vi.fn(async () => groqSuccessResult());
    const deltas: string[] = [];
    const error = await executeOriginProviderStreamWithFailover(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => { deltas.push(text); } },
      bothEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareStreamExecute, groqStreamExecute },
    ).catch((caught: unknown) => caught) as OriginProviderError;
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.diagnostic?.failoverAttempts?.map((attempt) => attempt.outcome)).toEqual(["skipped", "availability-error"]);
    expect(deltas).toEqual(["第2経路の途中まで"]);
    expect(groqStreamExecute).not.toHaveBeenCalled();
  });

  it("streams the third route's fragments when the second route fails before any fragment", async () => {
    const streamExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareStreamExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportRequestCount: 3 });
    });
    const groqStreamExecute = vi.fn(async (
      _injectedRequest: OriginProviderExecutionRequest,
      handlers: { onDelta: (text: string) => void },
    ) => {
      handlers.onDelta("第3");
      handlers.onDelta("経路の回答です。");
      return groqSuccessResult();
    });
    const deltas: string[] = [];
    const result = await executeOriginProviderStreamWithFailover(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => { deltas.push(text); } },
      bothEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareStreamExecute, groqStreamExecute },
    );
    expect(deltas).toEqual(["第3", "経路の回答です。"]);
    expect(deltas.join("")).toBe(result.text);
    expect(result.attempts).toHaveLength(3);
    expect(() => assertOriginZeroCostExecutionResultWithFailover(result, ORIGIN_OPENROUTER_FREE_MODEL)).not.toThrow();
  });

  it("records the route-stopped skip and streams the second route directly on every request", async () => {
    const streamExecute = vi.fn(async () => { throw rateLimitedError(); });
    const cloudflareStreamExecute = cloudflareStreamOk(["第2", "経路の回答です。"]);
    const firstDeltas: string[] = [];
    const first = await executeOriginProviderStreamWithFailover(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => { firstDeltas.push(text); } },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS, streamExecute, cloudflareStreamExecute },
    );
    expect(firstDeltas).toEqual(["第2", "経路の回答です。"]);
    expect(first.attempts?.[0]).toMatchObject({ outcome: "skipped", skipReason: "route-stopped" });
    // The primary stream is never attempted on the next request either: the
    // route-stopped skip leads the evidence again (PKG-4 PR-2).
    const secondDeltas: string[] = [];
    const second = await executeOriginProviderStreamWithFailover(
      { ...request, streamRelease: "incremental" },
      { onDelta: (text) => { secondDeltas.push(text); } },
      enabledEnv,
      fetch,
      { nowMs: NOW_MS + 1_000, streamExecute, cloudflareStreamExecute },
    );
    expect(streamExecute).not.toHaveBeenCalled();
    expect(secondDeltas).toEqual(["第2", "経路の回答です。"]);
    expect(second.attempts?.[0]).toMatchObject({ outcome: "skipped", skipReason: "route-stopped" });
  });
});
