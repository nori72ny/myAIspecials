import { describe, expect, it, vi } from "vitest";

import { runOriginAnswerQualityOrchestrator } from "./OriginAnswerQualityOrchestrator";
import type { OriginVerificationResult } from "./OriginVerifier";

const context = {
  maxCostUsd: 0 as const,
  allowExternalMutation: false as const,
  allowUserImpersonation: false as const,
};

function verification(
  decision: OriginVerificationResult["decision"],
  issues: OriginVerificationResult["issues"] = [],
): OriginVerificationResult {
  return {
    schemaVersion: "origin.verification.v1",
    decision,
    issues,
    verifiedClaimIds: [],
  };
}

describe("OriginAnswerQualityOrchestrator", () => {
  it("returns immediately when the initial verification already passes", async () => {
    const reverify = vi.fn();

    const result = await runOriginAnswerQualityOrchestrator({
      verification: verification("PASS"),
      language: "ja",
      independentReviewRequired: false,
      independentReviewPerformed: false,
    }, {}, context, reverify);

    expect(result.reverificationPerformed).toBe(false);
    expect(result.final.presentation.status).toBe("not-required");
    expect(reverify).not.toHaveBeenCalled();
  });

  it("runs one bounded repair and then requires a fresh verifier result", async () => {
    const retrieveEvidence = vi.fn().mockResolvedValue(true);
    const reverify = vi.fn().mockResolvedValue(verification("PASS"));

    const result = await runOriginAnswerQualityOrchestrator({
      verification: verification("REPAIR_REQUIRED", [
        { claimId: "c1", code: "MISSING_EVIDENCE", repairable: true },
      ]),
      language: "en",
      independentReviewRequired: false,
      independentReviewPerformed: false,
    }, {
      retrieveEvidence,
    }, context, reverify);

    expect(retrieveEvidence).toHaveBeenCalledTimes(1);
    expect(reverify).toHaveBeenCalledTimes(1);
    expect(result.reverificationPerformed).toBe(true);
    expect(result.final.verification.decision).toBe("PASS");
    expect(result.final.presentation.status).toBe("not-required");
  });

  it("never self-certifies success when repair fails", async () => {
    const reverify = vi.fn();

    const result = await runOriginAnswerQualityOrchestrator({
      verification: verification("REPAIR_REQUIRED", [
        { claimId: "c1", code: "MISSING_EVIDENCE", repairable: true },
      ]),
      language: "ja",
      independentReviewRequired: false,
      independentReviewPerformed: false,
    }, {
      retrieveEvidence: vi.fn().mockResolvedValue(false),
    }, context, reverify);

    expect(result.reverificationPerformed).toBe(false);
    expect(result.final.verification.decision).toBe("BLOCKED_UNVERIFIED");
    expect(result.final.presentation.status).toBe("not-run");
    expect(reverify).not.toHaveBeenCalled();
  });

  it("blocks when a fresh verifier is unavailable after successful repair", async () => {
    const result = await runOriginAnswerQualityOrchestrator({
      verification: verification("REPAIR_REQUIRED", [
        { claimId: "c1", code: "MISSING_EVIDENCE", repairable: true },
      ]),
      language: "ja",
      independentReviewRequired: false,
      independentReviewPerformed: false,
    }, {
      retrieveEvidence: vi.fn().mockResolvedValue(true),
    }, context);

    expect(result.reverificationPerformed).toBe(false);
    expect(result.final.verification.decision).toBe("BLOCKED_UNVERIFIED");
    expect(result.final.presentation.status).toBe("not-run");
  });

  it("does not auto-run independent review or user-evidence actions", async () => {
    const reverify = vi.fn();

    const result = await runOriginAnswerQualityOrchestrator({
      verification: verification("BLOCKED_UNVERIFIED", [
        { code: "INDEPENDENT_REVIEW_REQUIRED", repairable: false },
      ]),
      language: "en",
      independentReviewRequired: true,
      independentReviewPerformed: false,
    }, {}, context, reverify);

    expect(result.reverificationPerformed).toBe(false);
    expect(result.final.verification.decision).toBe("BLOCKED_UNVERIFIED");
    expect(reverify).not.toHaveBeenCalled();
  });
});
