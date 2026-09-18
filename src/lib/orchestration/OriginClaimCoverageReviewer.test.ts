import { describe, expect, it, vi } from "vitest";

import { createOriginClaimSet } from "./OriginClaimModel";
import { reviewOriginMaterialClaimCoverage } from "./OriginClaimCoverageReviewer";

const answer = "The current version is 2.0. The test suite passed.";
const claimsResult = createOriginClaimSet([
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
]);
if (!claimsResult.ok) throw new Error("invalid fixture");
const claims = claimsResult.value;

const extractorExecution = {
  executionId: "origin-extract-1",
  modelId: "extractor/free-model:free",
};

describe("OriginClaimCoverageReviewer", () => {
  it("accepts complete coverage only from a distinct zero-cost reviewer", async () => {
    const reviewer = vi.fn(async (request) => ({
      answerDigest: request.answerDigest,
      claimSetDigest: request.claimSetDigest,
      coverage: "complete",
      missingClaimSpans: [],
      reviewerExecution: {
        executionId: "origin-coverage-1",
        modelId: "reviewer/free-model:free",
      },
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await reviewOriginMaterialClaimCoverage(
      answer,
      claims,
      extractorExecution,
      reviewer,
    );
    expect(result.ok).toBe(true);
    expect(reviewer).toHaveBeenCalledTimes(1);
  });

  it("rejects self-review by the extractor execution or model", async () => {
    const sameModel = vi.fn(async (request) => ({
      answerDigest: request.answerDigest,
      claimSetDigest: request.claimSetDigest,
      coverage: "complete",
      missingClaimSpans: [],
      reviewerExecution: {
        executionId: "origin-coverage-2",
        modelId: extractorExecution.modelId,
      },
      actualCostUsd: 0,
      attempts: 1,
    }));

    await expect(reviewOriginMaterialClaimCoverage(
      answer,
      claims,
      extractorExecution,
      sameModel,
    )).resolves.toEqual({
      ok: false,
      code: "CLAIM_COVERAGE_IDENTITY_UNVERIFIED",
    });
  });

  it("fails closed and returns real missing spans when coverage is incomplete", async () => {
    const partialClaimsResult = createOriginClaimSet([claims.claims[0]]);
    if (!partialClaimsResult.ok) throw new Error("invalid fixture");

    const reviewer = vi.fn(async (request) => ({
      answerDigest: request.answerDigest,
      claimSetDigest: request.claimSetDigest,
      coverage: "incomplete",
      missingClaimSpans: ["The test suite passed."],
      reviewerExecution: {
        executionId: "origin-coverage-3",
        modelId: "reviewer/free-model:free",
      },
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await reviewOriginMaterialClaimCoverage(
      answer,
      partialClaimsResult.value,
      extractorExecution,
      reviewer,
    );

    expect(result).toEqual({
      ok: false,
      code: "CLAIM_COVERAGE_INCOMPLETE",
      missingClaimSpans: ["The test suite passed."],
    });
  });

  it("rejects fabricated missing spans and paid review", async () => {
    const fabricated = vi.fn(async (request) => ({
      answerDigest: request.answerDigest,
      claimSetDigest: request.claimSetDigest,
      coverage: "incomplete",
      missingClaimSpans: ["This sentence is not in the answer."],
      reviewerExecution: {
        executionId: "origin-coverage-4",
        modelId: "reviewer/free-model:free",
      },
      actualCostUsd: 0,
      attempts: 1,
    }));

    await expect(reviewOriginMaterialClaimCoverage(
      answer,
      claims,
      extractorExecution,
      fabricated,
    )).resolves.toEqual({
      ok: false,
      code: "CLAIM_COVERAGE_RECORD_MISMATCH",
    });

    const paid = vi.fn(async (request) => ({
      answerDigest: request.answerDigest,
      claimSetDigest: request.claimSetDigest,
      coverage: "complete",
      missingClaimSpans: [],
      reviewerExecution: {
        executionId: "origin-coverage-5",
        modelId: "reviewer/free-model:free",
      },
      actualCostUsd: 0.01,
      attempts: 1,
    }));

    await expect(reviewOriginMaterialClaimCoverage(
      answer,
      claims,
      extractorExecution,
      paid,
    )).resolves.toEqual({
      ok: false,
      code: "CLAIM_COVERAGE_COST_UNVERIFIED",
    });
  });
});
