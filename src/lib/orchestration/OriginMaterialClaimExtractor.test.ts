import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { extractOriginMaterialClaims } from "./OriginMaterialClaimExtractor";

const answer = "The current version is 2.0. The test suite passed.";
const digest = `sha256:${createHash("sha256").update(answer, "utf8").digest("hex")}`;

describe("OriginMaterialClaimExtractor", () => {
  it("accepts only claims grounded as exact spans in the answer", async () => {
    const extractor = vi.fn().mockResolvedValue({
      answerDigest: digest,
      claims: [
        {
          id: "claim-version",
          text: "The current version is 2.0.",
          kind: "factual",
          freshness: "current",
          evidenceRequirement: "supporting-evidence",
          risk: "medium",
        },
        {
          id: "claim-tests",
          text: "The test suite passed.",
          kind: "execution-claim",
          freshness: "current",
          evidenceRequirement: "deterministic-execution",
          risk: "high",
        },
      ],
      actualCostUsd: 0,
      attempts: 1,
    });

    const result = await extractOriginMaterialClaims(answer, extractor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claimSet.claims.map((claim) => claim.id)).toEqual([
      "claim-version",
      "claim-tests",
    ]);
    expect(extractor).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the extractor is unavailable or throws", async () => {
    await expect(extractOriginMaterialClaims(answer))
      .resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTOR_NOT_AVAILABLE" });

    await expect(extractOriginMaterialClaims(
      answer,
      vi.fn().mockRejectedValue(new Error("failed")),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_FAILED" });
  });

  it("rejects fabricated claims that do not exist in the answer text", async () => {
    const extractor = vi.fn().mockResolvedValue({
      answerDigest: digest,
      claims: [{
        id: "claim-fabricated",
        text: "A fact that is not in the answer.",
        kind: "factual",
        freshness: "stable",
        evidenceRequirement: "supporting-evidence",
        risk: "medium",
      }],
      actualCostUsd: 0,
      attempts: 1,
    });

    await expect(extractOriginMaterialClaims(answer, extractor))
      .resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" });
  });

  it("rejects paid, digest-mismatched or structurally invalid extraction", async () => {
    const base = {
      answerDigest: digest,
      claims: [{
        id: "claim-version",
        text: "The current version is 2.0.",
        kind: "factual",
        freshness: "current",
        evidenceRequirement: "supporting-evidence",
        risk: "medium",
      }],
      actualCostUsd: 0,
      attempts: 1,
    };

    await expect(extractOriginMaterialClaims(
      answer,
      vi.fn().mockResolvedValue({ ...base, actualCostUsd: 0.01 }),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_COST_UNVERIFIED" });

    await expect(extractOriginMaterialClaims(
      answer,
      vi.fn().mockResolvedValue({
        ...base,
        answerDigest: `sha256:${"b".repeat(64)}`,
      }),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" });

    await expect(extractOriginMaterialClaims(
      answer,
      vi.fn().mockResolvedValue({
        ...base,
        claims: [{ ...base.claims[0], id: "bad-id" }],
      }),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_INVALID" });
  });
});
