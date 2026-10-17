import { describe, expect, it } from "vitest";
import {
  ORIGIN_ZERO_COST_QUALITY_CANDIDATES,
  listOriginZeroCostBenchmarkCandidates,
  originZeroCostCandidateIsPromotionEligible,
} from "./OriginZeroCostQualityCandidates";

const now = Date.parse("2026-09-29T00:00:00.000Z");

describe("OriginZeroCostQualityCandidates", () => {
  it("permits promotion only for a current candidate with exact-zero, privacy, auth and benchmark evidence", () => {
    const current = ORIGIN_ZERO_COST_QUALITY_CANDIDATES.find((item) => item.status === "production-audited");
    expect(current).toBeTruthy();
    if (!current) return;
    expect(originZeroCostCandidateIsPromotionEligible(current, now)).toBe(true);

    for (const candidate of ORIGIN_ZERO_COST_QUALITY_CANDIDATES.filter((item) => item !== current)) {
      expect(originZeroCostCandidateIsPromotionEligible(candidate, now)).toBe(false);
    }
  });

  it("does not treat free quota or a free router label as sufficient production evidence", () => {
    const groq = ORIGIN_ZERO_COST_QUALITY_CANDIDATES.find((item) => item.providerId === "groq-free");
    const cloudflare = ORIGIN_ZERO_COST_QUALITY_CANDIDATES.find((item) => item.providerId === "cloudflare-workers-ai-free");
    const randomFreeRouter = ORIGIN_ZERO_COST_QUALITY_CANDIDATES.find((item) => item.modelId === "openrouter/free");

    expect(groq?.ownerSpendUsd).toBe(0);
    expect(groq?.exactPerRequestZeroPriceProven).toBe(false);
    expect(originZeroCostCandidateIsPromotionEligible(groq!, now)).toBe(false);

    expect(cloudflare?.ownerSpendUsd).toBe(0);
    expect(cloudflare?.exactPerRequestZeroPriceProven).toBe(false);
    expect(originZeroCostCandidateIsPromotionEligible(cloudflare!, now)).toBe(false);

    expect(randomFreeRouter?.exactPerRequestZeroPriceProven).toBe(true);
    expect(randomFreeRouter?.privacyEvidenceAccepted).toBe(false);
    expect(originZeroCostCandidateIsPromotionEligible(randomFreeRouter!, now)).toBe(false);
  });

  it("lists research candidates for benchmarking without activating them", () => {
    const candidates = listOriginZeroCostBenchmarkCandidates("research", now);
    expect(candidates.some((item) => item.modelId === "inclusionai/ling-3.0-flash-sante:free")).toBe(true);
    expect(candidates.every((item) => item.ownerSpendUsd === 0)).toBe(true);
  });

  it("expires candidate evidence instead of silently retaining stale routes", () => {
    const afterAllReviews = Date.parse("2026-11-01T00:00:00.000Z");
    expect(listOriginZeroCostBenchmarkCandidates("general-answer", afterAllReviews)).toEqual([]);
    expect(ORIGIN_ZERO_COST_QUALITY_CANDIDATES.every((item) =>
      originZeroCostCandidateIsPromotionEligible(item, afterAllReviews) === false,
    )).toBe(true);
  });
});
