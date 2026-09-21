import { describe, expect, it } from "vitest";

import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope";
import { bindOriginAnswerEvidenceToClaims } from "./OriginClaimEvidenceBinder";
import { createOriginClaimSet } from "./OriginClaimModel";

const observedAt = "2026-09-18T12:00:00.000Z";

function checked(claim: string): OriginAnswerEvidenceItem {
  return {
    label: "Official source",
    sourceUrl: "https://example.com/docs",
    claim,
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

describe("OriginClaimEvidenceBinder", () => {
  it("binds checked evidence only when one material claim matches exactly after whitespace normalization", () => {
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
    if (!claims.ok) throw new Error("invalid fixture");

    const result = bindOriginAnswerEvidenceToClaims(
      claims.value,
      [checked("The   service has a free tier.")],
      observedAt,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.entries[0]).toEqual(expect.objectContaining({
      claimIds: ["claim-a"],
      sourceKind: "retrieved-public",
      verificationState: "claim-supported",
    }));
  });

  it("does not bind a merely similar claim", () => {
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
    if (!claims.ok) throw new Error("invalid fixture");

    const result = bindOriginAnswerEvidenceToClaims(
      claims.value,
      [checked("The service may have a free tier.")],
      observedAt,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.entries[0]).toEqual(expect.objectContaining({
      claimIds: [],
      verificationState: "source-checked",
    }));
  });

  it("does not bind ambiguous duplicate claim text", () => {
    const claims = createOriginClaimSet([
      {
        id: "claim-a",
        text: "Shared fact.",
        kind: "factual",
        freshness: "stable",
        evidenceRequirement: "supporting-evidence",
        risk: "low",
      },
      {
        id: "claim-b",
        text: "Shared fact.",
        kind: "factual",
        freshness: "stable",
        evidenceRequirement: "supporting-evidence",
        risk: "medium",
      },
    ]);
    if (!claims.ok) throw new Error("invalid fixture");

    const result = bindOriginAnswerEvidenceToClaims(
      claims.value,
      [checked("Shared fact.")],
      observedAt,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.entries[0].claimIds).toEqual([]);
    expect(result.ledger.entries[0].verificationState).toBe("source-checked");
  });

  it("keeps provider citations unverified even when claim text matches", () => {
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
    if (!claims.ok) throw new Error("invalid fixture");

    const provided: OriginAnswerEvidenceItem = {
      ...checked("The service has a free tier."),
      evidenceLevel: "provided",
      checks: {
        safeUrl: "passed",
        content: "not-run",
        freshness: "not-run",
        claimSupport: "not-run",
      },
    };

    const result = bindOriginAnswerEvidenceToClaims(
      claims.value,
      [provided],
      observedAt,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.entries[0]).toEqual(expect.objectContaining({
      claimIds: ["claim-a"],
      sourceKind: "provider-output",
      verificationState: "unverified",
    }));
  });
});
