import { describe, expect, it, vi } from "vitest";

import { createOriginClaimSet } from "./OriginClaimModel";
import { createOriginEvidenceLedger } from "./OriginEvidenceLedger";
import { runOriginFullAnswerQualityPipeline } from "./OriginFullAnswerQualityPipeline";
import type { OriginVerificationResult } from "./OriginVerifier";

const context = {
  maxCostUsd: 0 as const,
  allowExternalMutation: false as const,
  allowUserImpersonation: false as const,
};

function fixture() {
  const claims = createOriginClaimSet([
    {
      id: "claim-a",
      text: "The service has a free tier.",
      kind: "factual",
      freshness: "current",
      evidenceRequirement: "supporting-evidence",
      risk: "medium",
    },
  ]);
  const ledger = createOriginEvidenceLedger([
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
  if (!claims.ok || !ledger.ok) throw new Error("invalid fixture");
  return { claims: claims.value, ledger: ledger.value };
}

function verification(
  decision: OriginVerificationResult["decision"],
  issues: OriginVerificationResult["issues"] = [],
): OriginVerificationResult {
  return {
    schemaVersion: "origin.verification.v1",
    decision,
    issues,
    verifiedClaimIds: decision === "PASS" ? ["claim-a"] : [],
  };
}

describe("OriginFullAnswerQualityPipeline", () => {
  it("returns a passed presentation when review is not required", async () => {
    const { claims, ledger } = fixture();

    const result = await runOriginFullAnswerQualityPipeline({
      answerText: "The service has a free tier.",
      claimSet: claims,
      evidenceLedger: ledger,
      verification: verification("PASS"),
      language: "en",
      independentReviewRequired: false,
    }, {}, context);

    expect(result.final.verification.decision).toBe("PASS");
    expect(result.final.presentation.status).toBe("not-required");
    expect(result.independentReview?.reviewPerformed).toBe(false);
  });

  it("requires digest-bound independent review before presenting required review as passed", async () => {
    const { claims, ledger } = fixture();
    const reviewer = vi.fn().mockImplementation(async (request) => ({
      answerDigest: request.answerDigest,
      claimSetDigest: request.claimSetDigest,
      evidenceLedgerDigest: request.evidenceLedgerDigest,
      verdict: "pass",
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await runOriginFullAnswerQualityPipeline({
      answerText: "The service has a free tier.",
      claimSet: claims,
      evidenceLedger: ledger,
      verification: verification("PASS"),
      language: "ja",
      independentReviewRequired: true,
    }, {}, context, undefined, reviewer);

    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(result.independentReview?.reviewPerformed).toBe(true);
    expect(result.final.verification.decision).toBe("PASS");
    expect(result.final.presentation.status).toBe("passed");
  });

  it("blocks a required-review answer when no reviewer is available", async () => {
    const { claims, ledger } = fixture();

    const result = await runOriginFullAnswerQualityPipeline({
      answerText: "The service has a free tier.",
      claimSet: claims,
      evidenceLedger: ledger,
      verification: verification("PASS"),
      language: "ja",
      independentReviewRequired: true,
    }, {}, context);

    expect(result.independentReview?.reviewPerformed).toBe(false);
    expect(result.final.verification.decision).toBe("BLOCKED_UNVERIFIED");
    expect(result.final.presentation.status).toBe("not-run");
  });

  it("repairs once, reverifies, then runs independent review", async () => {
    const { claims, ledger } = fixture();
    const retrieveEvidence = vi.fn().mockResolvedValue(true);
    const reverify = vi.fn().mockResolvedValue(verification("PASS"));
    const reviewer = vi.fn().mockImplementation(async (request) => ({
      answerDigest: request.answerDigest,
      claimSetDigest: request.claimSetDigest,
      evidenceLedgerDigest: request.evidenceLedgerDigest,
      verdict: "pass",
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await runOriginFullAnswerQualityPipeline({
      answerText: "The service has a free tier.",
      claimSet: claims,
      evidenceLedger: ledger,
      verification: verification("REPAIR_REQUIRED", [
        { claimId: "claim-a", code: "MISSING_EVIDENCE", repairable: true },
      ]),
      language: "en",
      independentReviewRequired: true,
    }, { retrieveEvidence }, context, reverify, reviewer);

    expect(retrieveEvidence).toHaveBeenCalledTimes(1);
    expect(reverify).toHaveBeenCalledTimes(1);
    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(result.final.presentation.status).toBe("passed");
  });

  it("never runs independent review when repair or reverification did not reach PASS", async () => {
    const { claims, ledger } = fixture();
    const reviewer = vi.fn();

    const result = await runOriginFullAnswerQualityPipeline({
      answerText: "The service has a free tier.",
      claimSet: claims,
      evidenceLedger: ledger,
      verification: verification("REPAIR_REQUIRED", [
        { claimId: "claim-a", code: "MISSING_EVIDENCE", repairable: true },
      ]),
      language: "en",
      independentReviewRequired: true,
    }, {
      retrieveEvidence: vi.fn().mockResolvedValue(false),
    }, context, undefined, reviewer);

    expect(reviewer).not.toHaveBeenCalled();
    expect(result.independentReview).toBeNull();
    expect(result.final.verification.decision).toBe("BLOCKED_UNVERIFIED");
    expect(result.final.presentation.status).toBe("not-run");
  });
});
