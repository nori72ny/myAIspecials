import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import {
  getOriginAnswerQualityBenchmarkQuotaCaseBudget,
  planOriginAnswerQualityBenchmarkQuotaShards,
} from "./OriginAnswerQualityBenchmarkQuotaPlan";

describe("OriginAnswerQualityBenchmarkQuotaPlan", () => {
  it("accounts conservatively for each execution lane and official scorer", () => {
    expect(getOriginAnswerQualityBenchmarkQuotaCaseBudget({
      caseId: "research",
      category: "current-factual",
    })).toMatchObject({
      executionRequestsPerRuntimeMax: 0,
      scorerRequestsPerRuntimeMax: 4,
      pairedRequestsMax: 8,
    });

    expect(getOriginAnswerQualityBenchmarkQuotaCaseBudget({
      caseId: "chat",
      category: "professional-advice",
    })).toMatchObject({
      executionRequestsPerRuntimeMax: 1,
      scorerRequestsPerRuntimeMax: 4,
      pairedRequestsMax: 10,
    });

    expect(getOriginAnswerQualityBenchmarkQuotaCaseBudget({
      caseId: "coding",
      category: "coding-repair",
    })).toMatchObject({
      executionRequestsPerRuntimeMax: 16,
      scorerRequestsPerRuntimeMax: 4,
      pairedRequestsMax: 40,
    });
  });

  it("shows why a full paired 40-case comparison cannot fit a free 50-request day", () => {
    const result = planOriginAnswerQualityBenchmarkQuotaShards(
      createOriginAnswerQualityFrozenCorpus(),
      50,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fullComparisonRequestsMax).toBe(616);
    expect(result.value.fullComparisonRequestsMax).toBeGreaterThan(50);
    expect(result.value.shards.length).toBeGreaterThan(1);
    expect(result.value.shards.every((shard) => shard.pairedRequestsMax <= 50)).toBe(true);
  });

  it("creates deterministic paired shards without dropping or duplicating cases", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const first = planOriginAnswerQualityBenchmarkQuotaShards(corpus, 45);
    const second = planOriginAnswerQualityBenchmarkQuotaShards(corpus, 45);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const plannedIds = first.value.shards.flatMap((shard) => shard.caseIds);
    expect(plannedIds).toHaveLength(40);
    expect(new Set(plannedIds).size).toBe(40);
    expect([...plannedIds].sort()).toEqual(
      corpus.cases.map((item) => item.caseId).sort(),
    );
    expect(first.value.shards.every((shard) => shard.pairedRequestsMax <= 45)).toBe(true);

    const codingIds = new Set(
      corpus.cases
        .filter((item) =>
          item.category === "coding-generation" || item.category === "coding-repair"
        )
        .map((item) => item.caseId),
    );
    for (const shard of first.value.shards) {
      if (shard.caseIds.some((caseId) => codingIds.has(caseId))) {
        // Coding pair worst-case is 40, so no other case can share a 45-request shard.
        expect(shard.caseIds).toHaveLength(1);
        expect(shard.pairedRequestsMax).toBe(40);
      }
    }
  });

  it("rejects a shard limit too small for one paired coding case", () => {
    const result = planOriginAnswerQualityBenchmarkQuotaShards(
      createOriginAnswerQualityFrozenCorpus(),
      39,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AQ_BENCHMARK_QUOTA_CASE_TOO_LARGE");
    expect(result.caseId).toMatch(/^b[67]-/);
  });

  it("rejects limits above the strict free-tier daily request ceiling", () => {
    expect(planOriginAnswerQualityBenchmarkQuotaShards(
      createOriginAnswerQualityFrozenCorpus(),
      51,
    )).toEqual({ ok: false, code: "AQ_BENCHMARK_QUOTA_LIMIT_INVALID" });
  });

  it("rejects a corpus whose manifest no longer matches its frozen cases", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const tampered = {
      ...corpus,
      manifest: {
        ...corpus.manifest,
        manifestDigest: `sha256:${"f".repeat(64)}`,
      },
    };

    expect(planOriginAnswerQualityBenchmarkQuotaShards(tampered, 45)).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_QUOTA_CORPUS_INVALID",
    });
  });
});
