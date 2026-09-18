import { describe, expect, it } from "vitest";

import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof";
import { createOriginAnswerQualityBenchmarkRuntimeAdapter } from "./OriginAnswerQualityBenchmarkRuntimeAdapter";
import type { OriginAnswerQualityBenchmarkCaseExecutor } from "./OriginAnswerQualityBenchmarkRunner";
import {
  runOriginAnswerQualityBenchmarkExecutionSession,
  scoreOriginAnswerQualityBenchmarkExecutionSession,
} from "./OriginAnswerQualityBenchmarkTwoPhaseSession";

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

const environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof = {
  schemaVersion: "origin.aq-benchmark-environment-proof.v1",
  baseUrl: "https://candidate.example/",
  expectedGitSha: "a".repeat(40),
  observedReleaseSha: "a".repeat(40),
  freeOnly: true,
  costUsd: 0,
  paidFallbackEnabled: false,
  runtimeIds: {
    research: "grounded-research-v1.1",
    coding: "coding-v1.4",
    artifact: "artifact-v1.2",
  },
  codingReady: true,
};

const adapters = {
  research: createOriginAnswerQualityBenchmarkRuntimeAdapter("research", "grounded-research-v1.1", executor),
  chat: createOriginAnswerQualityBenchmarkRuntimeAdapter("chat", "origin-chat", executor),
  coding: createOriginAnswerQualityBenchmarkRuntimeAdapter("coding", "coding-v1.4", executor),
  artifact: createOriginAnswerQualityBenchmarkRuntimeAdapter("artifact", "artifact-v1.2", executor),
};

function scoringEvidence(
  item: Parameters<NonNullable<Parameters<typeof scoreOriginAnswerQualityBenchmarkExecutionSession>[0]["collectScoringEvidence"]>>[0],
  execution: Parameters<NonNullable<Parameters<typeof scoreOriginAnswerQualityBenchmarkExecutionSession>[0]["collectScoringEvidence"]>>[1],
) {
  return {
    caseId: item.caseId,
    category: item.category,
    finalAnswerRef: execution.finalAnswerRef,
    evidenceLedgerRef: execution.evidenceLedgerRef,
    totalMaterialClaims: 1,
    supportedMaterialClaims: 1,
    totalRenderedCitations: item.category === "current-factual" ? 1 : 0,
    supportingRenderedCitations: item.category === "current-factual" ? 1 : 0,
    citationsRequired: item.category === "current-factual",
    materialContradictionsPresent: item.category === "contradiction-detection" ? 1 : 0,
    materialContradictionsSurfaced: item.category === "contradiction-detection" ? 1 : 0,
    deliverableCompleted: true,
    verifierRejectedUnsupportedClaim: true,
    repairRequired: item.category === "coding-repair",
    repairSucceeded: item.category === "coding-repair" ? true : undefined,
    verificationIntegrityAccurate: true,
    failClosedDesigned: item.category === "fail-closed",
    failClosedCorrect: item.category === "fail-closed" ? true : undefined,
    userActionabilityScore: 3 as const,
  };
}

describe("OriginAnswerQualityBenchmarkTwoPhaseSession", () => {
  it("freezes all forty executions before the scorer is introduced", async () => {
    let now = 1_789_761_600_000;
    const frozen = await runOriginAnswerQualityBenchmarkExecutionSession({
      runId: "aq-two-phase-1",
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      environmentProof,
      executors: adapters,
      nowMs: () => {
        const value = now;
        now += 1_000;
        return value;
      },
    });

    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(frozen.value.execution.executedCases).toHaveLength(40);
    expect(frozen.value.execution.executionOnlyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(frozen.value.executionSessionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    let scoreCalls = 0;
    const scored = await scoreOriginAnswerQualityBenchmarkExecutionSession({
      frozen: frozen.value,
      collectScoringEvidence: async (item, execution) => {
        scoreCalls += 1;
        return scoringEvidence(item, execution);
      },
    });

    expect(scored.ok).toBe(true);
    expect(scoreCalls).toBe(40);
    if (!scored.ok) return;
    expect(scored.value.measuredRun.boundRun.caseCount).toBe(40);
  });

  it("rejects frozen execution tampering before any scorer call", async () => {
    const frozen = await runOriginAnswerQualityBenchmarkExecutionSession({
      runId: "aq-two-phase-tamper",
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      environmentProof,
      executors: adapters,
      nowMs: (() => {
        let now = 1_789_761_600_000;
        return () => (now += 1_000);
      })(),
    });
    if (!frozen.ok) throw new Error("frozen fixture failed");

    const tampered = {
      ...frozen.value,
      execution: {
        ...frozen.value.execution,
        executedCases: frozen.value.execution.executedCases.map((item, index) =>
          index === 0
            ? { ...item, execution: { ...item.execution, finalAnswerRef: "answer:tampered" } }
            : item
        ),
      },
    };

    let scoreCalls = 0;
    const result = await scoreOriginAnswerQualityBenchmarkExecutionSession({
      frozen: tampered,
      collectScoringEvidence: async (item, execution) => {
        scoreCalls += 1;
        return scoringEvidence(item, execution);
      },
    });

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_FROZEN_EXECUTION_INVALID" });
    expect(scoreCalls).toBe(0);
  });

  it("refuses to execute when environment proof is for another SHA", async () => {
    const result = await runOriginAnswerQualityBenchmarkExecutionSession({
      runId: "aq-two-phase-sha",
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      environmentProof: {
        ...environmentProof,
        expectedGitSha: "b".repeat(40),
        observedReleaseSha: "b".repeat(40),
      },
      executors: adapters,
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SESSION_ENVIRONMENT_PROOF_INVALID",
    });
  });

  it("fails the execution phase on non-zero cost before scoring exists", async () => {
    const paid: OriginAnswerQualityBenchmarkCaseExecutor = async (item) => ({
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

    const result = await runOriginAnswerQualityBenchmarkExecutionSession({
      runId: "aq-two-phase-paid",
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      environmentProof,
      executors: {
        ...adapters,
        coding: createOriginAnswerQualityBenchmarkRuntimeAdapter("coding", "coding-v1.4", paid),
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AQ_BENCHMARK_SESSION_EXECUTION_FAILED");
  });
});
