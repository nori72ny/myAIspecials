import {
  createOriginAnswerQualityBenchmarkQuotaChunkPlan,
} from "./OriginAnswerQualityBenchmarkQuotaChunk.js";
import {
  digestOriginAnswerQualityBenchmarkQuotaChunkArtifact,
  type OriginAnswerQualityBenchmarkQuotaChunkArtifact,
} from "./OriginAnswerQualityBenchmarkQuotaChunkArtifact.js";
import {
  createOriginAnswerQualityBenchmarkRunProvenance,
} from "./OriginAnswerQualityBenchmarkRunProvenance.js";
import {
  bindOriginAnswerQualityBenchmarkRun,
} from "./OriginAnswerQualityBenchmarkRunBinding.js";
import {
  bindOriginAnswerQualityMeasuredObservations,
  type OriginAnswerQualityBenchmarkMeasuredBoundRun,
} from "./OriginAnswerQualityBenchmarkMeasuredRunBinding.js";
import type {
  OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import type {
  OriginAnswerQualityBenchmarkRunnerSuccess,
  OriginAnswerQualityBenchmarkScoredCase,
} from "./OriginAnswerQualityBenchmarkRunner.js";

export interface OriginAnswerQualityBenchmarkQuotaAssembly {
  readonly schemaVersion: "origin.aq-benchmark-quota-assembly.v1";
  readonly scorerProvenanceDigest: string;
  readonly measuredRun: OriginAnswerQualityBenchmarkMeasuredBoundRun;
  readonly chunkArtifactDigests: readonly string[];
  readonly evaluatorRequests: number;
  readonly totalRequests: number;
}

export type OriginAnswerQualityBenchmarkQuotaAssemblyResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkQuotaAssembly }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_CHUNK_SET_INCOMPLETE"
        | "AQ_BENCHMARK_CHUNK_SET_DUPLICATE"
        | "AQ_BENCHMARK_CHUNK_SET_IDENTITY_MISMATCH"
        | "AQ_BENCHMARK_CHUNK_SET_DIGEST_MISMATCH"
        | "AQ_BENCHMARK_CHUNK_SET_CASESET_MISMATCH"
        | "AQ_BENCHMARK_CHUNK_SET_BINDING_FAILED";
    };

function sameIdentity(
  first: OriginAnswerQualityBenchmarkQuotaChunkArtifact,
  next: OriginAnswerQualityBenchmarkQuotaChunkArtifact,
): boolean {
  return first.parentManifestDigest === next.parentManifestDigest
    && first.gitSha === next.gitSha
    && first.providerId === next.providerId
    && first.modelId === next.modelId
    && first.scorerProvenanceDigest === next.scorerProvenanceDigest
    && first.chunkCount === next.chunkCount;
}

function artifactDigestValid(
  artifact: OriginAnswerQualityBenchmarkQuotaChunkArtifact,
): boolean {
  const { artifactDigest, ...withoutDigest } = artifact;
  return digestOriginAnswerQualityBenchmarkQuotaChunkArtifact(withoutDigest)
    === artifactDigest;
}

