import { describe, expect, it, vi } from "vitest";
import {
  executeOriginCloudflareProvider,
  OriginCloudflarePreflightError,
  verifyOriginCloudflareWorkersFreePlan,
  type OriginCloudflareCredentials,
} from "./originCloudflareProviderClient";
import { OriginProviderError, type OriginFetch, type OriginProviderExecutionRequest } from "./originProviderClient";
import {
  ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL,
  ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy";
import { DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginCloudflareFreeModelCatalog";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const PROOF_TOKEN = "synthetic-proof-token-0123456789";
const AI_TOKEN = "synthetic-ai-token-0123456789";
const NOW_MS = Date.parse("2026-11-06T12:00:00.000Z");

const enabledEnv = {
  ORIGIN_CF_FAILOVER_ENABLED: "true",
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  ORIGIN_CF_PROOF_TOKEN: PROOF_TOKEN,
  ORIGIN_CF_AI_TOKEN: AI_TOKEN,
} as NodeJS.ProcessEnv;

const credentials: OriginCloudflareCredentials = { accountId: ACCOUNT_ID, proofToken: PROOF_TOKEN, aiToken: AI_TOKEN };

const catalogEntry = DEFAULT_ORIGIN_CLOUDFLARE_FREE_MODEL_CATALOG[0];
const plan: OriginExecutionPlan = {
  providerId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID,
  providerLabel: "ORIGIN 無料AI",
  modelId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL,
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 30_000,
  requiresOwnerApproval: false,
  reason: "test",
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  modelEvidence: {
    providerId: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID,
    verifiedAt: catalogEntry.verifiedAt,
    reviewAfter: catalogEntry.reviewAfter,
    sourceUrl: catalogEntry.sourceUrl,
  },
};
const request: OriginProviderExecutionRequest = {
  plan,
  messages: [{ role: "user", content: "確認してください" }],
  systemInstruction: "安全に回答してください。",
};

function cloudflareJson(result: unknown, status = 200, errors: Array<{ code?: number; message?: string }> = []) {
  return new Response(JSON.stringify({
    success: status >= 200 && status < 300 && errors.length === 0,
    result,
    ...(Array.isArray(result) ? {
      result_info: { count: result.length, page: 1, per_page: 20, total_count: result.length },
    } : {}),
    errors,
    messages: [],
  }), { status, headers: { "Content-Type": "application/json" } });
}

function freeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    state: "Trial",
    price: 0,
    rate_plan: {
      id: "free",
      public_name: "Workers Free",
      scope: "workers",
      sets: ["workers"],
      externally_managed: false,
      is_contract: false,
    },
    ...overrides,
  };
}

function proofFetch(subscriptions: unknown[] = []) {
  return vi.fn(async (url: string | URL | Request) => {
    const target = String(url);
    if (target.includes("/workers/account-settings")) return cloudflareJson({ default_usage_model: "bundled" });
    if (target.includes("/subscriptions")) return cloudflareJson(subscriptions);
    if (target.includes("/ai/models/schema")) return cloudflareJson({ input: {}, output: {} });
    throw new Error(`unexpected proof URL: ${target}`);
  });
}

function proofFetchWithSettings(settingsResult: unknown, subscriptions: unknown[] = []) {
  return vi.fn(async (url: string | URL | Request) => {
    const target = String(url);
    if (target.includes("/workers/account-settings")) return cloudflareJson(settingsResult);
    if (target.includes("/subscriptions")) return cloudflareJson(subscriptions);
    if (target.includes("/ai/models/schema")) return cloudflareJson({ input: {}, output: {} });
    throw new Error(`unexpected proof URL: ${target}`);
  });
}

