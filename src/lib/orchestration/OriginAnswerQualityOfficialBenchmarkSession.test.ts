import { describe, expect, it, vi } from "vitest";

import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof";
import {
  runOriginAnswerQualityOfficialEvidenceScoredSession,
} from "./OriginAnswerQualityOfficialBenchmarkSession";

const proof: OriginAnswerQualityBenchmarkEnvironmentProof = {
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

describe("OriginAnswerQualityOfficialBenchmarkSession", () => {
  it("fails on invalid scorer provenance before checkout or evaluator execution", async () => {
    const materialClaimExtractor = vi.fn();
    const promptClaimJudge = vi.fn();
    const semanticJudge = vi.fn();
    const claimAssessor = vi.fn();
    const fetchImpl = vi.fn();

    const result = await runOriginAnswerQualityOfficialEvidenceScoredSession({
      runId: "official-invalid-scorer",
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      environmentProof: proof,
      sourceRoot: "/path/that/must/not/be/read",
      scorerProvenance: {
        schemaVersion: "origin.aq-benchmark-scorer.v1",
        scorerId: "origin-aq-public-deterministic-v1",
        scorerRevision: "not-a-digest",
        corpusId: "aq-post-heldout-public",
        corpusVersion: "v1",
      },
      materialClaimExtractor,
      promptClaimJudge,
      semanticJudge,
      claimAssessor,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID",
    });
    expect(materialClaimExtractor).not.toHaveBeenCalled();
    expect(promptClaimJudge).not.toHaveBeenCalled();
    expect(semanticJudge).not.toHaveBeenCalled();
    expect(claimAssessor).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