export function assembleOriginAnswerQualityBenchmarkQuotaChunks(input: {
  readonly runId: string;
  readonly corpus: OriginAnswerQualityBenchmarkFrozenCorpus;
  readonly artifacts: readonly OriginAnswerQualityBenchmarkQuotaChunkArtifact[];
}): OriginAnswerQualityBenchmarkQuotaAssemblyResult {
  const expectedChunkCount = Math.ceil(input.corpus.cases.length / 4);
  if (input.artifacts.length !== expectedChunkCount || input.artifacts.length === 0) {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_INCOMPLETE" };
  }

  const sorted = [...input.artifacts].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const first = sorted[0];
  const seenChunkIndexes = new Set<number>();
  const seenCaseIds = new Set<string>();
  const scoredCases: OriginAnswerQualityBenchmarkScoredCase[] = [];
  const measuredObservations = [];

  let totalProviderRequests = 0;
  let totalToolCalls = 0;
  let totalLatencyMs = 0;
  let evaluatorRequests = 0;
  let totalRequests = 0;

  for (const artifact of sorted) {
    if (seenChunkIndexes.has(artifact.chunkIndex)) {
      return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_DUPLICATE" };
    }
    seenChunkIndexes.add(artifact.chunkIndex);

    if (!sameIdentity(first, artifact)) {
      return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_IDENTITY_MISMATCH" };
    }
    if (!artifactDigestValid(artifact)) {
      return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_DIGEST_MISMATCH" };
    }

    const plan = createOriginAnswerQualityBenchmarkQuotaChunkPlan(
      input.corpus,
      artifact.chunkIndex,
    );
    if (
      !plan.ok
      || artifact.planDigest !== plan.value.planDigest
      || artifact.parentManifestDigest !== input.corpus.manifest.manifestDigest
      || artifact.chunkCount !== expectedChunkCount
    ) {
      return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_IDENTITY_MISMATCH" };
    }

    if (artifact.cases.length !== plan.value.cases.length) {
      return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_CASESET_MISMATCH" };
    }

    const planned = new Map(
      plan.value.cases.map((item) => [item.caseId, item] as const),
    );
    for (const item of artifact.cases) {
      const expected = planned.get(item.caseId);
      if (
        !expected
        || seenCaseIds.has(item.caseId)
        || expected.category !== item.category
        || expected.caseDigest !== item.caseDigest
      ) {
        return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_CASESET_MISMATCH" };
      }
      seenCaseIds.add(item.caseId);
      scoredCases.push(Object.freeze({
        execution: Object.freeze({ ...item.execution }),
        observation: Object.freeze({ ...item.observation }),
      }));
      measuredObservations.push(Object.freeze({ ...item.observation }));

      totalProviderRequests += item.execution.providerRequests;
      totalToolCalls += item.execution.toolCalls;
      totalLatencyMs += item.execution.latencyMs;
    }

    evaluatorRequests += artifact.evaluatorRequests;
    totalRequests += artifact.totalRequests;
  }

  if (
    seenCaseIds.size !== input.corpus.cases.length
    || !input.corpus.cases.every((item) => seenCaseIds.has(item.caseId))
  ) {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_INCOMPLETE" };
  }

  const execution: OriginAnswerQualityBenchmarkRunnerSuccess = Object.freeze({
    schemaVersion: "origin.aq-benchmark-execution.v1",
    manifestDigest: input.corpus.manifest.manifestDigest,
    caseCount: scoredCases.length,
    scoredCases: Object.freeze(scoredCases),
    totalProviderRequests,
    totalToolCalls,
    totalLatencyMs,
    totalCostUsd: 0,
  });

  const startedAt = sorted
    .map((artifact) => artifact.startedAt)
    .sort()[0];
  const completedAt = sorted
    .map((artifact) => artifact.completedAt)
    .sort()
    .at(-1)!;

  const provenance = createOriginAnswerQualityBenchmarkRunProvenance({
    runId: input.runId,
    gitSha: first.gitSha,
    manifestDigest: input.corpus.manifest.manifestDigest,
    providerId: first.providerId,
    modelId: first.modelId,
    freeOnly: true,
    totalCostUsd: 0,
    startedAt,
    completedAt,
  }, input.corpus.manifest);
  if (!provenance.ok) {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_BINDING_FAILED" };
  }

  const bound = bindOriginAnswerQualityBenchmarkRun(provenance.value, execution);
  if (!bound.ok) {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_BINDING_FAILED" };
  }

  const measured = bindOriginAnswerQualityMeasuredObservations(
    bound.value,
    measuredObservations,
  );
  if (!measured.ok) {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_SET_BINDING_FAILED" };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-quota-assembly.v1",
      scorerProvenanceDigest: first.scorerProvenanceDigest,
      measuredRun: measured.value,
      chunkArtifactDigests: Object.freeze(sorted.map((item) => item.artifactDigest)),
      evaluatorRequests,
      totalRequests,
    }),
  };
}
