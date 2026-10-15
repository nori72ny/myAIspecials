import { afterEach, describe, expect, it } from "vitest";
import { GeminiLLMClient } from "./GeminiLLMClient";

const previousFreeOnly = process.env.FREE_ONLY;
const previousGeminiKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (previousFreeOnly === undefined) delete process.env.FREE_ONLY;
  else process.env.FREE_ONLY = previousFreeOnly;

  if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousGeminiKey;
});

describe("GeminiLLMClient FREE_ONLY enforcement", () => {
  it("blocks native Gemini API calls instead of silently rewriting to a possibly billable model", async () => {
    process.env.FREE_ONLY = "true";
    process.env.GEMINI_API_KEY = "synthetic-test-key";

    const client = new GeminiLLMClient();

    await expect(client.generateText("synthetic test prompt", undefined, "gemini-2.5-flash"))
      .rejects.toThrow("FREE_ONLY_PROVIDER_BLOCKED");
  });

  it("blocks an OpenRouter model slug instead of silently converting it to native Gemini", async () => {
    process.env.FREE_ONLY = "true";
    process.env.GEMINI_API_KEY = "synthetic-test-key";

    const client = new GeminiLLMClient();

    await expect(client.generateText("synthetic test prompt", undefined, "openrouter/example/model:free"))
      .rejects.toThrow("FREE_ONLY_PROVIDER_BLOCKED");
  });
});
