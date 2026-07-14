import { describe, expect, it } from "vitest";
import worker from "./index.mjs";

const freeEnv = {
  FREE_ONLY: "true",
  OPENROUTER_FREE_MODEL: "google/gemini-2.5-flash:free",
};

describe("ACOS Cloudflare Worker", () => {
  it("returns a lightweight health response", async () => {
    const response = await worker.fetch(new Request("https://example.test/health"), freeEnv);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "acos-worker",
      freeOnly: true,
    });
  });

  it("reports status without exposing secrets", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/v1/status"), freeEnv);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ready",
      runtime: "cloudflare-worker",
      freeOnly: true,
      aiConfigured: false,
    });
    expect(JSON.stringify(body)).not.toContain("API_KEY");
  });

  it("fails immediately when the OpenRouter secret is absent", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/api/v1/ai/free-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      }),
      freeEnv,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "OPENROUTER_NOT_CONFIGURED" });
  });

  it("rejects execution when free-only mode is disabled", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/api/v1/ai/free-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      }),
      { ...freeEnv, FREE_ONLY: "false", OPENROUTER_API_KEY: "test-key" },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "FREE_ONLY_REQUIRED" });
  });
});
