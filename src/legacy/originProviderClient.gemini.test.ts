import { describe, expect, it } from "vitest";
import { ORIGIN_OPENROUTER_FREE_MODEL } from "../lib/orchestration/OriginExecutionPolicy.js";
import { executeOriginProvider, type OriginProviderExecutionRequest } from "./originProviderClient.js";

const request: OriginProviderExecutionRequest = {
  plan: {
    providerId: "openrouter-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_OPENROUTER_FREE_MODEL,
    taskType: "research",
    freeOnly: true,
    estimatedCostUsd: 0,
    timeoutMs: 20_000,
    requiresOwnerApproval: false,
    reason: "test",
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: false },
    modelEvidence: { providerId: "openrouter-free", verifiedAt: "2026-09-07T00:00:00.000Z", reviewAfter: "2026-09-17T00:00:00.000Z", sourceUrl: "https://openrouter.ai/google/gemma-4-26b-a4b-it:free" },
  },
  messages: [{ role: "user", content: "日本語で短く答えてください。" }],
  systemInstruction: "You are ORIGIN Personal AI.",
};

describe("provider privacy isolation", () => {
  it.each([408, 429, 500, 502, 503, 504])("never falls back to Gemini after upstream HTTP %s", async (status) => {
    const calls: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status });
    };

    await expect(executeOriginProvider(
      request,
      { OPENROUTER_API_KEY: "test-openrouter", GEMINI_API_KEY: "test-gemini", ORIGIN_GEMINI_FREE_ONLY: "true" },
      fetchImpl as typeof fetch,
    )).rejects.toMatchObject({ code: expect.stringMatching(/^PROVIDER_/) });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls.some((url) => url.includes("generativelanguage.googleapis.com"))).toBe(false);
  });

  it("rejects a Gemini execution plan before any network request", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return new Response("{}", { status: 200 }); };
    const geminiRequest = {
      ...request,
      plan: { ...request.plan, providerId: "google-ai-studio-free", modelId: "gemini-2.5-flash" },
    } as OriginProviderExecutionRequest;

    await expect(executeOriginProvider(
      geminiRequest,
      { OPENROUTER_API_KEY: "test-openrouter", GEMINI_API_KEY: "test-gemini" },
      fetchImpl as typeof fetch,
    )).rejects.toMatchObject({ code: "PROVIDER_POLICY_VIOLATION" });
    expect(calls).toBe(0);
  });
});
