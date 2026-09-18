import { describe, expect, it } from "vitest";

import { decideOriginAnswerQualityAdmission } from "./OriginAnswerQualityAdmissionController";
import type { OriginAnswerQualityPolicy } from "./OriginAnswerQualityPolicy";

const basicPolicy: OriginAnswerQualityPolicy = {
  answerMode: "direct",
  verificationLevel: "basic",
  creativeSpecRequired: false,
  executiveReasoningRequired: false,
};

const researchPolicy: OriginAnswerQualityPolicy = {
  answerMode: "research",
  verificationLevel: "evidence-required",
  creativeSpecRequired: false,
  executiveReasoningRequired: true,
};

const independentPolicy: OriginAnswerQualityPolicy = {
  answerMode: "research",
  verificationLevel: "independent-review-required",
  creativeSpecRequired: false,
  executiveReasoningRequired: true,
};

const usage = {
  providerExecutions: 2,
  sourceFetches: 3,
  repairActions: 0,
  elapsedMs: 4_000,
  costUsd: 0,
};

describe("OriginAnswerQualityAdmissionController", () => {
  it("keeps the basic fast path admissible without heavyweight optional stages", () => {
    const result = decideOriginAnswerQualityAdmission({
      policy: basicPolicy,
      usage,
      claimExtractionCompleted: false,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: false,
      verificationDecision: "PASS",
      independentReviewPerformed: false,
      tracePersisted: false,
    });

    expect(result.admitted).toBe(true);
    expect(result.requirements).toEqual({
      claimExtractionRequired: false,
      claimCoverageReviewRequired: false,
      sourceVerificationRequired: false,
      independentReviewRequired: false,
      tracePersistenceRequired: false,
    });
  });

  it("blocks research admission when evidence or trace stages are incomplete", () => {
    const result = decideOriginAnswerQualityAdmission({
      policy: researchPolicy,
      usage,
      claimExtractionCompleted: true,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: false,
      verificationDecision: "PASS",
      independentReviewPerformed: false,
      tracePersisted: false,
    });

    expect(result.admitted).toBe(false);
    expect(result.readiness.blockers).toContain("SOURCE_VERIFICATION_INCOMPLETE");
    expect(result.readiness.blockers).toContain("TRACE_PERSISTENCE_INCOMPLETE");
  });

  it("blocks independent-review answers until coverage and independent review pass", () => {
    const result = decideOriginAnswerQualityAdmission({
      policy: independentPolicy,
      usage,
      claimExtractionCompleted: true,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: true,
      verificationDecision: "PASS",
      independentReviewPerformed: false,
      tracePersisted: true,
    });

    expect(result.admitted).toBe(false);
    expect(result.readiness.blockers).toEqual([
      "CLAIM_COVERAGE_INCOMPLETE",
      "INDEPENDENT_REVIEW_INCOMPLETE",
    ]);
  });

  it("blocks admission when the global AQ budget is exceeded even if readiness passes", () => {
    const result = decideOriginAnswerQualityAdmission({
      policy: researchPolicy,
      usage: { ...usage, providerExecutions: 4 },
      claimExtractionCompleted: true,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: true,
      verificationDecision: "PASS",
      independentReviewPerformed: false,
      tracePersisted: true,
    });

    expect(result.admitted).toBe(false);
    expect(result.readiness.ready).toBe(true);
    expect(result.budget).toEqual({
      ok: false,
      code: "AQ_PROVIDER_EXECUTION_BUDGET_EXCEEDED",
    });
  });

  it("never admits a non-PASS verifier result", () => {
    const result = decideOriginAnswerQualityAdmission({
      policy: basicPolicy,
      usage,
      claimExtractionCompleted: false,
      claimCoverageReviewPassed: false,
      sourceVerificationCompleted: false,
      verificationDecision: "REPAIR_REQUIRED",
      independentReviewPerformed: false,
      tracePersisted: false,
    });

    expect(result.admitted).toBe(false);
    expect(result.readiness.blockers).toContain("VERIFIER_NOT_PASS");
  });
});
