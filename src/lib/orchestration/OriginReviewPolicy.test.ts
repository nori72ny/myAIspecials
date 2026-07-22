import { describe, expect, it } from "vitest";
import { decideOriginReview } from "./OriginReviewPolicy";

describe("decideOriginReview", () => {
  it("skips review for a low-risk request with no review signal", () => {
    expect(decideOriginReview({
      taskType: "documentation",
      consequential: false,
      containsFreshClaims: false,
      userRequestedReview: false,
      primaryConfidence: 0.95,
    })).toEqual({ required: false, reasons: [] });
  });

  it("requires review for security work", () => {
    const decision = decideOriginReview({
      taskType: "security",
      consequential: false,
      containsFreshClaims: false,
      userRequestedReview: false,
    });

    expect(decision.required).toBe(true);
    expect(decision.reasons).toContain("依頼種別「security」は独立確認の対象です。");
  });

  it("combines independent reasons without hiding why review is required", () => {
    const decision = decideOriginReview({
      taskType: "research",
      consequential: true,
      containsFreshClaims: true,
      userRequestedReview: true,
      primaryConfidence: 0.6,
    });

    expect(decision.required).toBe(true);
    expect(decision.reasons).toHaveLength(4);
  });
});
