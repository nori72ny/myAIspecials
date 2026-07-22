import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index.mjs";

const freeEnv = {
  FREE_ONLY: "true",
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

  it("reports that provider execution is disabled without exposing secrets", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/v1/status"), freeEnv);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ready",
      runtime: "cloudflare-worker",
      freeOnly: true,
      aiConfigured: true,
      providerExecutionEnabled: false,
    });
    expect(JSON.stringify(body)).not.toContain("test-key");
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

  it("fails closed without parsing, echoing, or transmitting the prompt", async () => {
    const privatePrompt = "private test value that must not leave the worker";
    const response = await worker.fetch(aiRequest(JSON.stringify({ prompt: privatePrompt })), freeEnv);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "ORIGIN_LEGACY_PROVIDER_PATH_DISABLED",
      message: "This legacy provider endpoint is disabled until it is migrated to the ORIGIN safety and free-only execution policy.",
      retryable: false,
    });
    expect(JSON.stringify(body)).not.toContain(privatePrompt);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
