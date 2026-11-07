import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG,
  ORIGIN_GROQ_FREE_MODEL_ID,
  selectCurrentOriginGroqFreeModel,
  type OriginGroqFreeModelEvidence,
} from "./OriginGroqFreeModelCatalog";
import {
  buildOriginGroqRoutePlan,
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
} from "./OriginExecutionPolicy";

const DURING_MS = Date.parse("2026-11-08T12:00:00.000Z");
const AFTER_REVIEW_MS = Date.parse("2026-11-23T00:00:00.000Z");

describe("Groq free model evidence catalog", () => {
  it("pins the verified free model and the 2026-11-22 review deadline", () => {
    const entry = DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG[0];
    expect(entry.providerId).toBe("groq-free");
    expect(entry.modelId).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(entry.modelId).toBe("openai/gpt-oss-120b");
    expect(entry.verifiedAt).toBe("2026-11-08T00:00:00.000Z");
    expect(entry.reviewAfter).toBe("2026-11-22T00:00:00.000Z");
    expect(entry.sourceDescription).toContain("ZDR");
    expect(entry.sourceDescription).toContain("8,000 tokens/minute");
  });

  it("selects the evidence inside its verification window", () => {
    const result = selectCurrentOriginGroqFreeModel(undefined, DURING_MS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.modelId).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
  });

  it("fails closed as evidence-stale after the review deadline", () => {
    const result = selectCurrentOriginGroqFreeModel(undefined, AFTER_REVIEW_MS);
    expect(result).toEqual({
      ok: false,
      code: "FREE_MODEL_EVIDENCE_STALE",
      message: expect.any(String),
    });
  });

  it("rejects a tampered catalog entry as invalid", () => {
    const tampered: OriginGroqFreeModelEvidence[] = [{
      ...DEFAULT_ORIGIN_GROQ_FREE_MODEL_CATALOG[0],
      sourceUrl: "https://example.com/not-groq",
    }];
    const result = selectCurrentOriginGroqFreeModel(tampered, DURING_MS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FREE_MODEL_CATALOG_INVALID");
  });
});

describe("buildOriginGroqRoutePlan", () => {
  const primaryPlan: OriginExecutionPlan = {
    providerId: "openrouter-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_OPENROUTER_FREE_MODEL,
    taskType: "review",
    freeOnly: true,
    estimatedCostUsd: 0,
    timeoutMs: 30_000,
    requiresOwnerApproval: false,
    reason: "test",
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    modelEvidence: { providerId: "openrouter-free", verifiedAt: "2026-11-05T09:30:00.000Z", reviewAfter: "2026-11-15T09:30:00.000Z", sourceUrl: "https://openrouter.ai/google/gemma-4-31b-it:free" },
  };

  it("derives a third-route plan for the fixed Groq free model under the strict data policy", () => {
    const result = buildOriginGroqRoutePlan(primaryPlan, { nowMs: DURING_MS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("groq-free");
    expect(result.plan.modelId).toBe("openai/gpt-oss-120b");
    expect(result.plan.taskType).toBe("review");
    expect(result.plan.timeoutMs).toBe(30_000);
    expect(result.plan.freeOnly).toBe(true);
    expect(result.plan.estimatedCostUsd).toBe(0);
    expect(result.plan.providerDataPolicy).toEqual({
      allowProviderFallbacks: false,
      dataCollection: "deny",
      requireZeroDataRetention: true,
    });
    expect(result.plan.modelEvidence.providerId).toBe("groq-free");
    expect(result.plan.modelEvidence.reviewAfter).toBe("2026-11-22T00:00:00.000Z");
  });

  it("refuses to build the route plan once the evidence is stale", () => {
    const result = buildOriginGroqRoutePlan(primaryPlan, { nowMs: AFTER_REVIEW_MS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FREE_MODEL_EVIDENCE_STALE");
  });
});
