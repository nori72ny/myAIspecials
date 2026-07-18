export type OriginReviewDecision = "accept" | "revise" | "reject";

export interface OriginExecutionTraceRef {
  traceId: string;
  providerId: string;
  modelId: string;
}

export interface OriginPrimaryResult extends OriginExecutionTraceRef {
  answer: string;
  evidence: readonly string[];
  limitations: readonly string[];
}

export interface OriginIndependentReview extends OriginExecutionTraceRef {
  decision: OriginReviewDecision;
  findings: readonly string[];
  requiredCorrections: readonly string[];
  confidence: number;
}

export interface OriginSynthesisResult {
  status: "accepted" | "needs-revision" | "rejected";
  conclusion: string;
  findings: readonly string[];
  limitations: readonly string[];
  trace: {
    primaryTraceId: string;
    reviewerTraceId: string;
    independentProviders: boolean;
  };
}

export type OriginSynthesisFailureCode =
  | "INVALID_PRIMARY_RESULT"
  | "INVALID_REVIEW_RESULT"
  | "NON_INDEPENDENT_REVIEW";

export type OriginSynthesisOutcome =
  | { ok: true; result: OriginSynthesisResult }
  | { ok: false; code: OriginSynthesisFailureCode; message: string };

function cleanList(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function validTrace(value: OriginExecutionTraceRef): boolean {
  return value.traceId.trim().length > 0
    && value.providerId.trim().length > 0
    && value.modelId.trim().length > 0;
}

export function synthesizeOriginReview(
  primary: OriginPrimaryResult,
  review: OriginIndependentReview,
): OriginSynthesisOutcome {
  if (!validTrace(primary) || primary.answer.trim().length === 0) {
    return {
      ok: false,
      code: "INVALID_PRIMARY_RESULT",
      message: "一次回答の実行記録または本文が正しくありません。",
    };
  }

  if (
    !validTrace(review)
    || !Number.isFinite(review.confidence)
    || review.confidence < 0
    || review.confidence > 1
  ) {
    return {
      ok: false,
      code: "INVALID_REVIEW_RESULT",
      message: "独立レビューの実行記録または信頼度が正しくありません。",
    };
  }

  const independentProviders = primary.providerId !== review.providerId;
  if (!independentProviders) {
    return {
      ok: false,
      code: "NON_INDEPENDENT_REVIEW",
      message: "一次回答と同じプロバイダーによるレビューは独立検証として扱えません。",
    };
  }

  const findings = cleanList(review.findings);
  const corrections = cleanList(review.requiredCorrections);
  const limitations = cleanList(primary.limitations);

  if (review.decision === "reject") {
    return {
      ok: true,
      result: {
        status: "rejected",
        conclusion: "独立レビューで重大な問題が確認されたため、一次回答は採用しません。",
        findings: [...findings, ...corrections],
        limitations,
        trace: {
          primaryTraceId: primary.traceId,
          reviewerTraceId: review.traceId,
          independentProviders,
        },
      },
    };
  }

  if (review.decision === "revise" || corrections.length > 0) {
    return {
      ok: true,
      result: {
        status: "needs-revision",
        conclusion: "一次回答には修正が必要です。指摘事項を反映した再実行後に採用判断を行います。",
        findings: [...findings, ...corrections],
        limitations,
        trace: {
          primaryTraceId: primary.traceId,
          reviewerTraceId: review.traceId,
          independentProviders,
        },
      },
    };
  }

  return {
    ok: true,
    result: {
      status: "accepted",
      conclusion: primary.answer.trim(),
      findings,
      limitations,
      trace: {
        primaryTraceId: primary.traceId,
        reviewerTraceId: review.traceId,
        independentProviders,
      },
    },
  };
}
