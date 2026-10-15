import { afterEach, describe, expect, it, vi } from "vitest";
import { isOriginFreeOpenRouterModelId, OpenRouterPlugin } from "./OpenRouterPlugin";
import { ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL } from "../../orchestration/OriginFreeModelCatalog";
import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY } from "../../../legacy/zeroCostRoutingPolicy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouterPlugin zero-cost policy", () => {
  it("accepts only an explicit terminal :free model suffix", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldFreeOnly = process.env.FREE_ONLY;
    process.env.NODE_ENV = "test";
    process.env.FREE_ONLY = "false";
    try {
      const plugin = new OpenRouterPlugin("mock-test-key");
      await expect(plugin.generateText(ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL, "hello"))
        .resolves.toContain("Mock");
      for (const rejected of [
        "google/gemma-4-31b-it:free",
        "inclusionai/ling-3.0-flash-sante:FREE",
        "inclusionai/ling-3.0-flash-sante:Free",
        "openrouter/auto:free",
        "openrouter/auto",
        "inclusionai/ling-3.0-flash-sante:free-extra",
        "inclusionai/ling-3.0-flash-sante:free:free",
        "inclusionai/ling-3.0-flash-sante-free",
        " inclusionai/ling-3.0-flash-sante:free",
        "inclusionai/ling-3.0-flash-sante:free\n",
        "inclusionai/ling-3.0-flash-sante:free,google/gemma-4-31b-it:free",
        "inclusionai%2fling-3.0-flash-sante%3afree",
        "vendor/fake-model:free",
      ]) {
        expect(isOriginFreeOpenRouterModelId(rejected), rejected).toBe(false);
        await expect(plugin.generateText(rejected, "hello"))
          .rejects.toMatchObject({ message: "FREE_MODEL_UNAVAILABLE", statusCode: 400 });
      }
      expect(isOriginFreeOpenRouterModelId(null)).toBe(false);
      expect(isOriginFreeOpenRouterModelId(42)).toBe(false);
    } finally {
      if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = oldNodeEnv;
      if (oldFreeOnly === undefined) delete process.env.FREE_ONLY;
      else process.env.FREE_ONLY = oldFreeOnly;
    }
  });

  it("sends zero-cost and ZDR provider constraints on the actual request", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldFreeOnly = process.env.FREE_ONLY;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({
        id: "test-request",
        choices: [{ message: { content: "verified response" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "test-request" } })
    );
    process.env.NODE_ENV = "production";
    process.env.FREE_ONLY = "false";
    vi.stubGlobal("fetch", fetchMock);
    try {
      const plugin = new OpenRouterPlugin("test-key");
      await expect(plugin.generateText(ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL, "hello"))
        .resolves.toBe("verified response");
      const request = fetchMock.mock.calls[0]?.[1];
      expect(request).toBeDefined();
      const body = JSON.parse(String(request?.body));
      expect(body.model).toBe(ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL);
      expect(body.provider).toEqual(ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY);
      expect(body.provider).toMatchObject({
        allow_fallbacks: false,
        data_collection: "deny",
        zdr: true,
        max_price: { prompt: 0, completion: 0, request: 0 },
      });
      await expect(plugin.generateText("google/gemma-4-31b-it", "hello"))
        .rejects.toMatchObject({ message: "FREE_MODEL_UNAVAILABLE", statusCode: 400 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = oldNodeEnv;
      if (oldFreeOnly === undefined) delete process.env.FREE_ONLY;
      else process.env.FREE_ONLY = oldFreeOnly;
    }
  });
});
