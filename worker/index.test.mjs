import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index.mjs";

const freeEnv = {
  FREE_ONLY: "true",
  OPENROUTER_FREE_MODEL: "google/gemini-2.5-flash:free",
  APP_URL: "https://acos-staging.pages.dev",
  LOCAL_DEV_ORIGIN: "http://localhost:5173",
  OPENROUTER_API_KEY: "test-key",
};

function aiRequest(body, method = "POST", origin = freeEnv.APP_URL) {
  return new Request("https://example.test/api/v1/ai/free-chat", {
    method,
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: method === "POST" ? body : undefined,
  });
}

describe("ACOS Cloudflare Worker", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns a lightweight health response", async () => {
    const response = await worker.fetch(new Request("https://example.test/health"), freeEnv);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "acos-worker", freeOnly: true });
  });

  it("reports status without exposing secrets", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/v1/status"), freeEnv);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ready", runtime: "cloudflare-worker", freeOnly: true, aiConfigured: true });
    expect(JSON.stringify(body)).not.toContain("API_KEY");
  });

  it("handles OPTIONS for the configured Pages origin", async () => {
    const response = await worker.fetch(aiRequest(undefined, "OPTIONS"), freeEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(freeEnv.APP_URL);
  });

  it("does not grant CORS to an unconfigured Pages origin", async () => {
    const response = await worker.fetch(aiRequest(undefined, "OPTIONS", "https://attacker.pages.dev"), freeEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns 405 for invalid methods", async () => {
    const response = await worker.fetch(aiRequest(undefined, "GET"), freeEnv);
    expect(response.status).toBe(405);
  });

  it("fails immediately when the OpenRouter secret is absent", async () => {
    const response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), { ...freeEnv, OPENROUTER_API_KEY: "" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("OPENROUTER_NOT_CONFIGURED");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects execution when free-only mode is disabled", async () => {
    const response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), { ...freeEnv, FREE_ONLY: "false" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("FREE_ONLY_REQUIRED");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await worker.fetch(aiRequest("invalid-json"), freeEnv);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_JSON");
  });

  it("returns 400 for empty prompt", async () => {
    const response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "   " })), freeEnv);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_PROMPT");
  });

  it("returns 400 for overly long prompt", async () => {
    const response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "a".repeat(4001) })), freeEnv);
    expect(response.status).toBe(400);
    expect((await response.json()).maxLength).toBe(4000);
  });

  it("rejects a configured paid or automatic model before fetch", async () => {
    for (const model of ["openai/gpt-4", "openrouter/auto", "vendor/model-free-trial"]) {
      const response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), {
        ...freeEnv,
        OPENROUTER_FREE_MODEL: model,
      });
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe("FREE_MODEL_REQUIRED");
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied model and uses the configured free model", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "Hi" } }] }) });
    const response = await worker.fetch(
      aiRequest(JSON.stringify({ prompt: "hello", model: "openai/gpt-4" })),
      freeEnv,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).model).toBe(freeEnv.OPENROUTER_FREE_MODEL);
  });

  it("maps OpenRouter 429 and 5xx without retrying", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 429 });
    let response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), freeEnv);
    expect(response.status).toBe(429);

    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), freeEnv);
    expect(response.status).toBe(503);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("handles invalid or empty upstream responses", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("bad json"); } });
    let response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), freeEnv);
    expect((await response.json()).error).toBe("INVALID_UPSTREAM_RESPONSE");

    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [] }) });
    response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), freeEnv);
    expect((await response.json()).error).toBe("EMPTY_MODEL_RESPONSE");
  });

  it("handles network errors and timeouts", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("Network Error"));
    let response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), freeEnv);
    expect((await response.json()).error).toBe("UPSTREAM_FAILURE");

    const abortError = new Error("AbortError");
    abortError.name = "AbortError";
    globalThis.fetch.mockRejectedValueOnce(abortError);
    response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), freeEnv);
    expect((await response.json()).error).toBe("UPSTREAM_TIMEOUT");
  });

  it("returns a successful no-store response", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: " Hi there! " } }] }) });
    const response = await worker.fetch(aiRequest(JSON.stringify({ prompt: "hello" })), freeEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ content: "Hi there!", model: freeEnv.OPENROUTER_FREE_MODEL, freeOnly: true });
  });
});