import { describe, expect, it, vi } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import { bindOriginAnswerQualityMeasuredObservations } from "./OriginAnswerQualityBenchmarkMeasuredRunBinding";
import { bindOriginAnswerQualityBenchmarkRun } from "./OriginAnswerQualityBenchmarkRunBinding";
import { createOriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance";
import { runOriginAnswerQualityBenchmark } from "./OriginAnswerQualityBenchmarkRunner";
import { createOriginAnswerQualityBenchmarkShardCorpus } from "./OriginAnswerQualityBenchmarkShardCorpus";
import {
  runOriginAnswerQualityOfficialShardComparison,
} from "./OriginAnswerQualityOfficialShardComparison";
import type {
  OriginAnswerQualityOfficialBenchmarkSessionSuccess,
} from "./OriginAnswerQualityOfficialBenchmarkSession";

const full = createOriginAnswerQualityFrozenCorpus();
const caseIds = [full.cases[0].caseId, full.cases[4].caseId];
const shardCorpusResult = createOriginAnswerQualityBenchmarkShardCorpus(full, caseIds);
if (!shardCorpusResult.ok) throw new Error("shard corpus fixture failed");
const shardCorpus = shardCorpusResult.value;

async function session(
  gitSha: string,
  runId: string,
  scorerRevision = `sha256:${"c".repeat(64)}`,
): Promise<OriginAnswerQualityOfficialBenchmarkSessionSuccess> {
  const execution = await runOriginAnswerQualityBenchmark({
    manifest: shardCorpus.manifest,
    cases: shardCorpus.cases,
    execute: async (item) => ({
      caseId: item.caseId,
      finalAnswerRef: `sha256:${"1".repeat(64)}`,
      evidenceLedgerRef: `sha256:${"2".repeat(64)}`,
      verifierResult: "PASS",
      providerRequests: 0,
      toolCalls: 1,
      latencyMs: 100,
      costUsd: 0,
      failureCode: null,
    }),
    score: async (item, evidence) => ({
      caseId: item.caseId,
      category: item.category,
      factualSupportScore: 0.8,
      citationPrecisionScore: 0.8,
      taskCompletionScore: 1,
      contradictionDetectionScore: 1,
      verifierRejectedUnsupportedClaim: false,
      repairSucceeded: item.category === "coding-repair" ? true : undefined,
      providerRequests: evidence.providerRequests,
      latencyMs: evidence.latencyMs,
      costUsd: 0,
      unsupportedMaterialClaimCount: 0,
    }),
  });
  if (!execution.ok) throw new Error("execution fixture failed");

  const provenance = createOriginAnswerQualityBenchmarkRunProvenance({
    runId,
    gitSha,
    manifestDigest: shardCorpus.manifest.manifestDigest,
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: "2026-09-19T00:00:00.000Z",
    completedAt: "2026-09-19T00:10:00.000Z",
  }, shardCorpus.manifest);
  if (!provenance.ok) throw new Error("provenance fixture failed");

  const bound = bindOriginAnswerQualityBenchmarkRun(provenance.value, execution.value);
  if (!bound.ok) throw new Error("bound fixture failed");
  const measured = bindOriginAnswerQualityMeasuredObservations(
    bound.value,
    bound.value.scoredCases.map((item) => ({
      ...item.observation,
      verificationIntegrityAccurate: true,
      failClosedCorrect: item.observation.category === "fail-closed" ? true : undefined,
      userActionabilityScore: 3 as const,
    })),
  );
  if (!measured.ok) throw new Error("measured fixture failed");

  return {
    schemaVersion: "origin.aq-benchmark-session.v1",
    corpus: shardCorpus,
    measuredRun: measured.value,
    scorerProvenance: {
      schemaVersion: "origin.aq-benchmark-scorer.v1",
      scorerId: "origin-aq-public-deterministic-v1",
      scorerRevision,
      corpusId: "aq-post-heldout-public",
      corpusVersion: "v1",
    },
    scorerProvenanceDigest: scorerRevision,
  };
}

function proof(
  baseUrl: string,
  gitSha: string,
  requiredLanes: readonly ("research" | "chat" | "coding" | "artifact")[],
) {
  const runtimeIds = Object.fromEntries(
    requiredLanes.map((lane) => [
      lane,
      lane === "research"
        ? "grounded-research-v1.1"
        : lane === "coding"
          ? "coding-v1.4"
          : lane === "artifact"
            ? "artifact-v1.2"
            : "origin-chat",
    ]),
  );
  return {
    ok: true as const,
    value: {
      schemaVersion: "origin.aq-benchmark-scoped-environment-proof.v1" as const,
      baseUrl,
      expectedGitSha: gitSha,
      observedReleaseSha: gitSha,
      freeOnly: true as const,
      costUsd: 0 as const,
      paidFallbackEnabled: false as const,
      requiredLanes,
      runtimeIds,
    },
  };
}

function input() {
  return {
    fullCorpus: full,
    shard: {
      shardIndex: 0,
      caseIds,
      pairedRequestsMax: 16,
    },
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    baseline: {
      runId: "baseline-shard-0",
      gitSha: "a".repeat(40),
      baseUrl: "http://127.0.0.1:4101/",
      sourceRoot: "/tmp/baseline",
    },
    candidate: {
      runId: "candidate-shard-0",
      gitSha: "b".repeat(40),
      baseUrl: "http://127.0.0.1:4102/",
      sourceRoot: "/tmp/candidate",
    },
  };
}

describe("OriginAnswerQualityOfficialShardComparison", () => {
  it("runs the same exact subset for baseline and candidate and emits content-free measurements", async () => {
    const calls: Array<{ runId: string; ids: string[] }> = [];
    const result = await runOriginAnswerQualityOfficialShardComparison(input(), {
      probeEnvironment: vi.fn(async (
        baseUrl: string,
        gitSha: string,
        requiredLanes: readonly ("research" | "chat" | "coding" | "artifact")[],
      ) => proof(baseUrl, gitSha, requiredLanes)),
      runSession: vi.fn(async (value) => {
        calls.push({
          runId: value.runId,
          ids: value.corpus?.cases.map((item) => item.caseId) ?? [],
        });
        return { ok: true as const, value: await session(value.gitSha, value.runId) };
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toEqual([
      { runId: "baseline-shard-0", ids: caseIds },
      { runId: "candidate-shard-0", ids: caseIds },
    ]);
    expect(result.value.caseIds).toEqual(caseIds);
    expect(result.value.baselineObservations).toHaveLength(2);
    expect(result.value.candidateObservations).toHaveLength(2);
    expect(result.value.baselineEvaluatorRequests).toBe(0);
    expect(result.value.candidateEvaluatorRequests).toBe(0);
    expect(result.value.shardDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    const persisted = JSON.stringify(result.value);
    expect(persisted).not.toContain(full.cases[0].prompt);
    expect(persisted).not.toContain("answerText");
    expect(persisted).not.toContain("evidenceJson");
  });

  it("stops before candidate when baseline scoring fails", async () => {
    let calls = 0;
    const result = await runOriginAnswerQualityOfficialShardComparison(input(), {
      probeEnvironment: vi.fn(async (
        baseUrl: string,
        gitSha: string,
        requiredLanes: readonly ("research" | "chat" | "coding" | "artifact")[],
      ) => proof(baseUrl, gitSha, requiredLanes)),
      runSession: vi.fn(async () => {
        calls += 1;
        return {
          ok: false as const,
          code: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED" as const,
          detail: "scorer unavailable",
        };
      }),
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SHARD_BASELINE_SESSION_FAILED",
      detail: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED:scorer unavailable",
      plannedPairedRequestsMax: 16,
      baselineEvaluatorRequests: 0,
      candidateEvaluatorRequests: 0,
      evaluatorRequestsTotal: 0,
    });
    expect(calls).toBe(1);
  });

  it("rejects scorer revision drift across the paired shard", async () => {
    let calls = 0;
    const result = await runOriginAnswerQualityOfficialShardComparison(input(), {
      probeEnvironment: vi.fn(async (
        baseUrl: string,
        gitSha: string,
        requiredLanes: readonly ("research" | "chat" | "coding" | "artifact")[],
      ) => proof(baseUrl, gitSha, requiredLanes)),
      runSession: vi.fn(async (value) => {
        calls += 1;
        return {
          ok: true as const,
          value: await session(
            value.gitSha,
            value.runId,
            calls === 1
              ? `sha256:${"c".repeat(64)}`
              : `sha256:${"d".repeat(64)}`,
          ),
        };
      }),
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SHARD_SCORER_MISMATCH",
    });
  });

  it("rejects shard budgets above the free daily ceiling before probing", async () => {
    const probeEnvironment = vi.fn();
    const runSession = vi.fn();

    const result = await runOriginAnswerQualityOfficialShardComparison({
      ...input(),
      shard: {
        shardIndex: 0,
        caseIds,
        pairedRequestsMax: 51,
      },
    }, { probeEnvironment, runSession });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SHARD_COMPARISON_INVALID_INPUT",
    });
    expect(probeEnvironment).not.toHaveBeenCalled();
    expect(runSession).not.toHaveBeenCalled();
  });

  it("hard-stops evaluator requests before exceeding the shard scorer budget", async () => {
    let baselineCalls = 0;
    let candidateCalls = 0;

    const result = await runOriginAnswerQualityOfficialShardComparison(input(), {
      probeEnvironment: vi.fn(async (
        baseUrl: string,
        gitSha: string,
        requiredLanes: readonly ("research" | "chat" | "coding" | "artifact")[],
      ) => proof(baseUrl, gitSha, requiredLanes)),
      runSession: vi.fn(async (value) => {
        const hook = value.beforeEvaluatorRequest;
        if (value.runId.startsWith("baseline")) {
          try {
            for (let index = 0; index < 9; index += 1) {
              hook?.();
              baselineCalls += 1;
            }
          } catch (error) {
            return {
              ok: false as const,
              code: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED" as const,
              detail: error instanceof Error ? error.message : "AQ_BENCHMARK_SHARD_EVALUATOR_BUDGET_EXCEEDED",
            };
          }
        } else {
          candidateCalls += 1;
        }
        return { ok: true as const, value: await session(value.gitSha, value.runId) };
      }),
    });

    expect(result.ok).toBe(false);
    expect(baselineCalls).toBe(8);
    expect(candidateCalls).toBe(0);
    if (result.ok === true) return;
    expect(result.code).toBe("AQ_BENCHMARK_SHARD_BASELINE_SESSION_FAILED");
    expect(result.detail).toContain("AQ_BENCHMARK_SHARD_EVALUATOR_BUDGET_EXCEEDED");
    expect(result.plannedPairedRequestsMax).toBe(16);
    expect(result.baselineEvaluatorRequests).toBe(8);
    expect(result.candidateEvaluatorRequests).toBe(0);
    expect(result.evaluatorRequestsTotal).toBe(8);
  });
});
