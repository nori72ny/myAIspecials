import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN_OVHCLOUD_FREE_MODEL_CATALOG,
  isOriginOvhcloudFreeModelId,
  ORIGIN_OVHCLOUD_FREE_MODEL_ID,
  ORIGIN_OVHCLOUD_FREE_MODEL_IDS,
  selectCurrentOriginOvhcloudFreeModel,
  selectCurrentOriginOvhcloudFreeModelById,
  type OriginOvhcloudFreeModelEvidence,
} from "./OriginOvhcloudFreeModelCatalog";
import {
  buildOriginOvhcloudRoutePlan,
  type OriginExecutionPlan,
} from "./OriginExecutionPolicy";

const DURING_MS = Date.parse("2026-11-27T12:00:00.000Z");
const AFTER_REVIEW_MS = Date.parse("2026-12-26T00:00:00.000Z");

const sourcePlan: OriginExecutionPlan = {
  providerId: "openrouter-free",
  providerLabel: "ORIGIN 無料AI",
  modelId: "google/gemma-4-31b-it:free",
  taskType: "review",
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 30_000,
  requiresOwnerApproval: false,
  reason: "test",
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  modelEvidence: { providerId: "openrouter-free", verifiedAt: "2026-11-05T09:30:00.000Z", reviewAfter: "2026-11-15T09:30:00.000Z", sourceUrl: "https://openrouter.ai/google/gemma-4-31b-it:free" },
};

describe("OVHcloud free model evidence catalog", () => {
  it("pins the measured anonymous model and the 2026-12-25 review deadline", () => {
    const entry = DEFAULT_ORIGIN_OVHCLOUD_FREE_MODEL_CATALOG[0];
    expect(entry.providerId).toBe("ovhcloud-free");
    expect(entry.modelId).toBe(ORIGIN_OVHCLOUD_FREE_MODEL_ID);
    expect(entry.modelId).toBe("gpt-oss-20b");
    expect(entry.verifiedAt).toBe("2026-11-25T00:00:00.000Z");
    expect(entry.reviewAfter).toBe("2026-12-25T00:00:00.000Z");
    expect(entry.sourceUrl).toBe("https://www.ovhcloud.com/en/public-cloud/ai-endpoints/");
    expect(entry.sourceDescription).toContain("Zero data retention");
    expect(entry.sourceDescription).toContain("Annex 10");
    expect(entry.sourceDescription).toContain("2 requests/minute/IP/model");
    expect(entry.sourceDescription).toContain("Batch API");
  });

  it("admits only the measured model id", () => {
    expect(ORIGIN_OVHCLOUD_FREE_MODEL_IDS).toEqual(["gpt-oss-20b"]);
    expect(isOriginOvhcloudFreeModelId("gpt-oss-20b")).toBe(true);
    expect(isOriginOvhcloudFreeModelId("gpt-oss-120b")).toBe(false);
    expect(isOriginOvhcloudFreeModelId("Qwen3.8-27B")).toBe(false);
    expect(isOriginOvhcloudFreeModelId(undefined)).toBe(false);
  });

  it("selects the evidence inside its verification window", () => {
    const result = selectCurrentOriginOvhcloudFreeModel(undefined, DURING_MS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.modelId).toBe(ORIGIN_OVHCLOUD_FREE_MODEL_ID);
    const byId = selectCurrentOriginOvhcloudFreeModelById(undefined, ORIGIN_OVHCLOUD_FREE_MODEL_ID, DURING_MS);
    expect(byId.ok).toBe(true);
  });

  it("fails closed as evidence-stale after the review deadline", () => {
    const result = selectCurrentOriginOvhcloudFreeModel(undefined, AFTER_REVIEW_MS);
    expect(result).toEqual({
      ok: false,
      code: "FREE_MODEL_EVIDENCE_STALE",
      message: expect.any(String),
    });
  });

  it("rejects a tampered catalog entry as invalid", () => {
    const tampered: OriginOvhcloudFreeModelEvidence[] = [{
      ...DEFAULT_ORIGIN_OVHCLOUD_FREE_MODEL_CATALOG[0],
      sourceUrl: "https://example.com/not-ovhcloud",
    }];
    const result = selectCurrentOriginOvhcloudFreeModel(tampered, DURING_MS);
    expect(result).toMatchObject({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" });
  });

  it("rejects an unmeasured model entry as invalid", () => {
    const tampered = [{
      ...DEFAULT_ORIGIN_OVHCLOUD_FREE_MODEL_CATALOG[0],
      modelId: "gpt-oss-120b",
    }] as unknown as OriginOvhcloudFreeModelEvidence[];
    const result = selectCurrentOriginOvhcloudFreeModel(tampered, DURING_MS);
    expect(result).toMatchObject({ ok: false, code: "FREE_MODEL_CATALOG_INVALID" });
  });
});

describe("OVHcloud route plan", () => {
  it("derives a $0 plan for the catalogued model from current evidence", () => {
    const result = buildOriginOvhcloudRoutePlan(sourcePlan, { nowMs: DURING_MS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.providerId).toBe("ovhcloud-free");
    expect(result.plan.modelId).toBe("gpt-oss-20b");
    expect(result.plan.freeOnly).toBe(true);
    expect(result.plan.estimatedCostUsd).toBe(0);
    expect(result.plan.taskType).toBe(sourcePlan.taskType);
    expect(result.plan.timeoutMs).toBe(sourcePlan.timeoutMs);
    expect(result.plan.providerDataPolicy).toEqual({
      allowProviderFallbacks: false,
      dataCollection: "deny",
      requireZeroDataRetention: true,
    });
    expect(result.plan.modelEvidence.providerId).toBe("ovhcloud-free");
    expect(result.plan.modelEvidence.reviewAfter).toBe("2026-12-25T00:00:00.000Z");
  });

  it("fails closed when the evidence is stale", () => {
    const result = buildOriginOvhcloudRoutePlan(sourcePlan, { nowMs: AFTER_REVIEW_MS });
    expect(result).toMatchObject({ ok: false, code: "FREE_MODEL_EVIDENCE_STALE" });
  });
});
