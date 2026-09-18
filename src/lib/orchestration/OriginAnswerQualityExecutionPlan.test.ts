import { describe, expect, it } from "vitest";

import {
  buildOriginAnswerQualityExecutionPlan,
  validateOriginAnswerQualityExecutionPlan,
} from "./OriginAnswerQualityExecutionPlan";

describe("OriginAnswerQualityExecutionPlan", () => {
  it("keeps the fast path minimal while retaining verifier and presenter", () => {
    const plan = buildOriginAnswerQualityExecutionPlan({
      claimExtractionRequired: false,
      claimCoverageReviewRequired: false,
      sourceVerificationRequired: false,
      independentReviewRequired: false,
      tracePersistenceRequired: false,
    });

    expect(plan.stages.filter((stage) => stage.required).map((stage) => stage.stage))
      .toEqual(["verifier", "repair", "reverification", "presenter"]);
    expect(validateOriginAnswerQualityExecutionPlan(plan)).toEqual({ ok: true });
  });

  it("includes evidence and independent-review stages when policy requires them", () => {
    const plan = buildOriginAnswerQualityExecutionPlan({
      claimExtractionRequired: true,
      claimCoverageReviewRequired: true,
      sourceVerificationRequired: true,
      independentReviewRequired: true,
      tracePersistenceRequired: true,
    });

    expect(plan.stages.filter((stage) => stage.required).map((stage) => stage.stage))
      .toEqual([
        "claim-extraction",
        "claim-coverage-review",
        "source-verification",
        "verifier",
        "independent-review",
        "repair",
        "reverification",
        "presenter",
        "trace",
      ]);
  });

  it("uses a fixed deterministic order", () => {
    const plan = buildOriginAnswerQualityExecutionPlan({
      claimExtractionRequired: true,
      claimCoverageReviewRequired: false,
      sourceVerificationRequired: true,
      independentReviewRequired: false,
      tracePersistenceRequired: true,
    });

    expect(plan.stages.map((stage) => stage.stage)).toEqual([
      "claim-extraction",
      "claim-coverage-review",
      "source-verification",
      "verifier",
      "independent-review",
      "repair",
      "reverification",
      "presenter",
      "trace",
    ]);
  });

  it("rejects reordered or malformed plans", () => {
    const plan = buildOriginAnswerQualityExecutionPlan({
      claimExtractionRequired: false,
      claimCoverageReviewRequired: false,
      sourceVerificationRequired: false,
      independentReviewRequired: false,
      tracePersistenceRequired: false,
    });

    expect(validateOriginAnswerQualityExecutionPlan({
      ...plan,
      stages: [...plan.stages].reverse(),
    })).toEqual({ ok: false, code: "AQ_EXECUTION_PLAN_INVALID" });
  });
});
