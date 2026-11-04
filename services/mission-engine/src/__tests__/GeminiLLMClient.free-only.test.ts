import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiLLMClient } from "../infrastructure/ai/GeminiLLMClient";

describe("GeminiLLMClient FREE_ONLY boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not allow FREE_ONLY=false to enable native Gemini in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FREE_ONLY", "false");
    vi.stubEnv("GEMINI_API_KEY", "test-key-that-must-never-be-used");

    const client = new GeminiLLMClient();

    await expect(client.generateText("sensitive prompt", "system", "gemini-2.5-flash"))
      .rejects.toThrow("FREE_ONLY_PROVIDER_BLOCKED");
  });

  it("rejects native Gemini requests before any provider call in FREE_ONLY mode", async () => {
    vi.stubEnv("FREE_ONLY", "true");
    vi.stubEnv("GEMINI_API_KEY", "test-key-that-must-never-be-used");

    const client = new GeminiLLMClient();

    await expect(client.generateText("sensitive prompt", "system", "gemini-3.5-flash"))
      .rejects.toThrow("FREE_ONLY_PROVIDER_BLOCKED");
  });
});
