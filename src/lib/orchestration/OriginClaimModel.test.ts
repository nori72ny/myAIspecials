import { describe, expect, it } from "vitest";

import { createOriginClaimSet, type OriginMaterialClaimInput } from "./OriginClaimModel";

const factual: OriginMaterialClaimInput = {
  id: "claim-1",
  text: "The release is documented by the cited source.",
  kind: "factual",
  freshness: "stable",
  evidenceRequirement: "supporting-evidence",
  risk: "medium",
};

describe("OriginClaimModel", () => {
  it("creates an immutable bounded claim set", () => {
    const result = createOriginClaimSet([factual]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe("origin.claim-set.v1");
    expect(result.value.claims).toEqual([factual]);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.claims)).toBe(true);
    expect(Object.isFrozen(result.value.claims[0])).toBe(true);
  });

  it("requires current and real-time factual claims to have supporting evidence", () => {
    expect(createOriginClaimSet([{
      ...factual,
      freshness: "current",
      evidenceRequirement: "none",
    }]).ok).toBe(false);
    expect(createOriginClaimSet([{
      ...factual,
      freshness: "real-time",
      evidenceRequirement: "user-provided",
    }]).ok).toBe(false);
  });

  it("requires execution claims to use deterministic execution evidence", () => {
    expect(createOriginClaimSet([{
      ...factual,
      kind: "execution-claim",
      freshness: "current",
      evidenceRequirement: "supporting-evidence",
    }]).ok).toBe(false);
    expect(createOriginClaimSet([{
      ...factual,
      kind: "execution-claim",
      freshness: "current",
      evidenceRequirement: "deterministic-execution",
    }]).ok).toBe(true);
  });

  it("forces assumptions to remain explicitly unsupported assumptions", () => {
    expect(createOriginClaimSet([{
      ...factual,
      kind: "assumption",
      freshness: "not-applicable",
      evidenceRequirement: "none",
    }]).ok).toBe(true);
    expect(createOriginClaimSet([{
      ...factual,
      kind: "assumption",
      freshness: "stable",
      evidenceRequirement: "supporting-evidence",
    }]).ok).toBe(false);
  });

  it("rejects duplicates, malformed IDs and secret-bearing claims", () => {
    expect(createOriginClaimSet([factual, factual]).ok).toBe(false);
    expect(createOriginClaimSet([{ ...factual, id: "bad id" }]).ok).toBe(false);
    expect(createOriginClaimSet([{
      ...factual,
      text: "Authorization: Bearer synthetic_claim_secret_123456",
    }]).ok).toBe(false);
  });

  it("does not allow recommendations to masquerade as deterministic execution", () => {
    expect(createOriginClaimSet([{
      ...factual,
      kind: "recommendation",
      freshness: "not-applicable",
      evidenceRequirement: "deterministic-execution",
    }]).ok).toBe(false);
  });
});
