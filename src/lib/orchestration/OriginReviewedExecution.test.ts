import { describe, expect, it, vi } from "vitest";
import { executeReviewedOriginRequest } from "./OriginReviewedExecution";

const baseRequest = {
  taskType: "security" as const,
  prompt: "認証処理を監査してください",
  consequential: true,
  containsFreshClaims: false,
  userRequestedReview: false,
  primary: { providerId: "provider-a", modelId: "model-a" },
  reviewer: { providerId: "provider-b", modelId: "model-b" },
};

const primaryResult = {
  traceId: "primary-trace",
  providerId: "provider-a",
  modelId: "model-a",
  answer: "一次回答です。",
  evidence: ["synthetic"],
  limitations: ["モック実行"],
};

const reviewResult = {
  traceId: "review-trace",
  providerId: "provider-b",
  modelId: "model-b",
  decision: "accept" as const,
  findings: [],
  requiredCorrections: [],
  confidence: 0.9,
};

describe("executeReviewedOriginRequest", () => {
  it("executes primary and independent review before accepting high-risk work", async () => {
    const executePrimary = vi.fn().mockResolvedValue(primaryResult);
    const executeReview = vi.fn().mockResolvedValue(reviewResult);

    const outcome = await executeReviewedOriginRequest(baseRequest, executePrimary, executeReview);

    expect(outcome).toEqual({
      ok: true,
      reviewRequired: true,
      result: expect.objectContaining({
        status: "accepted",
        conclusion: "一次回答です。",
        trace: {
          primaryTraceId: "primary-trace",
          reviewerTraceId: "review-trace",
          independentProviders: true,
        },
      }),
    });
    expect(executePrimary).toHaveBeenCalledTimes(1);
    expect(executeReview).toHaveBeenCalledTimes(1);
  });

  it("fails closed when review is required but unavailable", async () => {
    const executePrimary = vi.fn().mockResolvedValue(primaryResult);
    const executeReview = vi.fn();

    const outcome = await executeReviewedOriginRequest(
      { ...baseRequest, reviewer: undefined },
      executePrimary,
      executeReview,
    );

    expect(outcome).toEqual({
      ok: false,
      code: "REVIEWER_NOT_AVAILABLE",
      message: "独立レビューが必要ですが、条件を満たす無料レビュー担当を利用できません。",
    });
    expect(executeReview).not.toHaveBeenCalled();
  });

  it("fails before review when the reviewer uses the primary provider", async () => {
    const executePrimary = vi.fn().mockResolvedValue(primaryResult);
    const executeReview = vi.fn();

    const outcome = await executeReviewedOriginRequest(
      { ...baseRequest, reviewer: { providerId: "provider-a", modelId: "model-c" } },
      executePrimary,
      executeReview,
    );

    expect(outcome).toEqual({
      ok: false,
      code: "REVIEWER_NOT_INDEPENDENT",
      message: "一次回答と異なるプロバイダーのレビュー担当が必要です。",
    });
    expect(executeReview).not.toHaveBeenCalled();
  });

  it("rejects primary execution metadata that differs from the plan", async () => {
    const executePrimary = vi.fn().mockResolvedValue({
      ...primaryResult,
      modelId: "unexpected-model",
    });

    const outcome = await executeReviewedOriginRequest(baseRequest, executePrimary, vi.fn());

    expect(outcome).toEqual({
      ok: false,
      code: "PRIMARY_EXECUTION_MISMATCH",
      message: "一次回答の実行先が計画と一致しないため、結果を採用しません。",
    });
  });

  it("skips review for low-risk work when no review signal exists", async () => {
    const executePrimary = vi.fn().mockResolvedValue(primaryResult);
    const executeReview = vi.fn();

    const outcome = await executeReviewedOriginRequest({
      ...baseRequest,
      taskType: "documentation",
      consequential: false,
      primary: { providerId: "provider-a", modelId: "model-a" },
      reviewer: undefined,
    }, executePrimary, executeReview);

    expect(outcome).toEqual({
      ok: true,
      reviewRequired: false,
      result: expect.objectContaining({
        status: "accepted",
        conclusion: "一次回答です。",
        trace: {
          primaryTraceId: "primary-trace",
          reviewerTraceId: "not-required",
          independentProviders: false,
        },
      }),
    });
    expect(executeReview).not.toHaveBeenCalled();
  });
});
