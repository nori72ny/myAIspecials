import type { AITaskType } from "./MultiAIOrchestrator";
import { decideOriginReview } from "./OriginReviewPolicy";
import {
  synthesizeOriginReview,
  type OriginIndependentReview,
  type OriginPrimaryResult,
  type OriginSynthesisResult,
} from "./OriginReviewSynthesis";

export interface OriginExecutionCandidate {
  providerId: string;
  modelId: string;
}

export interface OriginReviewedExecutionRequest {
  taskType: AITaskType;
  prompt: string;
  consequential: boolean;
  containsFreshClaims: boolean;
  userRequestedReview: boolean;
  primary: OriginExecutionCandidate;
  reviewer?: OriginExecutionCandidate;
}

export interface OriginPrimaryExecutor {
  (request: OriginReviewedExecutionRequest): Promise<OriginPrimaryResult>;
}

export interface OriginReviewExecutor {
  (request: {
    original: OriginReviewedExecutionRequest;
    primaryResult: OriginPrimaryResult;
    reviewer: OriginExecutionCandidate;
  }): Promise<OriginIndependentReview>;
}

export type OriginReviewedExecutionResult =
  | {
      ok: true;
      reviewRequired: false;
      result: OriginSynthesisResult;
    }
  | {
      ok: true;
      reviewRequired: true;
      result: OriginSynthesisResult;
    }
  | {
      ok: false;
      code:
        | "REVIEWER_NOT_AVAILABLE"
        | "REVIEWER_NOT_INDEPENDENT"
        | "PRIMARY_EXECUTION_MISMATCH"
        | "REVIEW_EXECUTION_MISMATCH"
        | "SYNTHESIS_FAILED";
      message: string;
    };

export async function executeReviewedOriginRequest(
  request: OriginReviewedExecutionRequest,
  executePrimary: OriginPrimaryExecutor,
  executeReview: OriginReviewExecutor,
): Promise<OriginReviewedExecutionResult> {
  const primaryResult = await executePrimary(request);

  if (
    primaryResult.providerId !== request.primary.providerId
    || primaryResult.modelId !== request.primary.modelId
  ) {
    return {
      ok: false,
      code: "PRIMARY_EXECUTION_MISMATCH",
      message: "一次回答の実行先が計画と一致しないため、結果を採用しません。",
    };
  }

  const reviewDecision = decideOriginReview({
    taskType: request.taskType,
    consequential: request.consequential,
    containsFreshClaims: request.containsFreshClaims,
    userRequestedReview: request.userRequestedReview,
  });

  if (!reviewDecision.required) {
    return {
      ok: true,
      reviewRequired: false,
      result: {
        status: "accepted",
        conclusion: primaryResult.answer.trim(),
        findings: [],
        limitations: primaryResult.limitations,
        trace: {
          primaryTraceId: primaryResult.traceId,
          reviewerTraceId: "not-required",
          independentProviders: false,
        },
      },
    };
  }

  if (!request.reviewer) {
    return {
      ok: false,
      code: "REVIEWER_NOT_AVAILABLE",
      message: "独立レビューが必要ですが、条件を満たす無料レビュー担当を利用できません。",
    };
  }

  if (request.reviewer.providerId === request.primary.providerId) {
    return {
      ok: false,
      code: "REVIEWER_NOT_INDEPENDENT",
      message: "一次回答と異なるプロバイダーのレビュー担当が必要です。",
    };
  }

  const reviewResult = await executeReview({
    original: request,
    primaryResult,
    reviewer: request.reviewer,
  });

  if (
    reviewResult.providerId !== request.reviewer.providerId
    || reviewResult.modelId !== request.reviewer.modelId
  ) {
    return {
      ok: false,
      code: "REVIEW_EXECUTION_MISMATCH",
      message: "レビューの実行先が計画と一致しないため、結果を採用しません。",
    };
  }

  const synthesis = synthesizeOriginReview(primaryResult, reviewResult);
  if (synthesis.ok === false) {
    return {
      ok: false,
      code: "SYNTHESIS_FAILED",
      message: synthesis.message,
    };
  }

  return {
    ok: true,
    reviewRequired: true,
    result: synthesis.result,
  };
}
