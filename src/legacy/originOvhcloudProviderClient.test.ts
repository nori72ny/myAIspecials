import { describe, expect, it, vi } from "vitest";
import {
  assertOriginOvhcloudExecutionResult,
  executeOriginOvhcloudProvider,
  isOriginOvhcloudFailoverEnabled,
  OriginOvhcloudPreflightError,
} from "./originOvhcloudProviderClient";
import {
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
} from "./originProviderClient";
import type { OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";
import {
  DEFAULT_ORIGIN_OVHCLOUD_FREE_MODEL_CATALOG,
  ORIGIN_OVHCLOUD_FREE_MODEL_ID,
} from "../lib/orchestration/OriginOvhcloudFreeModelCatalog";

const NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");
const AFTER_REVIEW_MS = Date.parse("2026-12-26T00:00:00.000Z");
const enabledEnv = { ORIGIN_OVH_FAILOVER_ENABLED: "true" } as NodeJS.ProcessEnv;

const catalogEntry = DEFAULT_ORIGIN_OVHCLOUD_FREE_MODEL_CATALOG[0];
const ovhcloudPlan: OriginExecutionPlan = {
  providerId: "ovhcloud-free",
  providerLabel: "ORIGIN 無料AI",
  modelId: ORIGIN_OVHCLOUD_FREE_MODEL_ID,
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 30_000,
  requiresOwnerApproval: false,
  reason: "test",
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  modelEvidence: {
    providerId: "ovhcloud-free",
    verifiedAt: catalogEntry.verifiedAt,
    reviewAfter: catalogEntry.reviewAfter,
    sourceUrl: catalogEntry.sourceUrl,
  },
};
const request: OriginProviderExecutionRequest = {
  plan: ovhcloudPlan,
  messages: [{ role: "user", content: "短く要約してください" }],
  systemInstruction: "安全に回答してください。",
  ovhcloudFallbackEligible: true,
};

function jsonFetch(status: number, body: unknown, headers: Record<string, string> = {}): OriginFetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })) as unknown as OriginFetch;
}

function successBody(content = "第4経路の回答です。"): Record<string, unknown> {
  return {
    model: ORIGIN_OVHCLOUD_FREE_MODEL_ID,
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 },
  };
}

describe("OVHcloud failover switch", () => {
  it("is on only for the exact value 'true'", () => {
    expect(isOriginOvhcloudFailoverEnabled({ ORIGIN_OVH_FAILOVER_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isOriginOvhcloudFailoverEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginOvhcloudFailoverEnabled({ ORIGIN_OVH_FAILOVER_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginOvhcloudFailoverEnabled({ ORIGIN_OVH_FAILOVER_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("OVHcloud provider client", () => {
  it("skips before execution while the switch is off and sends nothing", async () => {
    const fetchImpl = jsonFetch(200, successBody());
    await expect(executeOriginOvhcloudProvider(request, {} as NodeJS.ProcessEnv, fetchImpl, { nowMs: NOW_MS }))
      .rejects.toEqual(new OriginOvhcloudPreflightError("not-enabled"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends one anonymous request and returns a verified $0 result", async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const result = await executeOriginOvhcloudProvider(request, enabledEnv, fetchImpl, { nowMs: NOW_MS });
    expect(result.text).toBe("第4経路の回答です。");
    expect(result.actualCostUsd).toBe(0);
    expect(result.transportRequestCount).toBe(1);
    expect(result.routingEvidence).toEqual({
      requestedModel: ORIGIN_OVHCLOUD_FREE_MODEL_ID,
      servedModel: ORIGIN_OVHCLOUD_FREE_MODEL_ID,
      strategy: "verified-free-failover",
      provider: "OVHcloud",
      attempt: 4,
      fallbackUsed: true,
    });
    expect(result.usage).toEqual({ promptTokens: 40, completionTokens: 12, totalTokens: 52, costUsd: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions");
    // Anonymous tier: no credential of any kind is sent.
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    const sentBody = JSON.parse(String(init.body)) as { model: string; messages: Array<{ role: string }> };
    expect(sentBody.model).toBe(ORIGIN_OVHCLOUD_FREE_MODEL_ID);
    expect(sentBody.messages[0].role).toBe("system");
  });

  it("classifies an anonymous-tier 429 as a rate limit with the provider's wait", async () => {
    const fetchImpl = jsonFetch(429, { error: { code: "rate_limit_exceeded", message: "Too many requests" } }, { "Retry-After": "30" });
    const error = await executeOriginOvhcloudProvider(request, enabledEnv, fetchImpl, { nowMs: NOW_MS }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    expect((error as OriginProviderError).retryAfterSeconds).toBe(30);
    expect((error as OriginProviderError).diagnostic?.transportRequestCount).toBe(1);
    expect((error as OriginProviderError).diagnostic?.upstreamStatus).toBe(429);
  });

  it("fails closed on a served-model mismatch", async () => {
    const fetchImpl = jsonFetch(200, { ...successBody(), model: "gpt-oss-120b" });
    const error = await executeOriginOvhcloudProvider(request, enabledEnv, fetchImpl, { nowMs: NOW_MS }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_ROUTING_UNVERIFIED");
  });

  it("classifies an empty completion as an invalid response", async () => {
    const fetchImpl = jsonFetch(200, successBody(""));
    const error = await executeOriginOvhcloudProvider(request, enabledEnv, fetchImpl, { nowMs: NOW_MS }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_INVALID_RESPONSE");
  });

  it("skips before execution when the catalog evidence is stale", async () => {
    const fetchImpl = jsonFetch(200, successBody());
    await expect(executeOriginOvhcloudProvider(request, enabledEnv, fetchImpl, { nowMs: AFTER_REVIEW_MS }))
      .rejects.toEqual(new OriginOvhcloudPreflightError("evidence-stale"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a plan for another provider as a policy violation", async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const wrongPlan: OriginExecutionPlan = { ...ovhcloudPlan, providerId: "groq-free" };
    const error = await executeOriginOvhcloudProvider({ ...request, plan: wrongPlan }, enabledEnv, fetchImpl, { nowMs: NOW_MS }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_POLICY_VIOLATION");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects required-tool requests before execution", async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const toolRequest: OriginProviderExecutionRequest = {
      ...request,
      requiredTool: { name: "lookup", description: "test", parameters: {} },
    };
    const error = await executeOriginOvhcloudProvider(toolRequest, enabledEnv, fetchImpl, { nowMs: NOW_MS }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginProviderError);
    expect((error as OriginProviderError).code).toBe("PROVIDER_POLICY_VIOLATION");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("assertOriginOvhcloudExecutionResult", () => {
  it("accepts the client's own result shape and rejects a non-zero cost", async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const result = await executeOriginOvhcloudProvider(request, enabledEnv, fetchImpl, { nowMs: NOW_MS });
    expect(() => assertOriginOvhcloudExecutionResult(result, ORIGIN_OVHCLOUD_FREE_MODEL_ID)).not.toThrow();
    expect(() => assertOriginOvhcloudExecutionResult({ ...result, actualCostUsd: 1 as unknown as 0 }))
      .toThrowError(OriginProviderError);
    expect(() => assertOriginOvhcloudExecutionResult({
      ...result,
      routingEvidence: { ...result.routingEvidence, provider: "Groq" },
    })).toThrowError(OriginProviderError);
  });
});
