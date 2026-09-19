import { describe, expect, it, vi } from "vitest";

import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof";
import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import { createOriginAnswerQualityBenchmarkShardCorpus } from "./OriginAnswerQualityBenchmarkShardCorpus";
import {
  runOriginAnswerQualityOfficialBenchmarkSession,
  runOriginAnswerQualityOfficialEvidenceScoredSession,
  runOriginAnswerQualityOfficialProviderScoredSessionHarness,
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
  it("keeps the legacy evidence-scored name as an alias of the canonical official entrypoint", () => {
    expect(runOriginAnswerQualityOfficialEvidenceScoredSession)
      .toBe(runOriginAnswerQualityOfficialBenchmarkSession);
  });

  it("fails on invalid scorer provenance before checkout or evaluator execution", async () => {
    const materialClaimExtractor = vi.fn();
    const promptClaimJudge = vi.fn();
    const semanticJudge = vi.fn();
    const claimAssessor = vi.fn();
    const batchClaimAssessor = vi.fn();
    const fetchImpl = vi.fn();

    const result = await runOriginAnswerQualityOfficialBenchmarkSession({
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
      batchClaimAssessor,
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
    expect(batchClaimAssessor).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves a shard corpus through the provider-scored wrapper", async () => {
    const full = createOriginAnswerQualityFrozenCorpus();
    const shardResult = createOriginAnswerQualityBenchmarkShardCorpus(
      full,
      [full.cases[0].caseId],
    );
    if (shardResult.ok === false) throw new Error(shardResult.code);
    const shard = shardResult.value;

    let receivedCorpus: typeof shard | undefined;
    const runEvidenceScoredSession = vi.fn(async (input) => {
      receivedCorpus = input.corpus;
      return {
        ok: false as const,
        code: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED" as const,
        detail: "fixture-stop",
      };
    });
    const evaluator = vi.fn();
    const createEvaluators = vi.fn(() => ({
      materialClaimExtractor: evaluator,
      promptClaimJudge: evaluator,
      semanticJudge: evaluator,
      claimAssessor: evaluator,
      batchClaimAssessor: evaluator,
      scorerProvenance: {
        schemaVersion: "origin.aq-benchmark-scorer.v1" as const,
        scorerId: "origin-aq-public-deterministic-v1" as const,
        scorerRevision: `sha256:${"c".repeat(64)}`,
        corpusId: "aq-post-heldout-public" as const,
        corpusVersion: "v1" as const,
      },
    }));

    const result = await runOriginAnswerQualityOfficialProviderScoredSessionHarness({
      runId: "provider-scored-shard",
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      environmentProof: proof,
      sourceRoot: "/unused",
      corpus: shard,
    }, {
      createEvaluators: createEvaluators as never,
      runEvidenceScoredSession: runEvidenceScoredSession as never,
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED",
      detail: "fixture-stop",
    });
    expect(createEvaluators).toHaveBeenCalledTimes(1);
    expect(runEvidenceScoredSession).toHaveBeenCalledTimes(1);
    expect(receivedCorpus).toBe(shard);
    expect(receivedCorpus?.cases).toHaveLength(1);
    expect(receivedCorpus?.cases[0].caseId).toBe(full.cases[0].caseId);
  });
});
