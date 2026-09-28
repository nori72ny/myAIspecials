import { describe, expect, it } from "vitest";

import { presentOriginVerification } from "./OriginVerificationPresenter";
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

describe("OriginVerificationPresenter", () => {
  it("does not turn PASS into independent verification when review was not required", () => {
    expect(presentOriginVerification(result("PASS"), {
      language: "ja",
      independentReviewRequired: false,
      independentReviewPerformed: false,
    })).toEqual({
      status: "not-required",
      independentReviewPerformed: false,
      summary: "必要な根拠確認を完了し、この依頼では独立レビューを必須としていません。",
      limitations: [],
      nextActions: [],
    });
  });

  it("marks passed only when required independent review actually ran", () => {
    expect(presentOriginVerification(result("PASS"), {
      language: "en",
      independentReviewRequired: true,
      independentReviewPerformed: true,
    })).toEqual(expect.objectContaining({
      status: "passed",
      independentReviewPerformed: true,
      limitations: [],
      nextActions: [],
    }));
  });

  it("never presents PASS as verified when independent review is required but absent", () => {
    const presented = presentOriginVerification(result("PASS"), {
      language: "ja",
      independentReviewRequired: true,
      independentReviewPerformed: false,
    });
    expect(presented.status).toBe("not-run");
    expect(presented.independentReviewPerformed).toBe(false);
    expect(presented.limitations).not.toEqual([]);
  });

  it("presents repair-required results as unverified with actionable evidence guidance", () => {
    const presented = presentOriginVerification(result("REPAIR_REQUIRED", [
      { claimId: "c1", code: "MISSING_EVIDENCE", repairable: true },
      { claimId: "c2", code: "STALE_EVIDENCE", repairable: true },
    ]), {
      language: "ja",
      independentReviewRequired: false,
      independentReviewPerformed: false,
    });
    expect(presented.status).toBe("not-run");
    expect(presented.summary).toContain("根拠不足");
    expect(presented.summary).toContain("根拠の鮮度不足");
    expect(presented.nextActions[0]).toContain("再検証");
  });

  it("presents blocked results without exposing hidden reasoning", () => {
    const presented = presentOriginVerification(result("BLOCKED_UNVERIFIED", [
      { code: "INDEPENDENT_REVIEW_REQUIRED", repairable: false },
    ]), {
      language: "ja",
      independentReviewRequired: true,
      independentReviewPerformed: false,
    });
    expect(presented.status).toBe("not-run");
    expect(presented.summary).toContain("独立レビュー未実施");
    expect(JSON.stringify(presented)).not.toContain("chain-of-thought");
  });
});
