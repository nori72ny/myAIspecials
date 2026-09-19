import { describe, expect, it, vi } from "vitest";

import { extractOriginMaterialClaims } from "./OriginMaterialClaimExtractor";

function selected(id = "claim-1") {
  return {
    id,
    kind: "factual" as const,
    freshness: "current" as const,
    evidenceRequirement: "supporting-evidence" as const,
    risk: "medium" as const,
  };
}

describe("OriginMaterialClaimExtractor", () => {
  it("maps selected candidate IDs back to exact answer text", async () => {
    const extractor = vi.fn().mockImplementation(async (request) => ({
      answerDigest: request.answerDigest,
      claims: [selected("claim-1")],
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await extractOriginMaterialClaims(
      "The service has a free tier. It launched in 2026.",
      extractor,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claimSet.claims).toEqual([{
      id: "claim-1",
      text: "The service has a free tier.",
      kind: "factual",
      freshness: "current",
      evidenceRequirement: "supporting-evidence",
      risk: "medium",
    }]);
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(extractor.mock.calls[0][0].candidates).toEqual([
      { id: "claim-1", text: "The service has a free tier." },
      { id: "claim-2", text: "It launched in 2026." },
    ]);
    expect(extractor.mock.calls[0][0]).not.toHaveProperty("answerText");
    expect(extractor.mock.calls[0][0].executionPolicy).toEqual({
      maxCostUsd: 0,
      maxAttempts: 1,
      maxClaims: 64,
    });
  });

  it("fails closed when the extractor is unavailable or throws", async () => {
    await expect(extractOriginMaterialClaims("A factual answer."))
      .resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTOR_NOT_AVAILABLE" });

    await expect(extractOriginMaterialClaims(
      "A factual answer.",
      vi.fn().mockRejectedValue(new Error("failed")),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_FAILED" });
  });

  it("rejects paid and digest-mismatched records", async () => {
    await expect(extractOriginMaterialClaims(
      "Stable fact.",
      vi.fn().mockImplementation(async (request) => ({
        answerDigest: request.answerDigest,
        claims: [selected()],
        actualCostUsd: 0.01,
        attempts: 1,
      })),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_COST_UNVERIFIED" });

    await expect(extractOriginMaterialClaims(
      "Stable fact.",
      vi.fn().mockResolvedValue({
        answerDigest: `sha256:${"a".repeat(64)}`,
        claims: [selected()],
        actualCostUsd: 0,
        attempts: 1,
      }),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" });
  });

  it("rejects unknown or duplicate candidate IDs", async () => {
    await expect(extractOriginMaterialClaims(
      "First fact. Second fact.",
      vi.fn().mockImplementation(async (request) => ({
        answerDigest: request.answerDigest,
        claims: [selected("claim-99")],
        actualCostUsd: 0,
        attempts: 1,
      })),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" });

    await expect(extractOriginMaterialClaims(
      "First fact. Second fact.",
      vi.fn().mockImplementation(async (request) => ({
        answerDigest: request.answerDigest,
        claims: [selected("claim-1"), selected("claim-1")],
        actualCostUsd: 0,
        attempts: 1,
      })),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" });
  });

  it("rejects invalid classifications after exact candidate binding", async () => {
    const result = await extractOriginMaterialClaims(
      "Stable fact.",
      vi.fn().mockImplementation(async (request) => ({
        answerDigest: request.answerDigest,
        claims: [{
          id: "claim-1",
          kind: "execution-claim",
          freshness: "stable",
          evidenceRequirement: "supporting-evidence",
          risk: "low",
        }],
        actualCostUsd: 0,
        attempts: 1,
      })),
    );

    expect(result).toEqual({ ok: false, code: "INVALID_EXTRACTED_CLAIMS" });
  });

  it("blocks secret-bearing answers before external extraction", async () => {
    const extractor = vi.fn();

    const result = await extractOriginMaterialClaims(
      "Authorization: Bearer synthetic_secret_token_123456",
      extractor,
    );

    expect(result).toEqual({ ok: false, code: "INVALID_CLAIM_EXTRACTION_INPUT" });
    expect(extractor).not.toHaveBeenCalled();
  });

  it("bounds answer size before extraction", async () => {
    const extractor = vi.fn();

    const result = await extractOriginMaterialClaims("x".repeat(32_001), extractor);

    expect(result).toEqual({ ok: false, code: "INVALID_CLAIM_EXTRACTION_INPUT" });
    expect(extractor).not.toHaveBeenCalled();
  });

  it("fails closed before provider execution when deterministic candidates exceed 64", async () => {
    const extractor = vi.fn();
    const answer = Array.from(
      { length: 65 },
      (_, index) => `Fact ${index + 1}.`,
    ).join("\n");

    const result = await extractOriginMaterialClaims(answer, extractor);

    expect(result).toEqual({ ok: false, code: "CLAIM_EXTRACTION_CANDIDATE_LIMIT" });
    expect(extractor).not.toHaveBeenCalled();
  });
});
