import { describe, expect, it } from "vitest";

import { runOriginAnswerQualityBenchmarkSession } from "./OriginAnswerQualityBenchmarkSession";
import type { OriginAnswerQualityBenchmarkCaseExecutor } from "./OriginAnswerQualityBenchmarkRunner";

const executor: OriginAnswerQualityBenchmarkCaseExecutor = async (item) => ({
  caseId: item.caseId,
  finalAnswerRef: `answer:${item.caseId}`,
  evidenceLedgerRef: `ledger:${item.caseId}`,
  verifierResult: "PASS",
  providerRequests: 1,
  toolCalls: 1,
  latencyMs: 50,
  costUsd: 0,
  failureCode: null,
});

describe("OriginAnswerQualityBenchmarkSession", () => {
  it("runs the frozen forty-case corpus into one measured bound session", async () => {
    let now = 1_789_761_600_000;
    const result = await runOriginAnswerQualityBenchmarkSession({
      runId: "aq-session-1",
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      executors: {
        research: executor,
        chat: executor,
        coding: executor,
        artifact: executor,
      },
      score: async (item, evidence) => ({
        caseId: item.caseId,
        category: item.category,
        factualSupportScore: 1,
        citationPrecisionScore: 1,
        taskCompletionScore: 1,
        contradictionDetectionScore: 1,
        verifierRejectedUnsupportedClaim: true,
        repairSucceeded: item.category === "coding-repair" ? true : undefined,
        providerRequests: evidence.providerRequests,
        latencyMs: evidence.latencyMs,
        costUsd: evidence.costUsd,
        unsupportedMaterialClaimCount: 0,
        verificationIntegrityAccurate: true,
        failClosedCorrect: item.category === "fail-closed" ? true : undefined,
        userActionabilityScore: 3,
      }),
      nowMs: () => {
        const value = now;
        now += 1000;
        return value;
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.corpus.cases).toHaveLength(40);
    expect(result.value.measuredRun.boundRun.caseCount).toBe(40);
    expect(result.value.measuredRun.boundRun.totalProviderRequests).toBe(40);
    expect(result.value.measuredRun.measuredObservations).toHaveLength(40);
  });

  it("refuses to start before all four execution lanes are configured", async () => {
    const result = await runOriginAnswerQualityBenchmarkSession({
      runId: "aq-session-2",
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      executors: {
        research: executor,
        chat: executor,
      },
      score: async () => {
        throw new Error("must not score");
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AQ_BENCHMARK_SESSION_RUNTIME_NOT_READY");
    expect(result.detail).toContain("coding,artifact");
  });

  it("fails closed if any lane reports non-zero cost", async () => {
    const paidCoding: OriginAnswerQualityBenchmarkCaseExecutor = async (item) => ({
      caseId: item.caseId,
      finalAnswerRef: "answer",
      evidenceLedgerRef: null,
      verifierResult: "PASS",
      providerRequests: 1,
      toolCalls: 1,
      latencyMs: 10,
      costUsd: 0.01,
      failureCode: null,
    });

    const result = await runOriginAnswerQualityBenchmarkSession({
      runId: "aq-session-3",
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      executors: {
        research: executor,
        chat: executor,
        coding: paidCoding,
        artifact: executor,
      },
      score: async (item, evidence) => ({
        caseId: item.caseId,
        category: item.category,
        factualSupportScore: 1,
        citationPrecisionScore: 1,
        taskCompletionScore: 1,
        contradictionDetectionScore: 1,
        verifierRejectedUnsupportedClaim: true,
        providerRequests: evidence.providerRequests,
        latencyMs: evidence.latencyMs,
        costUsd: evidence.costUsd,
        unsupportedMaterialClaimCount: 0,
        verificationIntegrityAccurate: true,
        userActionabilityScore: 3,
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AQ_BENCHMARK_SESSION_EXECUTION_FAILED");
  });
});
