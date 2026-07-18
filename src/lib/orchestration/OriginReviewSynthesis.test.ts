import { describe, expect, it } from "vitest";
import {
  synthesizeOriginReview,
  type OriginIndependentReview,
  type OriginPrimaryResult,
} from "./OriginReviewSynthesis";

const primary: OriginPrimaryResult = {
  traceId: "primary-trace",
  providerId: "provider-a",
  modelId: "model-a",
  answer: "結論を先に示した一次回答です。",
  evidence: ["synthetic-evidence-1"],
  limitations: ["実環境では未検証"],
};

function review(overrides: Partial<OriginIndependentReview> = {}): OriginIndependentReview {
  return {
    traceId: "review-trace",
    providerId: "provider-b",
    modelId: "model-b",
    decision: "accept",
    findings: [],
    requiredCorrections: [],
    confidence: 0.9,
    ...overrides,
  };
}

describe("synthesizeOriginReview", () => {
  it("accepts a primary answer only after an independent provider review", () => {
    const outcome = synthesizeOriginReview(primary, review({
      findings: ["重大な矛盾はありません"],
    }));

    expect(outcome).toEqual({
      ok: true,
      result: {
        status: "accepted",
        conclusion: "結論を先に示した一次回答です。",
        findings: ["重大な矛盾はありません"],
        limitations: ["実環境では未検証"],
        trace: {
          primaryTraceId: "primary-trace",
          reviewerTraceId: "review-trace",
          independentProviders: true,
        },
      },
    });
  });

  it("does not treat the same provider as independent verification", () => {
    const outcome = synthesizeOriginReview(primary, review({ providerId: "provider-a" }));

    expect(outcome).toEqual({
      ok: false,
      code: "NON_INDEPENDENT_REVIEW",
      message: "一次回答と同じプロバイダーによるレビューは独立検証として扱えません。",
    });
  });

  it("requires revision when the reviewer supplies corrections", () => {
    const outcome = synthesizeOriginReview(primary, review({
      decision: "revise",
      findings: ["根拠が不足しています"],
      requiredCorrections: ["一次資料を追加してください"],
    }));

    expect(outcome).toEqual({
      ok: true,
      result: expect.objectContaining({
        status: "needs-revision",
        conclusion: "一次回答には修正が必要です。指摘事項を反映した再実行後に採用判断を行います。",
        findings: ["根拠が不足しています", "一次資料を追加してください"],
      }),
    });
  });

  it("rejects a primary answer when the independent review rejects it", () => {
    const outcome = synthesizeOriginReview(primary, review({
      decision: "reject",
      findings: ["安全上の重大な問題"],
    }));

    expect(outcome).toEqual({
      ok: true,
      result: expect.objectContaining({
        status: "rejected",
        conclusion: "独立レビューで重大な問題が確認されたため、一次回答は採用しません。",
        findings: ["安全上の重大な問題"],
      }),
    });
  });

  it("rejects invalid confidence values", () => {
    expect(synthesizeOriginReview(primary, review({ confidence: 1.1 }))).toEqual({
      ok: false,
      code: "INVALID_REVIEW_RESULT",
      message: "独立レビューの実行記録または信頼度が正しくありません。",
    });
  });
});
