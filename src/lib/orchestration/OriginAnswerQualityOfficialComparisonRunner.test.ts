import { describe, expect, it, vi } from "vitest";

import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof";
import {
  runOriginAnswerQualityOfficialComparisonHarness,
  type OriginAnswerQualityOfficialComparisonInput,
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

function input(): OriginAnswerQualityOfficialComparisonInput {
  const baselineSha = "a".repeat(40);
  const candidateSha = "b".repeat(40);
  return {
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    scorerProvenance: {
      schemaVersion: "origin.aq-benchmark-scorer.v1",
      scorerId: "origin-aq-public-deterministic-v1",
      scorerRevision: `sha256:${"c".repeat(64)}`,
      corpusId: "aq-post-heldout-public",
      corpusVersion: "v1",
    },
    materialClaimExtractor: vi.fn(),
    promptClaimJudge: vi.fn(),
    semanticJudge: vi.fn(),
    claimAssessor: vi.fn(),
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

describe("OriginAnswerQualityOfficialComparisonRunner", () => {
  it("rejects a comparison that does not use distinct revisions", async () => {
    const value = input();
    const runSession = vi.fn();
    const result = await runOriginAnswerQualityOfficialComparisonHarness({
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

  it("stops immediately when the baseline session fails", async () => {
    const runSession = vi.fn().mockResolvedValue({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID",
    } satisfies OriginAnswerQualityOfficialBenchmarkSessionResult);

    const result = await runOriginAnswerQualityOfficialComparisonHarness(
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

  it("passes the same provider, model and scorer provenance to both sides", async () => {
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

    const result = await runOriginAnswerQualityOfficialComparisonHarness(
      value,
      runSession,
    );

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_CANDIDATE_FAILED",
      detail: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID",
    });
    expect(runSession).toHaveBeenCalledTimes(2);

    const baselineCall = runSession.mock.calls[0][0];
    const candidateCall = runSession.mock.calls[1][0];
    expect(baselineCall.providerId).toBe(value.providerId);
    expect(candidateCall.providerId).toBe(value.providerId);
    expect(baselineCall.modelId).toBe(value.modelId);
    expect(candidateCall.modelId).toBe(value.modelId);
    expect(baselineCall.scorerProvenance).toEqual(value.scorerProvenance);
    expect(candidateCall.scorerProvenance).toEqual(value.scorerProvenance);
    expect(baselineCall.gitSha).toBe(value.baseline.gitSha);
    expect(candidateCall.gitSha).toBe(value.candidate.gitSha);
  });

  it("rejects an environment proof that does not match its target revision", async () => {
    const value = input();
    const runSession = vi.fn();

    const result = await runOriginAnswerQualityOfficialComparisonHarness({
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
