import { describe, expect, it } from "vitest";

import { evaluateOriginAnswerQualityRuntimeReadiness } from "./OriginAnswerQualityRuntimeReadiness";

const complete = {
  claimExtractionRequired: true,
  claimExtractionCompleted: true,
  claimCoverageReviewRequired: true,
  claimCoverageReviewPassed: true,
  sourceVerificationRequired: true,
  sourceVerificationCompleted: true,
  verificationDecision: "PASS" as const,
  independentReviewRequired: true,
  independentReviewPerformed: true,
  tracePersistenceRequired: true,
  tracePersisted: true,
  totalCostUsd: 0,
};

describe("OriginAnswerQualityRuntimeReadiness", () => {
  it("is ready only when every required verification boundary is complete", () => {
    expect(evaluateOriginAnswerQualityRuntimeReadiness(complete)).toEqual({
      schemaVersion: "origin.aq-readiness.v1",
      ready: true,
      blockers: [],
    });
  });

  it("collects all missing required boundaries rather than failing on the first one", () => {
    const result = evaluateOriginAnswerQualityRuntimeReadiness({
      ...complete,
      claimExtractionCompleted: false,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: false,
      verificationDecision: "REPAIR_REQUIRED",
      independentReviewPerformed: false,
      tracePersisted: false,
      totalCostUsd: 0.01,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      "CLAIM_EXTRACTION_INCOMPLETE",
      "CLAIM_COVERAGE_INCOMPLETE",
      "SOURCE_VERIFICATION_INCOMPLETE",
      "VERIFIER_NOT_PASS",
      "INDEPENDENT_REVIEW_INCOMPLETE",
      "TRACE_PERSISTENCE_INCOMPLETE",
      "NON_ZERO_COST",
    ]);
  });

  it("does not require optional stages for low-risk answers", () => {
    const result = evaluateOriginAnswerQualityRuntimeReadiness({
      ...complete,
      claimExtractionRequired: false,
      claimExtractionCompleted: false,
      claimCoverageReviewRequired: false,
      claimCoverageReviewPassed: false,
      sourceVerificationRequired: false,
      sourceVerificationCompleted: false,
      independentReviewRequired: false,
      independentReviewPerformed: false,
      tracePersistenceRequired: false,
      tracePersisted: false,
    });

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("never allows non-zero or non-finite cost", () => {
    expect(evaluateOriginAnswerQualityRuntimeReadiness({
      ...complete,
      totalCostUsd: Number.NaN,
    }).blockers).toContain("NON_ZERO_COST");

    expect(evaluateOriginAnswerQualityRuntimeReadiness({
      ...complete,
      totalCostUsd: 1,
    }).blockers).toContain("NON_ZERO_COST");
  });
});
