import { describe, expect, it } from "vitest";
import {
  decideOriginReview,
  decideOriginReviewForMessage,
} from "./OriginReviewPolicy";

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
    expect(decision.reasons).toContain("依頼種別「セキュリティ」は独立確認の対象です。");
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

  it("requires review when the user explicitly requests another AI", () => {
    const decision = decideOriginReviewForMessage(
      "documentation",
      "別のAIでも独立確認してください",
    );

    expect(decision.required).toBe(true);
    expect(decision.reasons).toContain("ユーザーが独立レビューを指定しました。");
  });

  it("requires review for consequential legal and financial content", () => {
    expect(decideOriginReviewForMessage(
      "research",
      "交通事故の法律判断と投資への影響を整理してください",
    )).toEqual(expect.objectContaining({ required: true }));
  });

  it("requires review for fresh claims without relying on a regular expression", () => {
    const decision = decideOriginReviewForMessage(
      "research",
      "今日の最新料金を比較してください",
    );

    expect(decision.required).toBe(true);
    expect(decision.reasons).toContain("最新性を必要とする主張が含まれます。");
  });

  it("does not require review for a low-risk writing request", () => {
    expect(decideOriginReviewForMessage(
      "documentation",
      "短い案内文を読みやすく整えてください",
    )).toEqual({ required: false, reasons: [] });
  });
});
