import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import {
  createOriginAnswerQualityBenchmarkQuotaChunkPlan,
} from "./OriginAnswerQualityBenchmarkQuotaChunk";
import {
  createOriginAnswerQualityBenchmarkQuotaChunkArtifact,
  type OriginAnswerQualityBenchmarkQuotaChunkArtifact,
} from "./OriginAnswerQualityBenchmarkQuotaChunkArtifact";
import {
  assembleOriginAnswerQualityBenchmarkQuotaChunks,
} from "./OriginAnswerQualityBenchmarkQuotaAssembler";

function artifactFor(
  chunkIndex: number,
  overrides: Partial<{
    gitSha: string;
    providerId: string;
    modelId: string;
    scorerProvenanceDigest: string;
  }> = {},
): OriginAnswerQualityBenchmarkQuotaChunkArtifact {
  const corpus = createOriginAnswerQualityFrozenCorpus();
  const plan = createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, chunkIndex);
  if (!plan.ok) throw new Error(plan.code);

  const cases = plan.value.cases.map((item) => {
    const execution = {
      caseId: item.caseId,
      finalAnswerRef: `sha256:${"a".repeat(64)}`,
      evidenceLedgerRef: `sha256:${"b".repeat(64)}`,
      verifierResult: "PASS" as const,
      providerRequests: 1,
      toolCalls: 1,
      latencyMs: 100,
      costUsd: 0,
      failureCode: null,
    };
    const observation = {
      caseId: item.caseId,
      category: item.category,
      factualSupportScore: 1,
      citationPrecisionScore: 1,
      taskCompletionScore: 1,
      contradictionDetectionScore: 1,
      verifierRejectedUnsupportedClaim: false,
      repairSucceeded: item.category === "coding-repair" ? true : undefined,
      providerRequests: 1,
      latencyMs: 100,
      costUsd: 0,
      unsupportedMaterialClaimCount: 0,
      verificationIntegrityAccurate: true,
      failClosedCorrect: item.category === "fail-closed" ? true : undefined,
      userActionabilityScore: 3 as const,
    };
    return {
      caseId: item.caseId,
      category: item.category,
      caseDigest: item.caseDigest,
      execution,
      observation,
    };
  });

  const result = createOriginAnswerQualityBenchmarkQuotaChunkArtifact({
    plan: plan.value,
    gitSha: overrides.gitSha ?? "a".repeat(40),
    providerId: overrides.providerId ?? "openrouter-free",
    modelId: overrides.modelId ?? "example/free:free",
    scorerProvenanceDigest:
      overrides.scorerProvenanceDigest ?? `sha256:${"c".repeat(64)}`,
    startedAt: `2026-09-${String(19 + chunkIndex).padStart(2, "0")}T00:00:00.000Z`,
    completedAt: `2026-09-${String(19 + chunkIndex).padStart(2, "0")}T00:10:00.000Z`,
    evaluatorRequests: 12,
    cases,
  });
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

describe("OriginAnswerQualityBenchmarkQuotaAssembler", () => {
  it("reconstructs one complete measured 40-case run from ten quota-safe chunks", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const artifacts = Array.from({ length: 10 }, (_, index) => artifactFor(index));

    const result = assembleOriginAnswerQualityBenchmarkQuotaChunks({
      runId: "aq-baseline-resumable",
      corpus,
      artifacts,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.measuredRun.boundRun.caseCount).toBe(40);
    expect(result.value.measuredRun.measuredObservations).toHaveLength(40);
    expect(result.value.chunkArtifactDigests).toHaveLength(10);
    expect(result.value.evaluatorRequests).toBe(120);
    expect(result.value.totalRequests).toBe(160);
    expect(result.value.measuredRun.boundRun.manifestDigest)
      .toBe(corpus.manifest.manifestDigest);
  });

  it("refuses incomplete or duplicate chunk sets", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const complete = Array.from({ length: 10 }, (_, index) => artifactFor(index));

    expect(assembleOriginAnswerQualityBenchmarkQuotaChunks({
      runId: "aq-incomplete",
      corpus,
      artifacts: complete.slice(0, 9),
    })).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_CHUNK_SET_INCOMPLETE",
    });

    expect(assembleOriginAnswerQualityBenchmarkQuotaChunks({
      runId: "aq-duplicate",
      corpus,
      artifacts: [...complete.slice(0, 9), complete[0]],
    })).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_CHUNK_SET_DUPLICATE",
    });
  });

  it("refuses a chunk produced by another SHA, model, provider, or scorer", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const artifacts = Array.from({ length: 10 }, (_, index) => artifactFor(index));
    artifacts[9] = artifactFor(9, { gitSha: "b".repeat(40) });

    expect(assembleOriginAnswerQualityBenchmarkQuotaChunks({
      runId: "aq-identity",
      corpus,
      artifacts,
    })).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_CHUNK_SET_IDENTITY_MISMATCH",
    });
  });

  it("refuses artifact digest tampering", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const artifacts = Array.from({ length: 10 }, (_, index) => artifactFor(index));
    artifacts[3] = {
      ...artifacts[3],
      totalRequests: artifacts[3].totalRequests + 1,
    };

    expect(assembleOriginAnswerQualityBenchmarkQuotaChunks({
      runId: "aq-tampered",
      corpus,
      artifacts,
    })).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_CHUNK_SET_DIGEST_MISMATCH",
    });
  });
});
