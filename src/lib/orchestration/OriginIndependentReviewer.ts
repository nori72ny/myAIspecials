import type { OriginVerificationResult } from "./OriginVerifier.js";

export interface OriginIndependentReviewRequest {
  readonly answerDigest: string;
  readonly claimSetDigest: string;
  readonly evidenceLedgerDigest: string;
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
  };
}

export interface OriginIndependentReviewRecord {
  readonly answerDigest: string;
  readonly claimSetDigest: string;
  readonly evidenceLedgerDigest: string;
  readonly verdict: "pass" | "reject";
  readonly actualCostUsd: 0;
  readonly attempts: 1;
}

export interface OriginIndependentReviewer {
  (request: OriginIndependentReviewRequest): Promise<unknown>;
}

export type OriginIndependentReviewResult =
  | { ok: true; record: OriginIndependentReviewRecord }
  | {
      ok: false;
      code:
        | "INDEPENDENT_REVIEWER_NOT_AVAILABLE"
        | "INDEPENDENT_REVIEW_FAILED"
        | "INDEPENDENT_REVIEW_RECORD_MISMATCH"
        | "INDEPENDENT_REVIEW_COST_UNVERIFIED"
        | "INDEPENDENT_REVIEW_REJECTED";
    };

function isDigest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is OriginIndependentReviewRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<OriginIndependentReviewRecord>;
  return typeof r.answerDigest === "string"
    && typeof r.claimSetDigest === "string"
    && typeof r.evidenceLedgerDigest === "string"
    && (r.verdict === "pass" || r.verdict === "reject")
    && r.attempts === 1
    && typeof r.actualCostUsd === "number";
}

export async function runOriginIndependentReview(
  request: OriginIndependentReviewRequest,
  reviewer?: OriginIndependentReviewer,
): Promise<OriginIndependentReviewResult> {
  if (
    !isDigest(request.answerDigest)
    || !isDigest(request.claimSetDigest)
    || !isDigest(request.evidenceLedgerDigest)
    || request.executionPolicy.maxCostUsd !== 0
    || request.executionPolicy.maxAttempts !== 1
  ) {
    return { ok: false, code: "INDEPENDENT_REVIEW_RECORD_MISMATCH" };
  }

  if (!reviewer) {
    return { ok: false, code: "INDEPENDENT_REVIEWER_NOT_AVAILABLE" };
  }

  let raw: unknown;
  try {
    raw = await reviewer(request);
  } catch {
    return { ok: false, code: "INDEPENDENT_REVIEW_FAILED" };
  }

  if (!isRecord(raw)) {
    return { ok: false, code: "INDEPENDENT_REVIEW_RECORD_MISMATCH" };
  }

  if (
    raw.answerDigest !== request.answerDigest
    || raw.claimSetDigest !== request.claimSetDigest
    || raw.evidenceLedgerDigest !== request.evidenceLedgerDigest
    || raw.attempts !== 1
  ) {
    return { ok: false, code: "INDEPENDENT_REVIEW_RECORD_MISMATCH" };
  }

  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "INDEPENDENT_REVIEW_COST_UNVERIFIED" };
  }

  if (raw.verdict !== "pass") {
    return { ok: false, code: "INDEPENDENT_REVIEW_REJECTED" };
  }

  return { ok: true, record: Object.freeze({ ...raw }) };
}

export function applyIndependentReviewToVerification(
  verification: OriginVerificationResult,
  review: OriginIndependentReviewResult,
): OriginVerificationResult {
  if (review.ok) {
    return verification;
  }

  const hasIssue = verification.issues.some(
    (issue) => issue.code === "INDEPENDENT_REVIEW_REQUIRED",
  );
  if (hasIssue) return verification;

  return Object.freeze({
    ...verification,
    decision: "BLOCKED_UNVERIFIED" as const,
    issues: Object.freeze([
      ...verification.issues,
      {
        code: "INDEPENDENT_REVIEW_REQUIRED" as const,
        repairable: false,
      },
    ]),
  });
}
