import { describe, expect, it, vi } from "vitest";

import { createOriginClaimSet } from "./OriginClaimModel";
import { judgeOriginAnswerQualityClaimsAgainstPrompt } from "./OriginAnswerQualityBenchmarkPromptClaimJudge";

function claims() {
  const result = createOriginClaimSet([
    {
      id: "claim-a",
      text: "The retained count is 10.",
      kind: "factual",
      freshness: "stable",
      evidenceRequirement: "user-provided",
      risk: "low",
    },
    {
      id: "claim-b",
      text: "Use a staged rollout.",
      kind: "recommendation",
      freshness: "not-applicable",
      evidenceRequirement: "none",
      risk: "low",
    },
  ]);
  if (!result.ok) throw new Error("claim fixture failed");
  return result.value;
}

describe("OriginAnswerQualityBenchmarkPromptClaimJudge", () => {
  it("binds supported factual claim IDs to prompt and claim-set digests", async () => {
    const judge = vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      rubricVersion: request.rubricVersion,
      promptDigest: request.promptDigest,
      claimSetDigest: request.claimSetDigest,
      supportedClaimIds: ["claim-a"],
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await judgeOriginAnswerQualityClaimsAgainstPrompt({
      caseId: "case-1",
      prompt: "12 features shipped and 2 were rolled back.",
      claimSet: claims(),
    }, judge);

    expect(result.ok).toBe(true);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0][0].claims).toEqual([
      { id: "claim-a", text: "The retained count is 10." },
    ]);
    expect(judge.mock.calls[0][0].executionPolicy).toEqual({
      maxCostUsd: 0,
      maxAttempts: 1,
    });
  });

  it("rejects unknown or duplicate supported claim IDs", async () => {
    for (const supportedClaimIds of [["claim-x"], ["claim-a", "claim-a"]]) {
      const result = await judgeOriginAnswerQualityClaimsAgainstPrompt({
        caseId: "case-1",
        prompt: "Prompt evidence.",
        claimSet: claims(),
      }, vi.fn().mockImplementation(async (request) => ({
        caseId: request.caseId,
        rubricVersion: request.rubricVersion,
        promptDigest: request.promptDigest,
        claimSetDigest: request.claimSetDigest,
        supportedClaimIds,
        actualCostUsd: 0,
        attempts: 1,
      })));

      expect(result).toEqual({
        ok: false,
        code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_RECORD_MISMATCH",
      });
    }
  });

  it("rejects digest drift and non-zero judge cost", async () => {
    const mismatch = await judgeOriginAnswerQualityClaimsAgainstPrompt({
      caseId: "case-1",
      prompt: "Prompt evidence.",
      claimSet: claims(),
    }, vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      rubricVersion: request.rubricVersion,
      promptDigest: `sha256:${"f".repeat(64)}`,
      claimSetDigest: request.claimSetDigest,
      supportedClaimIds: [],
      actualCostUsd: 0,
      attempts: 1,
    })));

    expect(mismatch).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_RECORD_MISMATCH",
    });

    const paid = await judgeOriginAnswerQualityClaimsAgainstPrompt({
      caseId: "case-1",
      prompt: "Prompt evidence.",
      claimSet: claims(),
    }, vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      rubricVersion: request.rubricVersion,
      promptDigest: request.promptDigest,
      claimSetDigest: request.claimSetDigest,
      supportedClaimIds: [],
      actualCostUsd: 0.01,
      attempts: 1,
    })));

    expect(paid).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_COST_UNVERIFIED",
    });
  });

  it("fails closed when the judge is unavailable", async () => {
    await expect(judgeOriginAnswerQualityClaimsAgainstPrompt({
      caseId: "case-1",
      prompt: "Prompt evidence.",
      claimSet: claims(),
    })).resolves.toEqual({
      ok: false,
      code: "AQ_BENCHMARK_PROMPT_CLAIM_JUDGE_NOT_AVAILABLE",
    });
  });
});
