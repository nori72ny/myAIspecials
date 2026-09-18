import { describe, expect, it, vi } from "vitest";

import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope";
import { prepareAndVerifyOriginAnswer } from "./OriginAnswerVerificationPreparation";

const observedAt = "2026-09-18T12:00:00.000Z";

const checkedEvidence: OriginAnswerEvidenceItem = {
  label: "Official source",
  sourceUrl: "https://example.com/docs",
  claim: "The service has a free tier.",
  claimBinding: "explicit-inline-citation",
  evidenceLevel: "source-checked",
  checks: {
    safeUrl: "passed",
    content: "passed",
    freshness: "passed",
    claimSupport: "passed",
  },
};

describe("OriginAnswerVerificationPreparation", () => {
  it("extracts claims, binds checked evidence and reaches PASS when policy requirements are met", async () => {
    const extractor = vi.fn().mockImplementation(async (request) => ({
      answerDigest: request.answerDigest,
      claims: [{
        id: "claim-a",
        text: "The service has a free tier.",
        kind: "factual",
        freshness: "current",
        evidenceRequirement: "supporting-evidence",
        risk: "medium",
      }],
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await prepareAndVerifyOriginAnswer(
      "The service has a free tier.",
      [checkedEvidence],
      observedAt,
      extractor,
      {
        independentReviewRequired: false,
        independentReviewPerformed: false,
        currentEvidenceCutoffMs: Date.parse("2026-09-18T00:00:00.000Z"),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      claimCount: 1,
      evidenceCount: 1,
      verification: {
        decision: "PASS",
        verifiedClaimIds: ["claim-a"],
      },
    });
  });

  it("detects unsupported material claims that have no bound evidence", async () => {
    const extractor = vi.fn().mockImplementation(async (request) => ({
      answerDigest: request.answerDigest,
      claims: [
        {
          id: "claim-a",
          text: "The service has a free tier.",
          kind: "factual",
          freshness: "current",
          evidenceRequirement: "supporting-evidence",
          risk: "medium",
        },
        {
          id: "claim-b",
          text: "The service also includes unlimited enterprise support.",
          kind: "factual",
          freshness: "current",
          evidenceRequirement: "supporting-evidence",
          risk: "high",
        },
      ],
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await prepareAndVerifyOriginAnswer(
      "The service has a free tier. It also includes unlimited enterprise support.",
      [checkedEvidence],
      observedAt,
      extractor,
      {
        independentReviewRequired: false,
        independentReviewPerformed: false,
        currentEvidenceCutoffMs: Date.parse("2026-09-18T00:00:00.000Z"),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verification.decision).toBe("REPAIR_REQUIRED");
    expect(result.verification.issues).toContainEqual({
      claimId: "claim-b",
      code: "MISSING_EVIDENCE",
      repairable: true,
    });
  });

  it("keeps provider-only citations insufficient for claim verification", async () => {
    const extractor = vi.fn().mockImplementation(async (request) => ({
      answerDigest: request.answerDigest,
      claims: [{
        id: "claim-a",
        text: "The service has a free tier.",
        kind: "factual",
        freshness: "current",
        evidenceRequirement: "supporting-evidence",
        risk: "medium",
      }],
      actualCostUsd: 0,
      attempts: 1,
    }));

    const provided: OriginAnswerEvidenceItem = {
      ...checkedEvidence,
      evidenceLevel: "provided",
      checks: {
        safeUrl: "passed",
        content: "not-run",
        freshness: "not-run",
        claimSupport: "not-run",
      },
    };

    const result = await prepareAndVerifyOriginAnswer(
      "The service has a free tier.",
      [provided],
      observedAt,
      extractor,
      {
        independentReviewRequired: false,
        independentReviewPerformed: false,
        currentEvidenceCutoffMs: Date.parse("2026-09-18T00:00:00.000Z"),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verification.decision).toBe("REPAIR_REQUIRED");
    expect(result.verification.issues).toContainEqual({
      claimId: "claim-a",
      code: "INSUFFICIENT_EVIDENCE_STATE",
      repairable: true,
    });
  });

  it("fails closed when material claim extraction is unavailable", async () => {
    await expect(prepareAndVerifyOriginAnswer(
      "A factual answer.",
      [],
      observedAt,
      undefined,
      {
        independentReviewRequired: false,
        independentReviewPerformed: false,
      },
    )).resolves.toEqual({
      ok: false,
      code: "CLAIM_EXTRACTION_FAILED",
    });
  });
});
