import { describe, expect, it, vi } from "vitest";

import {
  applyIndependentReviewToVerification,
  runOriginIndependentReview,
} from "./OriginIndependentReviewer";
import type { OriginVerificationResult } from "./OriginVerifier";

const request = {
  answerDigest: `sha256:${"a".repeat(64)}`,
  claimSetDigest: `sha256:${"b".repeat(64)}`,
  evidenceLedgerDigest: `sha256:${"c".repeat(64)}`,
  executionPolicy: {
    maxCostUsd: 0 as const,
    maxAttempts: 1 as const,
  },
};

describe("OriginIndependentReviewer", () => {
  it("accepts only a matching zero-cost one-attempt independent review", async () => {
    const reviewer = vi.fn().mockResolvedValue({
      answerDigest: request.answerDigest,
      claimSetDigest: request.claimSetDigest,
      evidenceLedgerDigest: request.evidenceLedgerDigest,
      verdict: "pass",
      actualCostUsd: 0,
      attempts: 1,
    });

    const result = await runOriginIndependentReview(request, reviewer);
    expect(result.ok).toBe(true);
    expect(reviewer).toHaveBeenCalledTimes(1);
  });

  it("fails closed when reviewer is unavailable, throws, or rejects", async () => {
    await expect(runOriginIndependentReview(request))
      .resolves.toEqual({ ok: false, code: "INDEPENDENT_REVIEWER_NOT_AVAILABLE" });

    await expect(runOriginIndependentReview(
      request,
      vi.fn().mockRejectedValue(new Error("failed")),
    )).resolves.toEqual({ ok: false, code: "INDEPENDENT_REVIEW_FAILED" });

    await expect(runOriginIndependentReview(
      request,
      vi.fn().mockResolvedValue({
        ...request,
        verdict: "reject",
        actualCostUsd: 0,
        attempts: 1,
      }),
    )).resolves.toEqual({ ok: false, code: "INDEPENDENT_REVIEW_REJECTED" });
  });

  it("rejects paid or mismatched review records", async () => {
    await expect(runOriginIndependentReview(
      request,
      vi.fn().mockResolvedValue({
        answerDigest: request.answerDigest,
        claimSetDigest: request.claimSetDigest,
        evidenceLedgerDigest: request.evidenceLedgerDigest,
        verdict: "pass",
        actualCostUsd: 0.01,
        attempts: 1,
      }),
    )).resolves.toEqual({ ok: false, code: "INDEPENDENT_REVIEW_COST_UNVERIFIED" });

    await expect(runOriginIndependentReview(
      request,
      vi.fn().mockResolvedValue({
        answerDigest: `sha256:${"d".repeat(64)}`,
        claimSetDigest: request.claimSetDigest,
        evidenceLedgerDigest: request.evidenceLedgerDigest,
        verdict: "pass",
        actualCostUsd: 0,
        attempts: 1,
      }),
    )).resolves.toEqual({ ok: false, code: "INDEPENDENT_REVIEW_RECORD_MISMATCH" });
  });

  it("adds a blocking issue when required review did not pass", () => {
    const verification: OriginVerificationResult = {
      schemaVersion: "origin.verification.v1",
      decision: "PASS",
      issues: [],
      verifiedClaimIds: ["c1"],
    };

    const result = applyIndependentReviewToVerification(
      verification,
      { ok: false, code: "INDEPENDENT_REVIEWER_NOT_AVAILABLE" },
    );

    expect(result.decision).toBe("BLOCKED_UNVERIFIED");
    expect(result.issues).toContainEqual({
      code: "INDEPENDENT_REVIEW_REQUIRED",
      repairable: false,
    });
  });

  it("does not duplicate the blocking review issue", () => {
    const verification: OriginVerificationResult = {
      schemaVersion: "origin.verification.v1",
      decision: "BLOCKED_UNVERIFIED",
      issues: [{ code: "INDEPENDENT_REVIEW_REQUIRED", repairable: false }],
      verifiedClaimIds: [],
    };

    const result = applyIndependentReviewToVerification(
      verification,
      { ok: false, code: "INDEPENDENT_REVIEW_FAILED" },
    );

    expect(result.issues).toHaveLength(1);
  });
});
