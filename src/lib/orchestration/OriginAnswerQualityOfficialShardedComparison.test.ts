import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import {
  planOriginAnswerQualityBenchmarkQuotaShards,
} from "./OriginAnswerQualityBenchmarkQuotaPlan";
import {
  createOriginAnswerQualityBenchmarkShardCorpus,
} from "./OriginAnswerQualityBenchmarkShardCorpus";
import type {
  OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard";
import {
  digestOriginAnswerQualityOfficialShardComparison,
  type OriginAnswerQualityOfficialShardComparison,
} from "./OriginAnswerQualityOfficialShardComparison";
import {
  aggregateOriginAnswerQualityOfficialShards,
} from "./OriginAnswerQualityOfficialShardedComparison";

const full = createOriginAnswerQualityFrozenCorpus();
const planResult = planOriginAnswerQualityBenchmarkQuotaShards(full, 45);
if (planResult.ok === false) throw new Error("quota plan fixture failed");
const plan = planResult.value;

const scorerProvenance = {
  schemaVersion: "origin.aq-benchmark-scorer.v1" as const,
  scorerId: "origin-aq-public-deterministic-v1" as const,
  scorerRevision: `sha256:${"c".repeat(64)}`,
  corpusId: "aq-post-heldout-public" as const,
  corpusVersion: "v1" as const,
};

function observation(
  caseId: string,
  category: OriginAnswerQualityBenchmarkMeasuredObservation["category"],
  candidate: boolean,
): OriginAnswerQualityBenchmarkMeasuredObservation {
  return {
    caseId,
    category,
    factualSupportScore: candidate ? 0.9 : 0.8,
    citationPrecisionScore: 0.8,
    taskCompletionScore: 1,
    contradictionDetectionScore: 1,
    verifierRejectedUnsupportedClaim: false,
    repairSucceeded: category === "coding-repair" ? true : undefined,
    providerRequests: category === "coding-generation" || category === "coding-repair" ? 2 : 0,
    latencyMs: 100,
    costUsd: 0,
    unsupportedMaterialClaimCount: 0,
    verificationIntegrityAccurate: true,
    failClosedCorrect: category === "fail-closed" ? true : undefined,
    userActionabilityScore: 3,
  };
}

function shards(): OriginAnswerQualityOfficialShardComparison[] {
  const categoryById = new Map(
    full.cases.map((item) => [item.caseId, item.category] as const),
  );

  return plan.shards.map((planned) => {
    const subset = createOriginAnswerQualityBenchmarkShardCorpus(
      full,
      planned.caseIds,
    );
    if (!subset.ok) throw new Error("subset fixture failed");

    const baselineObservations = planned.caseIds.map((caseId) =>
      observation(caseId, categoryById.get(caseId)!, false)
    );
    const candidateObservations = planned.caseIds.map((caseId) =>
      observation(caseId, categoryById.get(caseId)!, true)
    );

    const base = {
      schemaVersion: "origin.aq-official-shard-comparison.v1" as const,
      benchmarkId: full.benchmarkId,
      benchmarkVersion: full.benchmarkVersion,
      fullManifestDigest: full.manifest.manifestDigest,
      shardIndex: planned.shardIndex,
      caseIds: planned.caseIds,
      shardManifestDigest: subset.value.manifest.manifestDigest,
      plannedPairedRequestsMax: planned.pairedRequestsMax,
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      baselineGitSha: "a".repeat(40),
      candidateGitSha: "b".repeat(40),
      baselineRunId: `baseline-${planned.shardIndex}`,
      candidateRunId: `candidate-${planned.shardIndex}`,
      baselineMeasuredDigest: `sha256:${"1".repeat(64)}`,
      candidateMeasuredDigest: `sha256:${"2".repeat(64)}`,
      baselineRuntimeProviderRequests: baselineObservations.reduce(
        (sum, item) => sum + item.providerRequests,
        0,
      ),
      candidateRuntimeProviderRequests: candidateObservations.reduce(
        (sum, item) => sum + item.providerRequests,
        0,
      ),
      baselineEvaluatorRequests: 0,
      candidateEvaluatorRequests: 0,
      scorerProvenance,
      scorerProvenanceDigest: `sha256:${"d".repeat(64)}`,
      baselineObservations,
      candidateObservations,
    };

    return {
      ...base,
      shardDigest: digestOriginAnswerQualityOfficialShardComparison(base),
    };
  });
}

describe("OriginAnswerQualityOfficialShardedComparison", () => {
  it("reassembles exactly forty paired cases without pretending they were one run", () => {
    const result = aggregateOriginAnswerQualityOfficialShards(
      full,
      plan,
      shards(),
    );

    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.value.baseline.caseCount).toBe(40);
    expect(result.value.candidate.caseCount).toBe(40);
    expect(result.value.delta.factualSupportDelta).toBeCloseTo(0.1);
    expect(result.value.hardGates.exactCorpusCoverage).toBe(true);
    expect(result.value.hardGates.sameScorer).toBe(true);
    expect(result.value.hardGates.zeroCost).toBe(true);
    expect(result.value.hardGates.userActionabilityNotWorse).toBe(true);
    expect(result.value.hardGates.userActionabilityFamiliesNotWorse).toBe(true);
    expect(result.value.userActionabilityRegressionFamilies).toEqual([]);
    expect(result.value.aggregateDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.value.shardDigests).toHaveLength(plan.shards.length);
  });

  it("surfaces a per-family actionability regression as an official hard-gate failure", () => {
    const values = shards();
    const targetCategory = "professional-advice";
    const modified = values.map((shard) => {
      const candidateObservations = shard.candidateObservations.map((item) =>
        item.category === targetCategory ? { ...item, userActionabilityScore: 2 as const } : item
      );
      if (candidateObservations.every((item, index) =>
        item.userActionabilityScore === shard.candidateObservations[index].userActionabilityScore
      )) return shard;
      const next = { ...shard, candidateObservations };
      const { shardDigest: _digest, ...rest } = next;
      return { ...next, shardDigest: digestOriginAnswerQualityOfficialShardComparison(rest) };
    });

    const result = aggregateOriginAnswerQualityOfficialShards(full, plan, modified);
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.value.hardGates.userActionabilityNotWorse).toBe(false);
    expect(result.value.hardGates.userActionabilityFamiliesNotWorse).toBe(false);
    expect(result.value.userActionabilityRegressionFamilies).toContain(targetCategory);
  });

  it("rejects a missing shard instead of calculating a partial 40-case score", () => {
    const values = shards();
    expect(aggregateOriginAnswerQualityOfficialShards(
      full,
      plan,
      values.slice(1),
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SHARDED_INPUT_INVALID",
    });
  });

  it("rejects shard measurement tampering even when the outer identity is unchanged", () => {
    const values = shards();
    const tampered = [
      {
        ...values[0],
        candidateObservations: values[0].candidateObservations.map(
          (item, index) => index === 0
            ? { ...item, factualSupportScore: 0 }
            : item,
        ),
      },
      ...values.slice(1),
    ];

    const result = aggregateOriginAnswerQualityOfficialShards(full, plan, tampered);
    expect(result.ok).toBe(false);
    if (result.ok === true) return;
    expect(result.code).toBe("AQ_BENCHMARK_SHARDED_SHARD_DIGEST_MISMATCH");
  });

  it("rejects scorer drift across days or shards", () => {
    const values = shards();
    const changed = [
      values[0],
      {
        ...values[1],
        scorerProvenance: {
          ...values[1].scorerProvenance,
          scorerRevision: `sha256:${"e".repeat(64)}`,
        },
        scorerProvenanceDigest: `sha256:${"f".repeat(64)}`,
      },
      ...values.slice(2),
    ];
    const second = changed[1];
    const { shardDigest: _digest, ...rest } = second;
    changed[1] = {
      ...second,
      shardDigest: digestOriginAnswerQualityOfficialShardComparison(rest),
    };

    const result = aggregateOriginAnswerQualityOfficialShards(full, plan, changed);
    expect(result.ok).toBe(false);
    if (result.ok === true) return;
    expect(result.code).toBe("AQ_BENCHMARK_SHARDED_IDENTITY_MISMATCH");
  });

  it("rejects duplicated case observations even if all planned shard IDs exist", () => {
    const values = shards();
    const first = values[0];
    const second = values[1];
    const duplicated = second.baselineObservations.map((item, index) =>
      index === 0 ? { ...item, caseId: first.baselineObservations[0].caseId } : item
    );
    const modified = {
      ...second,
      baselineObservations: duplicated,
    };
    const { shardDigest: _digest, ...rest } = modified;
    const next = [
      first,
      {
        ...modified,
        shardDigest: digestOriginAnswerQualityOfficialShardComparison(rest),
      },
      ...values.slice(2),
    ];

    const result = aggregateOriginAnswerQualityOfficialShards(full, plan, next);
    expect(result.ok).toBe(false);
    if (result.ok === true) return;
    expect(result.code).toBe("AQ_BENCHMARK_SHARDED_CASESET_MISMATCH");
  });
});
