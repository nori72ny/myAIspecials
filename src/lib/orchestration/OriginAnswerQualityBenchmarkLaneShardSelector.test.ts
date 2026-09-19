import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import {
  resolveOriginAnswerQualityBenchmarkRequiredLanes,
  type OriginAnswerQualityBenchmarkExecutionLane,
} from "./OriginAnswerQualityBenchmarkExecutionRouter";
import {
  selectOriginAnswerQualityBenchmarkQuotaShardForLanes,
} from "./OriginAnswerQualityBenchmarkLaneShardSelector";
import {
  planOriginAnswerQualityBenchmarkQuotaShards,
} from "./OriginAnswerQualityBenchmarkQuotaPlan";

function fixture() {
  const corpus = createOriginAnswerQualityFrozenCorpus();
  const plan = planOriginAnswerQualityBenchmarkQuotaShards(corpus, 45);
  if (plan.ok === false) throw new Error(plan.code);
  return { corpus, plan: plan.value };
}

describe("OriginAnswerQualityBenchmarkLaneShardSelector", () => {
  for (const lane of ["research", "chat", "coding", "artifact"] as const) {
    it(`selects a deterministic ${lane}-only shard`, () => {
      const { corpus, plan } = fixture();
      const first = selectOriginAnswerQualityBenchmarkQuotaShardForLanes(
        corpus,
        plan,
        [lane],
      );
      const second = selectOriginAnswerQualityBenchmarkQuotaShardForLanes(
        corpus,
        plan,
        [lane],
      );

      expect(first).toEqual(second);
      expect(first.ok).toBe(true);
      if (first.ok === false) return;

      const caseSet = new Set(first.value.caseIds);
      const selected = corpus.cases.filter((item) => caseSet.has(item.caseId));
      expect(resolveOriginAnswerQualityBenchmarkRequiredLanes(selected))
        .toEqual([lane]);
      expect(first.value.pairedRequestsMax).toBeLessThanOrEqual(45);
    });
  }

  it("supports exact multi-lane selection without accepting supersets", () => {
    const { corpus, plan } = fixture();
    const result = selectOriginAnswerQualityBenchmarkQuotaShardForLanes(
      corpus,
      plan,
      ["chat", "artifact"],
    );

    if (result.ok === true) {
      const caseSet = new Set(result.value.caseIds);
      const selected = corpus.cases.filter((item) => caseSet.has(item.caseId));
      expect(resolveOriginAnswerQualityBenchmarkRequiredLanes(selected))
        .toEqual(["chat", "artifact"]);
    } else {
      expect(result.code).toBe("AQ_BENCHMARK_LANE_SHARD_NOT_FOUND");
    }
  });

  it("rejects empty or duplicated lane requirements", () => {
    const { corpus, plan } = fixture();

    expect(selectOriginAnswerQualityBenchmarkQuotaShardForLanes(
      corpus,
      plan,
      [],
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_LANE_SHARD_INVALID_INPUT",
    });

    expect(selectOriginAnswerQualityBenchmarkQuotaShardForLanes(
      corpus,
      plan,
      ["research", "research"] as readonly OriginAnswerQualityBenchmarkExecutionLane[],
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_LANE_SHARD_INVALID_INPUT",
    });
  });

  it("rejects a quota plan from another benchmark identity", () => {
    const { corpus, plan } = fixture();
    const mismatched = {
      ...plan,
      benchmarkVersion: "v2",
    };

    expect(selectOriginAnswerQualityBenchmarkQuotaShardForLanes(
      corpus,
      mismatched,
      ["research"],
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_LANE_SHARD_INVALID_INPUT",
    });
  });
});
