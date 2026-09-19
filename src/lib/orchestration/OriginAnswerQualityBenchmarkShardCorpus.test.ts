import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import {
  createOriginAnswerQualityBenchmarkShardCorpus,
} from "./OriginAnswerQualityBenchmarkShardCorpus";

describe("OriginAnswerQualityBenchmarkShardCorpus", () => {
  it("creates a frozen subset with the same benchmark identity and exact selected cases", () => {
    const full = createOriginAnswerQualityFrozenCorpus();
    const ids = [full.cases[0].caseId, full.cases[5].caseId];

    const result = createOriginAnswerQualityBenchmarkShardCorpus(full, ids);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.benchmarkId).toBe(full.benchmarkId);
    expect(result.value.benchmarkVersion).toBe(full.benchmarkVersion);
    expect(result.value.cases.map((item) => item.caseId)).toEqual(ids);
    expect(result.value.manifest.cases.map((item) => item.caseId)).toEqual(ids);
    expect(result.value.manifest.manifestDigest).not.toBe(full.manifest.manifestDigest);
  });

  it("rejects empty, duplicate, or unknown shard identities", () => {
    const full = createOriginAnswerQualityFrozenCorpus();

    expect(createOriginAnswerQualityBenchmarkShardCorpus(full, [])).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SHARD_CASESET_INVALID",
    });

    expect(createOriginAnswerQualityBenchmarkShardCorpus(
      full,
      [full.cases[0].caseId, full.cases[0].caseId],
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SHARD_CASESET_INVALID",
    });

    expect(createOriginAnswerQualityBenchmarkShardCorpus(
      full,
      ["unknown-case"],
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SHARD_CASE_NOT_FOUND",
      caseId: "unknown-case",
    });
  });
});
