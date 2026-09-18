import { describe, expect, it } from "vitest";

import { createOriginClaimSet } from "./OriginClaimModel";
import { createOriginEvidenceLedger } from "./OriginEvidenceLedger";
import { createOriginAnswerReviewDigests } from "./OriginAnswerReviewDigests";

describe("OriginAnswerReviewDigests", () => {
  it("produces deterministic sha256 digests for the review target", () => {
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

    const one = createOriginAnswerReviewDigests(
      "The service has a free tier.\n",
      claims.value,
      ledger.value,
    );
    const two = createOriginAnswerReviewDigests(
      "The service has a free tier.",
      claims.value,
      ledger.value,
    );

    expect(one).toEqual(two);
    expect(one.answerDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(one.claimSetDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(one.evidenceLedgerDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("changes digest when a material review target changes", () => {
    const claimsA = createOriginClaimSet([
      {
        id: "claim-a",
        text: "Fact A",
        kind: "factual",
        freshness: "stable",
        evidenceRequirement: "supporting-evidence",
        risk: "low",
      },
    ]);
    const claimsB = createOriginClaimSet([
      {
        id: "claim-a",
        text: "Fact B",
        kind: "factual",
        freshness: "stable",
        evidenceRequirement: "supporting-evidence",
        risk: "low",
      },
    ]);
    const ledger = createOriginEvidenceLedger([]);
    if (!claimsA.ok || !claimsB.ok || !ledger.ok) throw new Error("invalid fixture");

    const a = createOriginAnswerReviewDigests("Answer", claimsA.value, ledger.value);
    const b = createOriginAnswerReviewDigests("Answer", claimsB.value, ledger.value);

    expect(a.claimSetDigest).not.toBe(b.claimSetDigest);
    expect(a.answerDigest).toBe(b.answerDigest);
  });
});
