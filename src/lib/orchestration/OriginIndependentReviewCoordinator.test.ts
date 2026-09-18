import { describe, expect, it, vi } from "vitest";

import { createOriginClaimSet } from "./OriginClaimModel";
import { createOriginEvidenceLedger } from "./OriginEvidenceLedger";
import { coordinateOriginIndependentReview } from "./OriginIndependentReviewCoordinator";
import type { OriginVerificationResult } from "./OriginVerifier";

function fixture() {
  const claimSet = createOriginClaimSet([
    {
      id: "claim-a",
      text: "The service has a free tier.",
      kind: "factual",
      freshness: "current",
      evidenceRequirement: "supporting-evidence",
      risk: "medium",
    },
  ]);
  const evidenceLedger = createOriginEvidenceLedger([
    {
      id: "ev-a",
      sourceKind: "retrieved-public",
      observedAt: "2026-09-18T10:00:00.000Z",
      label: "Official source",
      sourceUrl: "https://example.com/docs",
      claimIds: ["claim-a"],
      verificationState: "claim-supported",
      costUsd: 0,
    },
  ]);
  if (!claimSet.ok || !evidenceLedger.ok) throw new Error("invalid fixture");

  const verification: OriginVerificationResult = {
    schemaVersion: "origin.verification.v1",
    decision: "PASS",
    issues: [],
    verifiedClaimIds: ["claim-a"],
  };

  return { claimSet: claimSet.value, evidenceLedger: evidenceLedger.value, verification };
}

describe("OriginIndependentReviewCoordinator", () => {
  it("skips independent review when policy does not require it", async () => {
    const { claimSet, evidenceLedger, verification } = fixture();
    const reviewer = vi.fn();

    const result = await coordinateOriginIndependentReview({
      answerText: "The service has a free tier.",
      claimSet,
      evidenceLedger,
      verification,
      required: false,
    }, reviewer);

    expect(result.reviewPerformed).toBe(false);
    expect(result.review).toBeNull();
    expect(result.verification).toBe(verification);
    expect(reviewer).not.toHaveBeenCalled();
  });

  it("binds a required review to the exact answer, claim set and evidence ledger", async () => {
    const { claimSet, evidenceLedger, verification } = fixture();

    const reviewer = vi.fn().mockImplementation(async (request) => ({
      answerDigest: request.answerDigest,
      claimSetDigest: request.claimSetDigest,
      evidenceLedgerDigest: request.evidenceLedgerDigest,
      verdict: "pass",
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await coordinateOriginIndependentReview({
      answerText: "The service has a free tier.",
      claimSet,
      evidenceLedger,
      verification,
      required: true,
    }, reviewer);

    expect(result.reviewPerformed).toBe(true);
    expect(result.review?.ok).toBe(true);
    expect(result.verification.decision).toBe("PASS");
    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(result.digests.answerDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("blocks verification when required review is unavailable", async () => {
    const { claimSet, evidenceLedger, verification } = fixture();

    const result = await coordinateOriginIndependentReview({
      answerText: "The service has a free tier.",
      claimSet,
      evidenceLedger,
      verification,
      required: true,
    });

    expect(result.reviewPerformed).toBe(false);
    expect(result.verification.decision).toBe("BLOCKED_UNVERIFIED");
    expect(result.verification.issues).toContainEqual({
      code: "INDEPENDENT_REVIEW_REQUIRED",
      repairable: false,
    });
  });

  it("does not let a mismatched review certify a different answer", async () => {
    const { claimSet, evidenceLedger, verification } = fixture();

    const reviewer = vi.fn().mockResolvedValue({
      answerDigest: `sha256:${"d".repeat(64)}`,
      claimSetDigest: `sha256:${"b".repeat(64)}`,
      evidenceLedgerDigest: `sha256:${"c".repeat(64)}`,
      verdict: "pass",
      actualCostUsd: 0,
      attempts: 1,
    });

    const result = await coordinateOriginIndependentReview({
      answerText: "The service has a free tier.",
      claimSet,
      evidenceLedger,
      verification,
      required: true,
    }, reviewer);

    expect(result.reviewPerformed).toBe(false);
    expect(result.review?.ok).toBe(false);
    expect(result.verification.decision).toBe("BLOCKED_UNVERIFIED");
  });
});
