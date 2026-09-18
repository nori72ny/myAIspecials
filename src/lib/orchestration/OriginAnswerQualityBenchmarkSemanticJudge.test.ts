import { describe, expect, it, vi } from "vitest";

import { judgeOriginAnswerQualityBenchmarkSemantics } from "./OriginAnswerQualityBenchmarkSemanticJudge";

describe("OriginAnswerQualityBenchmarkSemanticJudge", () => {
  it("accepts only case/prompt/answer digest-bound zero-cost one-attempt judgments", async () => {
    const judge = vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      category: request.category,
      promptDigest: request.promptDigest,
      answerDigest: request.answerDigest,
      deliverableCompleted: true,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      verificationIntegrityAccurate: true,
      userActionabilityScore: 3,
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await judgeOriginAnswerQualityBenchmarkSemantics({
      caseId: "case-1",
      category: "professional-advice",
      prompt: "Give an actionable recommendation.",
      answerText: "Recommendation with trade-offs and next steps.",
    }, judge);

    expect(result.ok).toBe(true);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0][0].executionPolicy).toEqual({
      maxCostUsd: 0,
      maxAttempts: 1,
    });
  });

  it("rejects mismatched answer digest and paid records", async () => {
    const mismatch = await judgeOriginAnswerQualityBenchmarkSemantics({
      caseId: "case-1",
      category: "professional-advice",
      prompt: "Prompt",
      answerText: "Answer",
    }, vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      category: request.category,
      promptDigest: request.promptDigest,
      answerDigest: `sha256:${"f".repeat(64)}`,
      deliverableCompleted: true,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      verificationIntegrityAccurate: true,
      userActionabilityScore: 2,
      actualCostUsd: 0,
      attempts: 1,
    })));

    expect(mismatch).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SEMANTIC_JUDGE_RECORD_MISMATCH",
    });

    const paid = await judgeOriginAnswerQualityBenchmarkSemantics({
      caseId: "case-1",
      category: "professional-advice",
      prompt: "Prompt",
      answerText: "Answer",
    }, vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      category: request.category,
      promptDigest: request.promptDigest,
      answerDigest: request.answerDigest,
      deliverableCompleted: true,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      verificationIntegrityAccurate: true,
      userActionabilityScore: 2,
      actualCostUsd: 0.01,
      attempts: 1,
    })));

    expect(paid).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SEMANTIC_JUDGE_COST_UNVERIFIED",
    });
  });

  it("requires fail-closed correctness only for the fail-closed family", async () => {
    const withoutFlag = await judgeOriginAnswerQualityBenchmarkSemantics({
      caseId: "case-fail",
      category: "fail-closed",
      prompt: "Do not fabricate unavailable current data.",
      answerText: "The current value is unverified; here is how to check it.",
    }, vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      category: request.category,
      promptDigest: request.promptDigest,
      answerDigest: request.answerDigest,
      deliverableCompleted: true,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      verificationIntegrityAccurate: true,
      userActionabilityScore: 3,
      actualCostUsd: 0,
      attempts: 1,
    })));

    expect(withoutFlag).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SEMANTIC_JUDGE_INVALID_SCORE",
    });

    const extraFlag = await judgeOriginAnswerQualityBenchmarkSemantics({
      caseId: "case-normal",
      category: "professional-advice",
      prompt: "Advise me.",
      answerText: "Actionable advice.",
    }, vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      category: request.category,
      promptDigest: request.promptDigest,
      answerDigest: request.answerDigest,
      deliverableCompleted: true,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      verificationIntegrityAccurate: true,
      failClosedCorrect: true,
      userActionabilityScore: 3,
      actualCostUsd: 0,
      attempts: 1,
    })));

    expect(extraFlag).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SEMANTIC_JUDGE_INVALID_SCORE",
    });
  });

  it("rejects impossible contradiction and actionability scores", async () => {
    const result = await judgeOriginAnswerQualityBenchmarkSemantics({
      caseId: "case-conflict",
      category: "contradiction-detection",
      prompt: "Find the contradiction.",
      answerText: "There is a conflict.",
    }, vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      category: request.category,
      promptDigest: request.promptDigest,
      answerDigest: request.answerDigest,
      deliverableCompleted: true,
      materialContradictionsPresent: 1,
      materialContradictionsSurfaced: 2,
      verificationIntegrityAccurate: true,
      userActionabilityScore: 4,
      actualCostUsd: 0,
      attempts: 1,
    })));

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SEMANTIC_JUDGE_INVALID_SCORE",
    });
  });

  it("fails closed if no judge is configured", async () => {
    await expect(judgeOriginAnswerQualityBenchmarkSemantics({
      caseId: "case-1",
      category: "professional-advice",
      prompt: "Prompt",
      answerText: "Answer",
    })).resolves.toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SEMANTIC_JUDGE_NOT_AVAILABLE",
    });
  });
});
