import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import {
  ORIGIN_AQ_CHUNK_MAX_CASES,
  ORIGIN_AQ_FREE_DAILY_REQUEST_LIMIT,
  ORIGIN_AQ_FREE_REQUEST_RESERVE,
  createOriginAnswerQualityBenchmarkQuotaChunkPlan,
  assertOriginAnswerQualityBenchmarkQuotaChunkUsage,
} from "./OriginAnswerQualityBenchmarkQuotaChunk";

describe("OriginAnswerQualityBenchmarkQuotaChunk", () => {
  it("splits the frozen 40-case corpus into ten deterministic four-case chunks", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const plans = Array.from({ length: 10 }, (_, index) =>
      createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, index),
    );

    expect(plans.every((result) => result.ok)).toBe(true);
    const values = plans.map((result) => {
      if (!result.ok) throw new Error(result.code);
      return result.value;
    });

    expect(values).toHaveLength(10);
    expect(values.every((plan) => plan.cases.length === ORIGIN_AQ_CHUNK_MAX_CASES)).toBe(true);
    expect(new Set(values.flatMap((plan) => plan.cases.map((item) => item.caseId))).size).toBe(40);
    expect(values.flatMap((plan) => plan.cases.map((item) => item.caseId))).toEqual(
      corpus.cases.map((item) => item.caseId),
    );
  });

  it("keeps every chunk below the 50-request free daily limit with reserve", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const plan = createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, 0);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.theoreticalMaxRequests).toBe(44);
    expect(plan.value.theoreticalMaxRequests + ORIGIN_AQ_FREE_REQUEST_RESERVE)
      .toBe(ORIGIN_AQ_FREE_DAILY_REQUEST_LIMIT);
  });

  it("rejects invalid chunk indexes", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();

    expect(createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, -1)).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_CHUNK_INDEX_INVALID",
    });
    expect(createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, 10)).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_CHUNK_INDEX_INVALID",
    });
  });

  it("rejects measured request usage that exceeds the theoretical or daily budget", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const plan = createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, 0);
    if (!plan.ok) throw new Error(plan.code);

    expect(() => assertOriginAnswerQualityBenchmarkQuotaChunkUsage(
      plan.value,
      28,
      16,
    )).not.toThrow();

    expect(() => assertOriginAnswerQualityBenchmarkQuotaChunkUsage(
      plan.value,
      29,
      16,
    )).toThrow("AQ_BENCHMARK_CHUNK_REQUEST_BUDGET_EXCEEDED");

    expect(() => assertOriginAnswerQualityBenchmarkQuotaChunkUsage(
      plan.value,
      -1,
      0,
    )).toThrow("AQ_BENCHMARK_CHUNK_REQUEST_USAGE_INVALID");
  });

  it("binds each chunk to the exact parent manifest and ordered case digests", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const first = createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, 0);
    const second = createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, 1);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.parentManifestDigest).toBe(corpus.manifest.manifestDigest);
    expect(second.value.parentManifestDigest).toBe(corpus.manifest.manifestDigest);
    expect(first.value.planDigest).not.toBe(second.value.planDigest);
    expect(first.value.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