describe("verifyOriginCloudflareWorkersFreePlan", () => {
  it("accepts a bundled account with no subscriptions", async () => {
    const transport = { count: 0 };
    await expect(verifyOriginCloudflareWorkersFreePlan(proofFetch() as unknown as OriginFetch, credentials, transport)).resolves.toEqual({ ok: true });
    expect(transport.count).toBe(3);
  });

  it("accepts an explicitly free Workers subscription at exact $0", async () => {
    const transport = { count: 0 };
    await expect(verifyOriginCloudflareWorkersFreePlan(proofFetch([freeSubscription()]) as unknown as OriginFetch, credentials, transport)).resolves.toEqual({ ok: true });
  });

  it.each(["standard", "unbound"])("rejects a paid Workers usage model (%s)", async (usageModel) => {
    const fetchMock = vi.fn(async () => cloudflareJson({ default_usage_model: usageModel }));
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a missing usage model when an explicitly free Workers subscription proves the plan", async () => {
    const transport = { count: 0 };
    const fetchMock = proofFetchWithSettings({}, [freeSubscription()]);
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, transport)).resolves.toEqual({ ok: true });
    expect(transport.count).toBe(3);
  });

  it("fails closed when the usage model is missing and no subscription proves the free plan", async () => {
    const fetchMock = proofFetchWithSettings({}, []);
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_WORKERS_PLAN_UNVERIFIED" });
  });

  it("fails closed when the usage model is missing and only a non-Workers free subscription exists", async () => {
    const other = {
      state: "Trial",
      price: 0,
      rate_plan: { id: "r2_free", public_name: "R2 Free", scope: "r2", sets: ["r2"], externally_managed: false, is_contract: false },
    };
    const fetchMock = proofFetchWithSettings({}, [other]);
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_WORKERS_PLAN_UNVERIFIED" });
  });

  it("fails closed on a non-empty unknown usage model", async () => {
    const fetchMock = vi.fn(async () => cloudflareJson({ default_usage_model: "something-else" }));
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_WORKERS_PLAN_UNVERIFIED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the subscriptions response is paginated", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [],
        result_info: { count: 20, page: 1, per_page: 20, total_count: 21 },
        errors: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_BILLING_READ_INCOMPLETE" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when billing read is denied", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(cloudflareJson(null, 403));
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_BILLING_READ_REQUIRED" });
  });

  it("rejects a paid subscription even when its state claims a free plan", async () => {
    const fetchMock = proofFetch([freeSubscription({ state: "Paid", price: 5 })]);
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" });
  });

  it("fails closed when an active Workers subscription omits its billed price", async () => {
    const row = freeSubscription();
    delete (row as Record<string, unknown>).price;
    const fetchMock = proofFetch([row]);
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" });
  });

  it("rejects a nominal free Workers plan with a nonzero billed price", async () => {
    const fetchMock = proofFetch([freeSubscription({ price: 0.01 })]);
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" });
  });

  it("fails closed when external management is not explicitly excluded", async () => {
    const row = freeSubscription();
    delete ((row.rate_plan as unknown) as Record<string, unknown>).externally_managed;
    const fetchMock = proofFetch([row]);
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" });
  });

  it("fails closed on an unrecognized subscription state", async () => {
    const fetchMock = proofFetch([freeSubscription({ state: "SomethingNew" })]);
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_BILLING_SUBSCRIPTION_UNVERIFIED" });
  });

  it("ignores a non-Workers subscription whose product identity is explicit", async () => {
    const other = {
      state: "Trial",
      price: 0,
      rate_plan: { id: "r2_free", public_name: "R2 Free", scope: "r2", sets: ["r2"], externally_managed: false, is_contract: false },
    };
    const fetchMock = proofFetch([other]);
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: true });
  });

  it("rejects a model that requires a paid plan", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(cloudflareJson([]))
      .mockResolvedValueOnce(cloudflareJson(null, 403, [{ code: 5035 }]));
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails closed when the model schema read lacks permission", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(cloudflareJson([]))
      .mockResolvedValueOnce(cloudflareJson(null, 403));
    await expect(verifyOriginCloudflareWorkersFreePlan(fetchMock as unknown as OriginFetch, credentials, { count: 0 }))
      .resolves.toEqual({ ok: false, reason: "CLOUDFLARE_WORKERS_AI_PERMISSION_REQUIRED" });
  });
});

