import { describe, expect, it, vi } from "vitest";

import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof";
import {
  runOriginAnswerQualityOfficialProviderComparisonHarness,
  type OriginAnswerQualityOfficialProviderComparisonInput,
} from "./OriginAnswerQualityOfficialComparisonRunner";
import type {
  OriginAnswerQualityOfficialBenchmarkSessionResult,
  OriginAnswerQualityOfficialBenchmarkSessionSuccess,
} from "./OriginAnswerQualityOfficialBenchmarkSession";

function proof(sha: string, baseUrl: string): OriginAnswerQualityBenchmarkEnvironmentProof {
  return {
    schemaVersion: "origin.aq-benchmark-environment-proof.v1",
    baseUrl,
    expectedGitSha: sha,
    observedReleaseSha: sha,
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
}

function input(): OriginAnswerQualityOfficialProviderComparisonInput {
  const baselineSha = "a".repeat(40);
  const candidateSha = "b".repeat(40);
  return {
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    evaluatorPlanningOptions: {
      preferredProviderId: "openrouter-free",
      preferredModelId: "example/free-model:free",
    },
    baseline: {
      runId: "baseline-1",
      gitSha: baselineSha,
      environmentProof: proof(baselineSha, "https://baseline.example/"),
      sourceRoot: "/baseline",
    },
    candidate: {
      runId: "candidate-1",
      gitSha: candidateSha,
      environmentProof: proof(candidateSha, "https://candidate.example/"),
      sourceRoot: "/candidate",
    },
  };
}

describe("OriginAnswerQualityOfficialProviderComparisonRunner", () => {
  it("rejects identical revisions before any session executes", async () => {
    const value = input();
    const runSession = vi.fn();

    const result = await runOriginAnswerQualityOfficialProviderComparisonHarness({
      ...value,
      candidate: {
        ...value.candidate,
        gitSha: value.baseline.gitSha,
        environmentProof: proof(value.baseline.gitSha, "https://candidate.example/"),
      },
    }, runSession);

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_COMPARISON_INVALID_INPUT",
    });
    expect(runSession).not.toHaveBeenCalled();
  });

  it("stops before candidate execution when baseline fails", async () => {
    const runSession = vi.fn().mockResolvedValue({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID",
    } satisfies OriginAnswerQualityOfficialBenchmarkSessionResult);

    const result = await runOriginAnswerQualityOfficialProviderComparisonHarness(
      input(),
      runSession,
    );

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_BASELINE_FAILED",
      detail: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID",
    });
    expect(runSession).toHaveBeenCalledTimes(1);
  });

  it("passes identical provider and evaluator routing inputs to both revisions", async () => {
    const value = input();
    const baselineSuccess: OriginAnswerQualityOfficialBenchmarkSessionResult = {
      ok: true,
      value: {} as OriginAnswerQualityOfficialBenchmarkSessionSuccess,
    };
    const candidateFailure: OriginAnswerQualityOfficialBenchmarkSessionResult = {
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID",
    };
    const runSession = vi.fn()
      .mockResolvedValueOnce(baselineSuccess)
      .mockResolvedValueOnce(candidateFailure);

    const result = await runOriginAnswerQualityOfficialProviderComparisonHarness(
      value,
      runSession,
    );

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_CANDIDATE_FAILED",
      detail: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID",
    });

    const baselineCall = runSession.mock.calls[0][0];
    const candidateCall = runSession.mock.calls[1][0];
    expect(baselineCall.providerId).toBe(value.providerId);
    expect(candidateCall.providerId).toBe(value.providerId);
    expect(baselineCall.modelId).toBe(value.modelId);
    expect(candidateCall.modelId).toBe(value.modelId);
    expect(baselineCall.env).toBe(value.env);
    expect(candidateCall.env).toBe(value.env);
    expect(baselineCall.evaluatorPlanningOptions).toBe(value.evaluatorPlanningOptions);
    expect(candidateCall.evaluatorPlanningOptions).toBe(value.evaluatorPlanningOptions);
    expect(baselineCall.gitSha).toBe(value.baseline.gitSha);
    expect(candidateCall.gitSha).toBe(value.candidate.gitSha);
  });

  it("rejects environment proof drift before any provider-scored session", async () => {
    const value = input();
    const runSession = vi.fn();

    const result = await runOriginAnswerQualityOfficialProviderComparisonHarness({
      ...value,
      candidate: {
        ...value.candidate,
        environmentProof: proof("d".repeat(40), "https://candidate.example/"),
      },
    }, runSession);

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_COMPARISON_INVALID_INPUT",
    });
    expect(runSession).not.toHaveBeenCalled();
  });
});
