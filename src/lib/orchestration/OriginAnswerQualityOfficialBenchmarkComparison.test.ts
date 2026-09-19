import { describe, expect, it, vi } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import { bindOriginAnswerQualityMeasuredObservations } from "./OriginAnswerQualityBenchmarkMeasuredRunBinding";
import { bindOriginAnswerQualityBenchmarkRun } from "./OriginAnswerQualityBenchmarkRunBinding";
import { createOriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance";
import { runOriginAnswerQualityBenchmark } from "./OriginAnswerQualityBenchmarkRunner";
import {
  runOriginAnswerQualityOfficialComparisonHarness,
} from "./OriginAnswerQualityOfficialBenchmarkComparison";
import type {
  OriginAnswerQualityOfficialBenchmarkSessionSuccess,
} from "./OriginAnswerQualityOfficialBenchmarkSession";

async function session(
  gitSha: string,
  runId: string,
): Promise<OriginAnswerQualityOfficialBenchmarkSessionSuccess> {
  const corpus = createOriginAnswerQualityFrozenCorpus();
  const execution = await runOriginAnswerQualityBenchmark({
    manifest: corpus.manifest,
    cases: corpus.cases,
    execute: async (item) => ({
      caseId: item.caseId,
      finalAnswerRef: `answer:${item.caseId}`,
      evidenceLedgerRef: `ledger:${item.caseId}`,
      verifierResult: "PASS",
      providerRequests: 1,
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
      taskCompletionScore: 0.8,
      contradictionDetectionScore: 0.8,
      verifierRejectedUnsupportedClaim: true,
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
    manifestDigest: corpus.manifest.manifestDigest,
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: "2026-09-19T00:00:00.000Z",
    completedAt: "2026-09-19T00:10:00.000Z",
  }, corpus.manifest);
  if (!provenance.ok) throw new Error("provenance fixture failed");

  const bound = bindOriginAnswerQualityBenchmarkRun(provenance.value, execution.value);
  if (!bound.ok) throw new Error("bound fixture failed");

  const measured = bindOriginAnswerQualityMeasuredObservations(
    bound.value,
    bound.value.scoredCases.map((item) => ({
      ...item.observation,
      verificationIntegrityAccurate: true,
      failClosedCorrect: item.observation.category === "fail-closed" ? true : undefined,
      userActionabilityScore: 2 as const,
    })),
  );
  if (!measured.ok) throw new Error("measured fixture failed");

  return {
    schemaVersion: "origin.aq-benchmark-session.v1",
    corpus,
    measuredRun: measured.value,
    scorerProvenance: {
      schemaVersion: "origin.aq-benchmark-scorer.v1",
      scorerId: "origin-aq-public-deterministic-v1",
      scorerRevision: `sha256:${"c".repeat(64)}`,
      corpusId: "aq-post-heldout-public",
      corpusVersion: "v1",
    },
    scorerProvenanceDigest: `sha256:${"d".repeat(64)}`,
  };
}

function input() {
  return {
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    baseline: {
      runId: "baseline-run",
      gitSha: "a".repeat(40),
      baseUrl: "http://127.0.0.1:4101/",
      sourceRoot: "/tmp/baseline",
    },
    candidate: {
      runId: "candidate-run",
      gitSha: "b".repeat(40),
      baseUrl: "http://127.0.0.1:4102/",
      sourceRoot: "/tmp/candidate",
    },
  };
}

describe("OriginAnswerQualityOfficialBenchmarkComparison", () => {
  it("probes both exact SHAs, runs baseline then candidate, and builds one sealed comparison", async () => {
    const calls: string[] = [];
    const probeEnvironment = vi.fn(async (baseUrl: string, gitSha: string) => ({
      ok: true as const,
      value: {
        schemaVersion: "origin.aq-benchmark-environment-proof.v1" as const,
        baseUrl,
        expectedGitSha: gitSha,
        observedReleaseSha: gitSha,
        freeOnly: true as const,
        costUsd: 0 as const,
        paidFallbackEnabled: false as const,
        runtimeIds: {
          research: "grounded-research-v1.1" as const,
          coding: "coding-v1.4" as const,
          artifact: "artifact-v1.2" as const,
        },
        codingReady: true as const,
      },
    }));
    const runSession = vi.fn(async (value: { gitSha: string; runId: string }) => {
      calls.push(value.runId);
      return { ok: true as const, value: await session(value.gitSha, value.runId) };
    });

    const result = await runOriginAnswerQualityOfficialComparisonHarness(
      input(),
      { probeEnvironment, runSession },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toEqual(["baseline-run", "candidate-run"]);
    expect(probeEnvironment).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:4101/",
      "a".repeat(40),
      undefined,
    );
    expect(probeEnvironment).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:4102/",
      "b".repeat(40),
      undefined,
    );
    expect(result.value.evaluation.officialBundleDigest)
      .toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects changing provider or model identity between compared runs by construction", async () => {
    const value = input();
    const runSession = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID" });

    await runOriginAnswerQualityOfficialComparisonHarness(
      value,
      {
        probeEnvironment: vi.fn(async (baseUrl: string, gitSha: string) => ({
          ok: true as const,
          value: {
            schemaVersion: "origin.aq-benchmark-environment-proof.v1" as const,
            baseUrl,
            expectedGitSha: gitSha,
            observedReleaseSha: gitSha,
            freeOnly: true as const,
            costUsd: 0 as const,
            paidFallbackEnabled: false as const,
            runtimeIds: {
              research: "grounded-research-v1.1" as const,
              coding: "coding-v1.4" as const,
              artifact: "artifact-v1.2" as const,
            },
            codingReady: true as const,
          },
        })),
        runSession,
      },
    );

    expect(runSession).toHaveBeenCalledTimes(1);
    expect(runSession.mock.calls[0][0].providerId).toBe(value.providerId);
    expect(runSession.mock.calls[0][0].modelId).toBe(value.modelId);
  });

  it("rejects duplicate run IDs before probing or scoring", async () => {
    const value = input();
    const probeEnvironment = vi.fn();
    const runSession = vi.fn();

    const result = await runOriginAnswerQualityOfficialComparisonHarness({
      ...value,
      candidate: {
        ...value.candidate,
        runId: value.baseline.runId,
      },
    }, { probeEnvironment, runSession });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_COMPARISON_INVALID_INPUT",
    });
    expect(probeEnvironment).not.toHaveBeenCalled();
    expect(runSession).not.toHaveBeenCalled();
  });

  it("rejects comparing a SHA to itself before probing or scoring", async () => {
    const value = input();
    const probeEnvironment = vi.fn();
    const runSession = vi.fn();

    const result = await runOriginAnswerQualityOfficialComparisonHarness({
      ...value,
      candidate: {
        ...value.candidate,
        gitSha: value.baseline.gitSha,
      },
    }, { probeEnvironment, runSession });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_COMPARISON_INVALID_INPUT",
    });
    expect(probeEnvironment).not.toHaveBeenCalled();
    expect(runSession).not.toHaveBeenCalled();
  });

  it("stops before candidate execution if baseline environment proof fails", async () => {
    const runSession = vi.fn();
    const result = await runOriginAnswerQualityOfficialComparisonHarness(
      input(),
      {
        probeEnvironment: vi.fn(async () => ({
          ok: false as const,
          code: "AQ_BENCHMARK_ENV_SHA_MISMATCH" as const,
        })),
        runSession,
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_BASELINE_ENVIRONMENT_INVALID",
      detail: "AQ_BENCHMARK_ENV_SHA_MISMATCH",
    });
    expect(runSession).not.toHaveBeenCalled();
  });

  it("does not run candidate when the baseline measured session fails", async () => {
    let calls = 0;
    const result = await runOriginAnswerQualityOfficialComparisonHarness(
      input(),
      {
        probeEnvironment: vi.fn(async (baseUrl: string, gitSha: string) => ({
          ok: true as const,
          value: {
            schemaVersion: "origin.aq-benchmark-environment-proof.v1" as const,
            baseUrl,
            expectedGitSha: gitSha,
            observedReleaseSha: gitSha,
            freeOnly: true as const,
            costUsd: 0 as const,
            paidFallbackEnabled: false as const,
            runtimeIds: {
              research: "grounded-research-v1.1" as const,
              coding: "coding-v1.4" as const,
              artifact: "artifact-v1.2" as const,
            },
            codingReady: true as const,
          },
        })),
        runSession: vi.fn(async () => {
          calls += 1;
          return {
            ok: false as const,
            code: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED" as const,
            detail: "case-1",
          };
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_BASELINE_SESSION_FAILED",
      detail: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED:case-1",
    });
    expect(calls).toBe(1);
  });
});
