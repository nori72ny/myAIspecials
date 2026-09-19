import {
  type OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import {
  createOriginAnswerQualityBenchmarkManifest,
} from "./OriginAnswerQualityBenchmarkManifest.js";

export type OriginAnswerQualityBenchmarkShardCorpusResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkFrozenCorpus }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_SHARD_CASESET_INVALID"
        | "AQ_BENCHMARK_SHARD_CASE_NOT_FOUND"
        | "AQ_BENCHMARK_SHARD_MANIFEST_INVALID";
      caseId?: string;
    };

export function createOriginAnswerQualityBenchmarkShardCorpus(
  full: OriginAnswerQualityBenchmarkFrozenCorpus,
  caseIds: readonly string[],
): OriginAnswerQualityBenchmarkShardCorpusResult {
  if (
    caseIds.length === 0
    || new Set(caseIds).size !== caseIds.length
  ) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_CASESET_INVALID" };
  }

  const byId = new Map(full.cases.map((item) => [item.caseId, item] as const));
  const selected = [];
  for (const caseId of caseIds) {
    const item = byId.get(caseId);
    if (!item) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_SHARD_CASE_NOT_FOUND",
        caseId,
      };
    }
    selected.push(item);
  }

  const manifest = createOriginAnswerQualityBenchmarkManifest(
    full.benchmarkId,
    full.benchmarkVersion,
    selected.map(({ caseId, category, caseDigest }) => ({
      caseId,
      category,
      caseDigest,
    })),
  );
  if (manifest.ok === false) {
    return { ok: false, code: "AQ_BENCHMARK_SHARD_MANIFEST_INVALID" };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-corpus.v1",
      benchmarkId: full.benchmarkId,
      benchmarkVersion: full.benchmarkVersion,
      cases: Object.freeze([...selected]),
      manifest: manifest.value,
    }),
  };
}
