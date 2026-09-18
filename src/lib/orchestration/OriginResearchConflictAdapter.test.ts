import { describe, expect, it } from "vitest";

import type { GroundedResearchReport } from "../../research/groundedResearchV11";
import { createOriginEvidenceLedger } from "./OriginEvidenceLedger";
import { deriveOriginConflictingClaimIdsFromResearch } from "./OriginResearchConflictAdapter";

const report: GroundedResearchReport = {
  version: "1.1",
  sourceCount: 2,
  distinctDomainCount: 2,
  confidence: "moderate",
  confidenceScope: "retrieval-evidence-only",
  semanticConflictDetection: "conservative-structured-only",
  sources: [
    {
      id: "S1",
      title: "Source A",
      url: "https://a.example.com",
      domain: "a.example.com",
      evidenceLevel: "page-verified",
      freshness: "recent",
      score: 80,
      scoreScope: "retrieval-evidence-only",
      citation: "[S1](https://a.example.com)",
    },
    {
      id: "S2",
      title: "Source B",
      url: "https://b.example.com",
      domain: "b.example.com",
      evidenceLevel: "page-verified",
      freshness: "recent",
      score: 80,
      scoreScope: "retrieval-evidence-only",
      citation: "[S2](https://b.example.com)",
    },
  ],
  conflicts: [{
    kind: "structured-value-mismatch",
    topic: "version",
    values: ["v1", "v2"],
    sourceIds: ["S1", "S2"],
    note: "review signal",
  }],
  report: "synthetic",
};

describe("OriginResearchConflictAdapter", () => {
  it("marks a claim conflicting only when two conflicting research sources support that claim", () => {
    const ledger = createOriginEvidenceLedger([
      {
        id: "ev-a",
        sourceKind: "retrieved-public",
        observedAt: "2026-09-18T12:00:00.000Z",
        label: "Source A",
        sourceUrl: "https://a.example.com",
        claimIds: ["claim-version"],
        verificationState: "claim-supported",
        costUsd: 0,
      },
      {
        id: "ev-b",
        sourceKind: "retrieved-public",
        observedAt: "2026-09-18T12:00:01.000Z",
        label: "Source B",
        sourceUrl: "https://b.example.com",
        claimIds: ["claim-version"],
        verificationState: "claim-supported",
        costUsd: 0,
      },
    ]);
    if (!ledger.ok) throw new Error("invalid fixture");

    expect(deriveOriginConflictingClaimIdsFromResearch(report, ledger.value))
      .toEqual(["claim-version"]);
  });

  it("does not over-apply a research conflict to unrelated claims", () => {
    const ledger = createOriginEvidenceLedger([
      {
        id: "ev-a",
        sourceKind: "retrieved-public",
        observedAt: "2026-09-18T12:00:00.000Z",
        label: "Source A",
        sourceUrl: "https://a.example.com",
        claimIds: ["claim-a"],
        verificationState: "claim-supported",
        costUsd: 0,
      },
      {
        id: "ev-b",
        sourceKind: "retrieved-public",
        observedAt: "2026-09-18T12:00:01.000Z",
        label: "Source B",
        sourceUrl: "https://b.example.com",
        claimIds: ["claim-b"],
        verificationState: "claim-supported",
        costUsd: 0,
      },
    ]);
    if (!ledger.ok) throw new Error("invalid fixture");

    expect(deriveOriginConflictingClaimIdsFromResearch(report, ledger.value))
      .toEqual([]);
  });

  it("requires at least two distinct conflicting source URLs for the same claim", () => {
    const ledger = createOriginEvidenceLedger([
      {
        id: "ev-a",
        sourceKind: "retrieved-public",
        observedAt: "2026-09-18T12:00:00.000Z",
        label: "Source A",
        sourceUrl: "https://a.example.com",
        claimIds: ["claim-version"],
        verificationState: "claim-supported",
        costUsd: 0,
      },
    ]);
    if (!ledger.ok) throw new Error("invalid fixture");

    expect(deriveOriginConflictingClaimIdsFromResearch(report, ledger.value))
      .toEqual([]);
  });

  it("returns no conflicts when grounded research reported none", () => {
    const ledger = createOriginEvidenceLedger([]);
    if (!ledger.ok) throw new Error("invalid fixture");

    expect(deriveOriginConflictingClaimIdsFromResearch(
      { ...report, conflicts: [] },
      ledger.value,
    )).toEqual([]);
  });
});
