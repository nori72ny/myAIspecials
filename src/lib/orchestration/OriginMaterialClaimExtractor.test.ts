import { describe, expect, it, vi } from "vitest";

import { extractOriginMaterialClaims } from "./OriginMaterialClaimExtractor";

describe("OriginMaterialClaimExtractor", () => {
  it("accepts only answer-bound zero-cost one-attempt material claims", async () => {
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

    const result = await extractOriginMaterialClaims(
      "The service has a free tier.",
      extractor,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claimSet.claims).toHaveLength(1);
    expect(extractor).toHaveBeenCalledTimes(1);
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

  it("rejects paid, digest-mismatched and invalid claim records", async () => {
    const base = {
      claims: [{
        id: "claim-a",
        text: "Stable fact.",
        kind: "factual",
        freshness: "stable",
        evidenceRequirement: "supporting-evidence",
        risk: "low",
      }],
      actualCostUsd: 0,
      attempts: 1,
    };

    await expect(extractOriginMaterialClaims(
      "Stable fact.",
      vi.fn().mockImplementation(async (request) => ({
        ...base,
        answerDigest: request.answerDigest,
        actualCostUsd: 0.01,
      })),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_COST_UNVERIFIED" });

    await expect(extractOriginMaterialClaims(
      "Stable fact.",
      vi.fn().mockResolvedValue({
        ...base,
        answerDigest: `sha256:${"a".repeat(64)}`,
      }),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_RECORD_MISMATCH" });

    await expect(extractOriginMaterialClaims(
      "Stable fact.",
      vi.fn().mockImplementation(async (request) => ({
        ...base,
        answerDigest: request.answerDigest,
        claims: [{ ...base.claims[0], id: "invalid" }],
      })),
    )).resolves.toEqual({ ok: false, code: "INVALID_EXTRACTED_CLAIMS" });
  });

  it("rejects claims that the extractor invents outside the answer text", async () => {
    const result = await extractOriginMaterialClaims(
      "The service has a free tier.",
      vi.fn().mockImplementation(async (request) => ({
        answerDigest: request.answerDigest,
        claims: [{
          id: "claim-a",
          text: "The service includes unlimited storage.",
          kind: "factual",
          freshness: "current",
          evidenceRequirement: "supporting-evidence",
          risk: "medium",
        }],
        actualCostUsd: 0,
        attempts: 1,
      })),
    );

    expect(result).toEqual({
      ok: false,
      code: "CLAIM_EXTRACTION_RECORD_MISMATCH",
    });
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
  it("preserves allowlisted provider failure codes without leaking arbitrary messages", async () => {
    await expect(extractOriginMaterialClaims(
      "A factual answer.",
      vi.fn().mockRejectedValue({ code: "PROVIDER_RATE_LIMITED", message: "secret" }),
    )).resolves.toEqual({
      ok: false,
      code: "AQ_BENCHMARK_EVALUATOR_PROVIDER_RATE_LIMITED",
    });

    await expect(extractOriginMaterialClaims(
      "A factual answer.",
      vi.fn().mockRejectedValue(new Error("secret provider body")),
    )).resolves.toEqual({ ok: false, code: "CLAIM_EXTRACTION_FAILED" });
  });

});
