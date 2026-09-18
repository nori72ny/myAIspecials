import { describe, expect, it } from "vitest";

import { createOriginClaimSet } from "./OriginClaimModel";
import { createOriginEvidenceLedger } from "./OriginEvidenceLedger";
import { verifyOriginAnswerEvidence } from "./OriginVerifier";

function claims() {
  const result = createOriginClaimSet([
    {
      id: "claim-current",
      text: "The current version is documented.",
      kind: "factual",
      freshness: "current",
      evidenceRequirement: "supporting-evidence",
      risk: "medium",
    },
    {
      id: "claim-exec",
      text: "The code checks passed.",
      kind: "execution-claim",
      freshness: "current",
      evidenceRequirement: "deterministic-execution",
      risk: "high",
    },
  ]);
  if (result.ok === false) throw new Error(result.code);
  return result.value;
}

function ledger(observedAt = "2026-09-18T08:00:00.000Z") {
  const result = createOriginEvidenceLedger([
    {
      id: "ev-source",
      sourceKind: "retrieved-public",
      observedAt,
      label: "Official documentation",
      sourceUrl: "https://example.com/docs",
      claimIds: ["claim-current"],
      verificationState: "claim-supported",
      costUsd: 0,
    },
    {
      id: "ev-check",
      sourceKind: "code-check",
      observedAt,
      label: "Test suite",
      sourceRef: "test-run-1",
      claimIds: ["claim-exec"],
      verificationState: "verified",
      costUsd: 0,
    },
  ]);
  if (result.ok === false) throw new Error(result.code);
  return result.value;
}

const policy = {
  independentReviewRequired: false,
  independentReviewPerformed: false,
  currentEvidenceCutoffMs: Date.parse("2026-09-18T00:00:00.000Z"),
  realTimeEvidenceCutoffMs: Date.parse("2026-09-18T07:55:00.000Z"),
};

describe("OriginVerifier", () => {
  it("passes only when every material claim has adequate evidence", () => {
    const result = verifyOriginAnswerEvidence(claims(), ledger(), policy);
    expect(result.decision).toBe("PASS");
    expect(result.issues).toEqual([]);
    expect(result.verifiedClaimIds).toEqual(["claim-current", "claim-exec"]);
  });

  it("requests repair when evidence is missing", () => {
    const empty = createOriginEvidenceLedger([]);
    if (empty.ok === false) throw new Error(empty.code);
    const result = verifyOriginAnswerEvidence(claims(), empty.value, policy);
    expect(result.decision).toBe("REPAIR_REQUIRED");
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimId: "claim-current", code: "MISSING_EVIDENCE" }),
      expect.objectContaining({ claimId: "claim-exec", code: "MISSING_EVIDENCE" }),
    ]));
  });

  it("rejects stale evidence for a current claim", () => {
    const result = verifyOriginAnswerEvidence(
      claims(),
      ledger("2026-09-17T08:00:00.000Z"),
      policy,
    );
    expect(result.decision).toBe("REPAIR_REQUIRED");
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimId: "claim-current", code: "STALE_EVIDENCE" }),
    ]));
  });

  it("does not treat provider output as deterministic execution evidence", () => {
    const l = createOriginEvidenceLedger([
      {
        id: "ev-source",
        sourceKind: "retrieved-public",
        observedAt: "2026-09-18T08:00:00.000Z",
        label: "Official documentation",
        sourceUrl: "https://example.com/docs",
        claimIds: ["claim-current"],
        verificationState: "claim-supported",
        costUsd: 0,
      },
      {
        id: "ev-provider",
        sourceKind: "provider-output",
        observedAt: "2026-09-18T08:00:00.000Z",
        label: "Provider says tests passed",
        sourceRef: "provider-response-1",
        claimIds: ["claim-exec"],
        verificationState: "verified",
        costUsd: 0,
      },
    ]);
    if (l.ok === false) throw new Error(l.code);

    const result = verifyOriginAnswerEvidence(claims(), l.value, policy);
    expect(result.decision).toBe("REPAIR_REQUIRED");
    expect(result.issues).toContainEqual(expect.objectContaining({
      claimId: "claim-exec",
      code: "EXECUTION_EVIDENCE_REQUIRED",
    }));
  });


  it("requires repair when supported evidence conflicts for a material claim", () => {
    const result = verifyOriginAnswerEvidence(claims(), ledger(), {
      ...policy,
      conflictingClaimIds: ["claim-current"],
    });

    expect(result.decision).toBe("REPAIR_REQUIRED");
    expect(result.verifiedClaimIds).not.toContain("claim-current");
    expect(result.issues).toContainEqual({
      claimId: "claim-current",
      code: "CONFLICTING_EVIDENCE",
      repairable: true,
    });
  });

  it("blocks rather than fabricating PASS when independent review is mandatory but absent", () => {
    const result = verifyOriginAnswerEvidence(claims(), ledger(), {
      ...policy,
      independentReviewRequired: true,
      independentReviewPerformed: false,
    });
    expect(result.decision).toBe("BLOCKED_UNVERIFIED");
    expect(result.issues).toContainEqual({
      code: "INDEPENDENT_REVIEW_REQUIRED",
      repairable: false,
    });
  });

  it("allows mandatory independent review only when it actually ran", () => {
    const result = verifyOriginAnswerEvidence(claims(), ledger(), {
      ...policy,
      independentReviewRequired: true,
      independentReviewPerformed: true,
    });
    expect(result.decision).toBe("PASS");
  });
});
