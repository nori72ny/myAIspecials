import { describe, expect, it } from "vitest";

import { resolveOriginAnswerQualityStageRequirements } from "./OriginAnswerQualityStagePolicy";
import type { OriginAnswerQualityPolicy } from "./OriginAnswerQualityPolicy";

function policy(
  verificationLevel: OriginAnswerQualityPolicy["verificationLevel"],
  executiveReasoningRequired = false,
): OriginAnswerQualityPolicy {
  return {
    answerMode: verificationLevel === "basic" ? "direct" : "research",
    verificationLevel,
    creativeSpecRequired: false,
    executiveReasoningRequired,
  };
}

describe("OriginAnswerQualityStagePolicy", () => {
  it("keeps low-risk basic answers on the fast path", () => {
    expect(resolveOriginAnswerQualityStageRequirements(policy("basic"))).toEqual({
      claimExtractionRequired: false,
      claimCoverageReviewRequired: false,
      sourceVerificationRequired: false,
      independentReviewRequired: false,
      tracePersistenceRequired: false,
    });
  });

  it("requires claim and source verification for evidence-required answers", () => {
    expect(resolveOriginAnswerQualityStageRequirements(policy("evidence-required"))).toEqual({
      claimExtractionRequired: true,
      claimCoverageReviewRequired: false,
      sourceVerificationRequired: true,
      independentReviewRequired: false,
      tracePersistenceRequired: true,
    });
  });

  it("requires independent coverage and review for independent-review-required answers", () => {
    expect(resolveOriginAnswerQualityStageRequirements(
      policy("independent-review-required"),
    )).toEqual({
      claimExtractionRequired: true,
      claimCoverageReviewRequired: true,
      sourceVerificationRequired: true,
      independentReviewRequired: true,
      tracePersistenceRequired: true,
    });
  });

  it("requires trace for consequential executive reasoning even on the basic path", () => {
    expect(resolveOriginAnswerQualityStageRequirements(
      policy("basic", true),
    ).tracePersistenceRequired).toBe(true);
  });
});
