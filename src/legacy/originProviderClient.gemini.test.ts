import { describe, expect, it } from "vitest";
import { ORIGIN_OPENROUTER_FREE_MODEL } from "../lib/orchestration/OriginExecutionPolicy.js";
import { executeOriginProvider, OriginProviderError, type OriginProviderExecutionRequest } from "./originProviderClient.js";

const request: OriginProviderExecutionRequest = {
  plan: {
    providerId: "openrouter-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_OPENROUTER_FREE_MODEL,
    taskType: "answer",
    freeOnly: true,
    estimatedCostUsd: 0,
    timeoutMs: 20_000,
    requiresOwnerApproval: false,
    reason: "test",
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: false },
    modelEvidence: { providerId: "openrouter-free", verifiedAt: "2026-09-04T00:00:00.000Z", reviewAfter: "2026-09-14T00:00:00.000Z", sourceUrl: "https://openrouter.ai/models/google/gemma-4-31b-it:free" },
  },
  messages: [{ role: "user", content: "日本語で短く答えてください。" }],
  systemInstruction: "You are ORIGIN Personal AI.",
};

const openRouterRateLimited = () => new Response(JSON.stringify({ error: { metadata: { error_type: "rate_limit_exceeded" } } }), { status: 429 });
const geminiOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Geminiからの回答です。" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8, totalTokenCount: 18 } }), { status: 200, headers: { "Content-Type": "application/json" } });

function fetchSequence(...responses: Response[]) {
  let index = 0;
  return async () => responses[index++] ?? responses[responses.length - 1];
}

describe("bounded Gemini secondary route", () => {
  it("falls back once from OpenRouter 429 to Gemini and records the secondary route", async () => {
    const fetchImpl = fetchSequence(openRouterRateLimited(), geminiOk());
    const result = await executeOriginProvider(request, { OPENROUTER_API_KEY: "test-openrouter", GEMINI_API_KEY: "test-gemini", ORIGIN_GEMINI_FREE_ONLY: "true" }, fetchImpl as typeof fetch);
    expect(result.text).toBe("Geminiからの回答です。");
    expect(result.actualCostUsd).toBe(0);
    expect(result.routingEvidence).toMatchObject({ provider: "Gemini", servedModel: "gemini-2.5-flash", strategy: "bounded-secondary", attempt: 1, fallbackUsed: true });
  });

  it("does not send sensitive prompts to Gemini after an OpenRouter failure", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return openRouterRateLimited(); };
    await expect(executeOriginProvider({ ...request, messages: [{ role: "user", content: "APIキーは秘密です。これを要約してください。" }] }, { OPENROUTER_API_KEY: "test-openrouter", GEMINI_API_KEY: "test-gemini", ORIGIN_GEMINI_FREE_ONLY: "true" }, fetchImpl as typeof fetch)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    expect(calls).toBe(1);
  });

  it("never retries the same provider before trying the bounded secondary route", async () => {
    const fetchImpl = fetchSequence(openRouterRateLimited(), new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: "test-openrouter", GEMINI_API_KEY: "test-gemini", ORIGIN_GEMINI_FREE_ONLY: "true" }, fetchImpl as typeof fetch)).rejects.toBeInstanceOf(OriginProviderError);
  });
});
