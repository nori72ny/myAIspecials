import { describe, expect, it, vi } from "vitest";
import { executeOriginProvider, type OriginFetch } from "./originProviderClient";
import {
  ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL,
  ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy";

const plan: OriginExecutionPlan = {
  providerId: ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID,
  providerLabel: "Google AI Studio",
  modelId: ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL,
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 30_000,
  requiresOwnerApproval: false,
  reason: "security regression test",
  providerDataPolicy: {
    allowProviderFallbacks: true,
    dataCollection: "deny",
    requireZeroDataRetention: false,
  },
  modelEvidence: {
    providerId: ORIGIN_GOOGLE_AI_STUDIO_FREE_PROVIDER_ID,
    verifiedAt: "2026-09-01T00:00:00.000Z",
    reviewAfter: "2026-09-30T23:59:59.999Z",
    sourceUrl: "https://ai.google.dev/gemini-api/docs",
  },
};

describe("Gemini API-key transport boundary", () => {
  it("never places the API key in the request URL and sends it through the header", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.search).toBe("");
      expect(url.searchParams.has("key")).toBe(false);
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("synthetic-gemini-key");
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Gemini response" }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await executeOriginProvider(
      {
        plan,
        messages: [{ role: "user", content: "確認してください" }],
        systemInstruction: "安全に回答してください。",
      },
      { GEMINI_API_KEY: "synthetic-gemini-key" },
      fetchMock as unknown as OriginFetch,
    );

    expect(result.text).toBe("Gemini response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
