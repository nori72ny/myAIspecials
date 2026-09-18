import { describe, expect, it } from "vitest";

import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope";
import { projectOriginAnswerEvidence } from "./OriginEvidenceAdapters";
import { verifyOriginAnswerEvidence } from "./OriginVerifier";

const observedAt = "2026-09-18T08:00:00.000Z";

function checked(): OriginAnswerEvidenceItem {
  return {
    label: "Official source",
    sourceUrl: "https://example.com/current",
    claim: "The documented value is current.",
    claimBinding: "explicit-inline-citation",
    evidenceLevel: "source-checked",
    checks: {
      safeUrl: "passed",
      content: "passed",
      freshness: "passed",
      claimSupport: "passed",
    },
  };
}

function provided(): OriginAnswerEvidenceItem {
  return {
    label: "Provider citation",
    sourceUrl: "https://example.com/provider-citation",
    claim: "The provider says this is current.",
    claimBinding: "explicit-inline-citation",
    evidenceLevel: "provided",
    checks: {
      safeUrl: "passed",
      content: "not-run",
      freshness: "not-run",
      claimSupport: "not-run",
    },
  };
}

describe("OriginEvidenceAdapters", () => {
  it("projects independently checked evidence as claim-supported public evidence", () => {
    const result = projectOriginAnswerEvidence([checked()], observedAt, "current");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.claims.claims[0]).toEqual(expect.objectContaining({
      id: "claim-evidence-1",
      freshness: "current",
      evidenceRequirement: "supporting-evidence",
    }));
    expect(result.value.ledger.entries[0]).toEqual(expect.objectContaining({
      sourceKind: "retrieved-public",
      verificationState: "claim-supported",
      claimIds: ["claim-evidence-1"],
    }));
  });

  it("keeps provider-presented citations explicitly unverified", () => {
    const result = projectOriginAnswerEvidence([provided()], observedAt, "current");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.ledger.entries[0]).toEqual(expect.objectContaining({
      sourceKind: "provider-output",
      verificationState: "unverified",
    }));

    const verification = verifyOriginAnswerEvidence(
      result.value.claims,
      result.value.ledger,
      {
        independentReviewRequired: false,
        independentReviewPerformed: false,
        currentEvidenceCutoffMs: Date.parse("2026-09-18T00:00:00.000Z"),
        realTimeEvidenceCutoffMs: Date.parse("2026-09-18T07:55:00.000Z"),
      },
    );
    expect(verification.decision).toBe("REPAIR_REQUIRED");
    expect(verification.issues).toContainEqual(expect.objectContaining({
      claimId: "claim-evidence-1",
      code: "INSUFFICIENT_EVIDENCE_STATE",
    }));
  });

  it("does not invent a material claim for an unbound source link", () => {
    const item = provided();
    const unbound: OriginAnswerEvidenceItem = {
      ...item,
      claim: undefined,
      claimBinding: undefined,
    };
    const result = projectOriginAnswerEvidence([unbound], observedAt, "stable");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claims.claims).toEqual([]);
    expect(result.value.ledger.entries[0].claimIds).toEqual([]);
  });
});
