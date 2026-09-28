import { describe, expect, it } from "vitest";

import { decideOriginAnswerQuality } from "./OriginAnswerQualityDecisionController";
import type { OriginVerificationResult } from "./OriginVerifier";

function result(
  decision: OriginVerificationResult["decision"],
  issues: OriginVerificationResult["issues"] = [],
): OriginVerificationResult {
  return {
    schemaVersion: "origin.verification.v1",
    decision,
    issues,
    verifiedClaimIds: [],
  };
}

describe("OriginAnswerQualityDecisionController", () => {
  it("keeps PASS, repair plan and presentation consistent", () => {
    const decided = decideOriginAnswerQuality(result("PASS"), {
      language: "ja",
      independentReviewRequired: false,
      independentReviewPerformed: false,
    });

    expect(decided.repairPlan.required).toBe(false);
    expect(decided.repairPlan.blocked).toBe(false);
    expect(decided.presentation.status).toBe("not-required");
  });

  it("turns repair-required verification into actions without presenting it as passed", () => {
    const decided = decideOriginAnswerQuality(result("REPAIR_REQUIRED", [
      { claimId: "c1", code: "MISSING_EVIDENCE", repairable: true },
    ]), {
      language: "ja",
      independentReviewRequired: false,
      independentReviewPerformed: false,
    });

    expect(decided.repairPlan.required).toBe(true);
    expect(decided.repairPlan.actions[0]).toEqual({
      issueCode: "MISSING_EVIDENCE",
      claimId: "c1",
      action: "retrieve-evidence",
      maxAttempts: 1,
    });
    expect(decided.presentation.status).toBe("not-run");
  });

  it("keeps blocked verification blocked in both repair and presentation layers", () => {
    const decided = decideOriginAnswerQuality(result("BLOCKED_UNVERIFIED", [
      { code: "INDEPENDENT_REVIEW_REQUIRED", repairable: false },
    ]), {
      language: "en",
      independentReviewRequired: true,
      independentReviewPerformed: false,
    });

    expect(decided.repairPlan.blocked).toBe(true);
    expect(decided.presentation.status).toBe("not-run");
    expect(decided.presentation.independentReviewPerformed).toBe(false);
  });
});
