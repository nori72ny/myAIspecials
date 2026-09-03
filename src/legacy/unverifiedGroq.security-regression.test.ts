import { describe, expect, it, vi } from "vitest";
import { executeOriginProvider, type OriginFetch } from "./originProviderClient";
import {
  ORIGIN_GROQ_FREE_MODEL,
  ORIGIN_GROQ_FREE_PROVIDER_ID,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy";

const groqPlan = {
  providerId: ORIGIN_GROQ_FREE_PROVIDER_ID,
  providerLabel: "Groq",
  modelId: ORIGIN_GROQ_FREE_MODEL,
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 20_000,
  requiresOwnerApproval: false,
  reason: "security regression: unverified provider must fail closed",
  providerDataPolicy: {
    allowProviderFallbacks: true,
    dataCollection: "deny",
    requireZeroDataRetention: false,
  },
  modelEvidence: {
    providerId: ORIGIN_GROQ_FREE_PROVIDER_ID,
    verifiedAt: "2026-09-03T00:00:00.000Z",
    reviewAfter: "2026-09-30T23:59:59.999Z",
    sourceUrl: "https://console.groq.com/docs/models",
  },
} as unknown as OriginExecutionPlan;

describe("Groq zero-cost boundary", () => {
  it("fails closed before network execution because the current model has no verified public $0 contract", async () => {
    const fetchMock = vi.fn() as unknown as OriginFetch;

    await expect(
      executeOriginProvider(
        {
          plan: groqPlan,
          messages: [{ role: "user", content: "安全境界を確認してください" }],
          systemInstruction: "安全に検証してください。",
        },
        { GROQ_API_KEY: "synthetic-groq-key" },
        fetchMock,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_POLICY_VIOLATION",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
