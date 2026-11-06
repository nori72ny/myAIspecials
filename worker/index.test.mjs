import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.mjs";

const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";

const freeEnv = {
  FREE_ONLY: "true",
  CF_WORKERS_AI_PREVIEW_ENABLED: "false",
  CF_WORKERS_AI_FREE_PLAN_CONFIRMED: "false",
  APP_URL: "https://acos-staging.pages.dev",
  LOCAL_DEV_ORIGIN: "http://localhost:5173",
};

function aiRequest(body, { method = "POST", origin = freeEnv.APP_URL, token } = {}) {
  const headers = { "content-type": "application/json", origin };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("https://example.test/api/v1/ai/free-chat", {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
}

function enabledEnv(run = vi.fn().mockResolvedValue({
  response: "テスト応答",
  usage: { prompt_tokens: 12, completion_tokens: 8 },
})) {
  return {
    ...freeEnv,
    CF_WORKERS_AI_PREVIEW_ENABLED: "true",
    CF_WORKERS_AI_FREE_PLAN_CONFIRMED: "true",
    ORIGIN_PREVIEW_TOKEN: "synthetic-preview-token-0123456789abcdef",
    CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    CLOUDFLARE_API_TOKEN: "synthetic-cloudflare-readonly-token-0123456789",
    AI: { run },
  };
}

function cloudflareJson(result, status = 200, errors = []) {
  return new Response(JSON.stringify({
    success: status >= 200 && status < 300,
    result,
    ...(Array.isArray(result) ? {
      result_info: { count: result.length, page: 1, per_page: 20, total_count: result.length },
    } : {}),
    errors,
    messages: [],
  }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFreePlanProof() {
  return vi.fn()
    .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
    .mockResolvedValueOnce(cloudflareJson([]))
    .mockResolvedValueOnce(cloudflareJson({ input: {}, output: {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ACOS Cloudflare Workers AI preview", () => {
  it("returns a lightweight health response", async () => {
    const response = await worker.fetch(new Request("https://example.test/health"), freeEnv);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "acos-worker",
      freeOnly: true,
    });
  });

  it("reports preview execution controls without exposing secrets", async () => {
    const env = enabledEnv();
    const response = await worker.fetch(new Request("https://example.test/api/v1/status"), env);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ready",
      runtime: "cloudflare-worker",
      freeOnly: true,
      aiBindingConfigured: true,
      previewControlsConfigured: true,
      freePlanProofRequired: true,
      model: MODEL_ID,
    });
    expect(JSON.stringify(body)).not.toContain(env.ORIGIN_PREVIEW_TOKEN);
  });

  it("handles OPTIONS for the configured Pages origin", async () => {
    const response = await worker.fetch(aiRequest(undefined, { method: "OPTIONS" }), freeEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(freeEnv.APP_URL);
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("does not grant CORS to an unconfigured Pages origin", async () => {
    const response = await worker.fetch(
      aiRequest(undefined, { method: "OPTIONS", origin: "https://attacker.pages.dev" }),
      freeEnv,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns 405 for invalid methods", async () => {
    const response = await worker.fetch(aiRequest(undefined, { method: "GET" }), freeEnv);
    expect(response.status).toBe(405);
  });

  it("fails closed by default without parsing or transmitting the prompt", async () => {
    const privatePrompt = "private test value that must not leave the worker";
    const run = vi.fn();
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: privatePrompt })),
      { ...freeEnv, AI: { run } },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("ORIGIN_CF_AI_PREVIEW_NOT_ENABLED");
    expect(body.retryable).toBe(false);
    expect(JSON.stringify(body)).not.toContain(privatePrompt);
    expect(run).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps preview inference disabled when the server-side token is weak", async () => {
    const run = vi.fn();
    const env = { ...enabledEnv(run), ORIGIN_PREVIEW_TOKEN: "short" };
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: "short" }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("ORIGIN_CF_AI_PREVIEW_NOT_ENABLED");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects requests without the server-side preview token", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" })),
      env,
    );

    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects unapproved browser origins before inference", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), {
        origin: "https://attacker.pages.dev",
        token: env.ORIGIN_PREVIEW_TOKEN,
      }),
      env,
    );

    expect(response.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("calls only the fixed Cloudflare ZDR model and reports billing as unmeasured", async () => {
    const run = vi.fn().mockResolvedValue({
      response: "こんにちは。これはプレビュー応答です。",
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    });
    const env = enabledEnv(run);
    const fetchMock = mockFreePlanProof();
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/account-settings",
      "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/subscriptions",
      `https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/models/schema?model=${encodeURIComponent(MODEL_ID)}`,
    ]);
    expect(fetchMock.mock.calls.every(call => call[1]?.method === "GET")).toBe(true);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("こんにちは");
    expect(run).toHaveBeenCalledWith(MODEL_ID, expect.objectContaining({
      max_tokens: 1024,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "こんにちは" }),
      ]),
    }), { rejectIfBusy: true });
    expect(body).toEqual({
      response: "こんにちは。これはプレビュー応答です。",
      provider: "cloudflare-workers-ai",
      model: MODEL_ID,
      usage: { promptTokens: 12, completionTokens: 8 },
      freeAllocationEligible: true,
      planEvidenceStatus: "VERIFIED_WORKERS_FREE",
      actualCostUsd: null,
      costEvidenceStatus: "NOT_MEASURED",
      retryable: false,
    });
  });

  it("rejects a paid Workers usage model before inference", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      cloudflareJson({ default_usage_model: "standard" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when the Billing subscriptions response is paginated", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [],
        result_info: { count: 20, page: 1, per_page: 20, total_count: 21 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("CLOUDFLARE_BILLING_READ_INCOMPLETE");
    expect(run).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an active paid Workers subscription even if the usage model is bundled", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(cloudflareJson([{
        state: "Paid",
        price: 5,
        rate_plan: { id: "workers_paid", public_name: "Workers Paid", sets: ["workers"] },
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when an active Workers subscription omits its billed price", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(cloudflareJson([{
        state: "Paid",
        rate_plan: { id: "free", public_name: "Workers Free", sets: ["workers"] },
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a nominal free Workers plan with a nonzero billed price", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(cloudflareJson([{
        state: "Paid",
        price: 0.01,
        rate_plan: { id: "free", public_name: "Workers Free", sets: ["workers"] },
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when the Workers usage model is missing or ambiguous", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const fetchMock = vi.fn().mockResolvedValueOnce(cloudflareJson({}));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("CLOUDFLARE_WORKERS_PLAN_UNVERIFIED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when Billing Read evidence is unavailable", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(cloudflareJson(null, 403));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("CLOUDFLARE_BILLING_READ_REQUIRED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a model that requires a paid plan", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareJson({ default_usage_model: "bundled" }))
      .mockResolvedValueOnce(cloudflareJson([]))
      .mockResolvedValueOnce(cloudflareJson(null, 403, [{ code: 5035 }]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects invalid prompts without calling the provider", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: " " }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies before inference", async () => {
    const run = vi.fn();
    const env = enabledEnv(run);
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "x".repeat(70_000) }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );

    expect(response.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not retry or switch providers when Cloudflare inference fails", async () => {
    const run = vi.fn().mockRejectedValue(new Error("synthetic upstream failure"));
    const env = enabledEnv(run);
    vi.stubGlobal("fetch", mockFreePlanProof());
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "こんにちは" }), { token: env.ORIGIN_PREVIEW_TOKEN }),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("ORIGIN_CF_AI_PROVIDER_UNAVAILABLE");
    expect(body.retryable).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