describe("executeOriginCloudflareProvider", () => {
  function fullFetch(inference: () => Promise<Response>, subscriptions: unknown[] = []) {
    const proof = proofFetch(subscriptions);
    return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes("/ai/run/")) return inference();
      return proof(url as string);
    });
  }

  it("skips the route before any network call when the flag is unset", async () => {
    const fetchMock = vi.fn();
    await expect(executeOriginCloudflareProvider(request, {} as NodeJS.ProcessEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS }))
      .rejects.toMatchObject({ name: "OriginCloudflarePreflightError", reason: "not-enabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the route before any network call when tokens are missing", async () => {
    const fetchMock = vi.fn();
    const env = { ORIGIN_CF_FAILOVER_ENABLED: "true", CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID } as NodeJS.ProcessEnv;
    await expect(executeOriginCloudflareProvider(request, env, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS }))
      .rejects.toMatchObject({ name: "OriginCloudflarePreflightError", reason: "not-configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the route when the evidence catalog is stale", async () => {
    const staleCatalog = [{
      ...catalogEntry,
      verifiedAt: "2026-10-01T00:00:00.000Z",
      reviewAfter: "2026-10-11T00:00:00.000Z",
    }];
    const fetchMock = vi.fn();
    await expect(executeOriginCloudflareProvider(request, enabledEnv, fetchMock as unknown as OriginFetch, { catalog: staleCatalog, nowMs: NOW_MS }))
      .rejects.toMatchObject({ name: "OriginCloudflarePreflightError", reason: "evidence-stale" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks inference when the plan proof detects a paid plan", async () => {
    const fetchMock = vi.fn(async () => cloudflareJson({ default_usage_model: "standard" }));
    const error = await executeOriginCloudflareProvider(request, enabledEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginCloudflarePreflightError);
    expect(error).toMatchObject({ reason: "plan-proof-failed", proofReason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never fails over a required-tool request", async () => {
    const fetchMock = vi.fn();
    const toolRequest: OriginProviderExecutionRequest = {
      ...request,
      requiredTool: { name: "emit_result", description: "test", parameters: { type: "object" } },
    };
    await expect(executeOriginCloudflareProvider(toolRequest, enabledEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS }))
      .rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proves the free plan, runs only the fixed model, and returns verified zero-cost evidence", async () => {
    const fetchMock = fullFetch(async () => cloudflareJson({
      response: "確認結果です。",
      usage: { prompt_tokens: 100_000, completion_tokens: 50_000 },
    }));
    const result = await executeOriginCloudflareProvider(request, enabledEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS });
    expect(result.text).toBe("確認結果です。");
    expect(result.actualCostUsd).toBe(0);
    expect(result.usage).toEqual({ promptTokens: 100_000, completionTokens: 50_000, totalTokens: 150_000, costUsd: 0 });
    expect(result.routingEvidence).toEqual({
      requestedModel: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL,
      servedModel: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL,
      strategy: "verified-free-failover",
      provider: "Cloudflare",
      attempt: 2,
      fallbackUsed: true,
      neurons: 2273,
    });
    expect(result.transportRequestCount).toBe(4);
    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    expect(calls.map((call) => String(call[0]))).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/account-settings`,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/subscriptions`,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/models/schema?model=${encodeURIComponent(ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL)}`,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL}`,
    ]);
    for (const call of calls.slice(0, 3)) {
      expect((call[1] as RequestInit).headers).toEqual(expect.objectContaining({ Authorization: `Bearer ${PROOF_TOKEN}` }));
      expect((call[1] as RequestInit).method).toBe("GET");
    }
    const inferenceInit = calls[3][1] as RequestInit;
    expect(inferenceInit.headers).toEqual(expect.objectContaining({ Authorization: `Bearer ${AI_TOKEN}` }));
    const inferenceBody = JSON.parse(String(inferenceInit.body)) as { messages: Array<{ role: string; content: string }>; max_tokens: number };
    expect(inferenceBody.messages[0]).toEqual({ role: "system", content: "安全に回答してください。" });
    expect(inferenceBody.messages[1]).toEqual({ role: "user", content: "確認してください" });
    expect(inferenceBody.max_tokens).toBe(4096);
  });

  it("maps an inference 429 to PROVIDER_RATE_LIMITED", async () => {
    const fetchMock = fullFetch(async () => new Response("rate limited", { status: 429 }));
    await expect(executeOriginCloudflareProvider(request, enabledEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS }))
      .rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", status: 429, retryable: false, diagnostic: { transportRequestCount: 4 } });
  });

  it("maps a free-allocation exhaustion envelope to PROVIDER_RATE_LIMITED", async () => {
    const fetchMock = fullFetch(async () => cloudflareJson(null, 200, [{ code: 4006, message: "Free plan daily Neurons allocation exceeded" }]));
    await expect(executeOriginCloudflareProvider(request, enabledEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS }))
      .rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
  });

  it("rejects an empty inference response", async () => {
    const fetchMock = fullFetch(async () => cloudflareJson({ response: "   " }));
    await expect(executeOriginCloudflareProvider(request, enabledEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS }))
      .rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
  });

  it("never leaks tokens or upstream bodies into errors", async () => {
    const fetchMock = fullFetch(async () => new Response(`failure body mentioning ${PROOF_TOKEN} and ${AI_TOKEN}`, { status: 500 }));
    const error = await executeOriginCloudflareProvider(request, enabledEnv, fetchMock as unknown as OriginFetch, { nowMs: NOW_MS })
      .catch((caught: unknown) => caught) as OriginProviderError;
    expect(error).toBeInstanceOf(OriginProviderError);
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(String(error)).not.toContain(PROOF_TOKEN);
    expect(String(error)).not.toContain(AI_TOKEN);
    expect(JSON.stringify(error.diagnostic ?? {})).not.toContain(PROOF_TOKEN);
    expect(JSON.stringify(error.diagnostic ?? {})).not.toContain(AI_TOKEN);
  });
});
