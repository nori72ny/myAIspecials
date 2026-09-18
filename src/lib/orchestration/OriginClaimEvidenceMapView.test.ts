import { describe, expect, it } from "vitest";

import { createOriginClaimSet } from "./OriginClaimModel";
import { createOriginEvidenceLedger } from "./OriginEvidenceLedger";
import { createOriginClaimEvidenceMapView } from "./OriginClaimEvidenceMapView";

describe("OriginClaimEvidenceMapView", () => {
  it("maps each material claim to its supporting evidence without a truth probability", () => {
    const claims = createOriginClaimSet([
      {
        id: "claim-a",
        text: "Fact A",
        kind: "factual",
        freshness: "stable",
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
        sourceUrl: "https://example.com/a",
        claimIds: ["claim-a"],
        verificationState: "claim-supported",
        costUsd: 0,
      },
    ]);
    if (!claims.ok || !ledger.ok) throw new Error("invalid fixture");

    const view = createOriginClaimEvidenceMapView(claims.value, ledger.value);

    expect(view).toEqual([{
      claimId: "claim-a",
      claimText: "Fact A",
      state: "supported",
      evidenceIds: ["ev-a"],
      sourceLabels: ["Official source"],
    }]);
    expect(view[0]).not.toHaveProperty("confidence");
    expect(view[0]).not.toHaveProperty("probability");
  });

  it("shows partial when verified and unverified evidence are mixed", () => {
    const claims = createOriginClaimSet([
      {
        id: "claim-a",
        text: "Fact A",
        kind: "factual",
        freshness: "stable",
        evidenceRequirement: "supporting-evidence",
        risk: "low",
      },
    ]);
    const ledger = createOriginEvidenceLedger([
      {
        id: "ev-a",
        sourceKind: "retrieved-public",
        observedAt: "2026-09-18T10:00:00.000Z",
        label: "Verified source",
        sourceUrl: "https://example.com/a",
        claimIds: ["claim-a"],
        verificationState: "claim-supported",
        costUsd: 0,
      },
      {
        id: "ev-b",
        sourceKind: "provider-output",
        observedAt: "2026-09-18T10:00:01.000Z",
        label: "Provider citation",
        claimIds: ["claim-a"],
        verificationState: "unverified",
        costUsd: 0,
      },
    ]);
    if (!claims.ok || !ledger.ok) throw new Error("invalid fixture");

    expect(createOriginClaimEvidenceMapView(claims.value, ledger.value)[0].state).toBe("partial");
  });

  it("shows explicit conflict state when the verifier detects conflicting evidence", () => {
    const claims = createOriginClaimSet([
      {
        id: "claim-a",
        text: "Fact A",
        kind: "factual",
        freshness: "stable",
        evidenceRequirement: "supporting-evidence",
        risk: "low",
      },
    ]);
    const ledger = createOriginEvidenceLedger([]);
    if (!claims.ok || !ledger.ok) throw new Error("invalid fixture");

    expect(createOriginClaimEvidenceMapView(
      claims.value,
      ledger.value,
      ["claim-a"],
    )[0].state).toBe("conflicting");
  });

  it("keeps claims with no linked evidence explicitly unverified", () => {
    const claims = createOriginClaimSet([
      {
        id: "claim-a",
        text: "Fact A",
        kind: "factual",
        freshness: "stable",
        evidenceRequirement: "supporting-evidence",
        risk: "low",
      },
    ]);
    const ledger = createOriginEvidenceLedger([]);
    if (!claims.ok || !ledger.ok) throw new Error("invalid fixture");

    expect(createOriginClaimEvidenceMapView(claims.value, ledger.value)[0].state).toBe("unverified");
  });
});
