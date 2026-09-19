import type {
  OriginAnswerQualityBenchmarkCategory,
} from "./OriginAnswerQualityBenchmark.js";
import type {
  OriginAnswerQualityBenchmarkCorpusCase,
  OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import {
  createOriginAnswerQualityBenchmarkManifest,
} from "./OriginAnswerQualityBenchmarkManifest.js";

export interface OriginAnswerQualityBenchmarkQuotaCaseBudget {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkCategory;
  readonly executionRequestsPerRuntimeMax: number;
  readonly scorerRequestsPerRuntimeMax: number;
  readonly pairedRequestsMax: number;
}

export interface OriginAnswerQualityBenchmarkQuotaShard {
  readonly shardIndex: number;
  readonly caseIds: readonly string[];
  readonly pairedRequestsMax: number;
}

export interface OriginAnswerQualityBenchmarkQuotaPlan {
  readonly schemaVersion: "origin.aq-benchmark-quota-plan.v1";
  readonly benchmarkId: string;
  readonly benchmarkVersion: string;
  readonly maxProviderRequestsPerShard: number;
  readonly fullComparisonRequestsMax: number;
  readonly caseBudgets: readonly OriginAnswerQualityBenchmarkQuotaCaseBudget[];
  readonly shards: readonly OriginAnswerQualityBenchmarkQuotaShard[];
}

export type OriginAnswerQualityBenchmarkQuotaPlanResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkQuotaPlan }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_QUOTA_LIMIT_INVALID"
        | "AQ_BENCHMARK_QUOTA_CASE_TOO_LARGE"
        | "AQ_BENCHMARK_QUOTA_CORPUS_INVALID";
      caseId?: string;
    };

/**
 * Worst-case request accounting for one runtime side.
 *
 * Research uses the keyless Grounded Research path and reports zero provider
 * requests. Chat and Artifact each make at most one user-facing provider
 * request. Coding can create at most five provider request objects per
 * session (one discovery + up to three proposal rounds + one duplicate-patch
 * replan), with a session-wide six-retry cap and at most one explicit
 * zero-cost failover per request object: 5 + 6 + 5 = 16.
 *
 * The official scorer can use at most four provider executions per successful
 * case: material-claim extraction, prompt-claim support, semantic rubric, and
 * one batched source-support assessment. Failed/blocked runtime cases use no
 * more scorer calls than this ceiling.
 */
const EXECUTION_REQUESTS_PER_RUNTIME_MAX: Readonly<Record<
  OriginAnswerQualityBenchmarkCategory,
  number
>> = Object.freeze({
  "current-factual": 0,
  "multi-source-comparison": 0,
  "contradiction-detection": 0,
  "user-document-reasoning": 1,
  "professional-advice": 1,
  "coding-generation": 16,
  "coding-repair": 16,
  "artifact-generation": 1,
  "ambiguity-handling": 1,
  "fail-closed": 1,
  "citation-precision": 1,
});

const SCORER_REQUESTS_PER_RUNTIME_MAX = 4;
const MIN_SHARD_LIMIT = 1;
const MAX_SHARD_LIMIT = 50;

export function getOriginAnswerQualityBenchmarkQuotaCaseBudget(
  item: Pick<OriginAnswerQualityBenchmarkCorpusCase, "caseId" | "category">,
): OriginAnswerQualityBenchmarkQuotaCaseBudget {
  const executionRequestsPerRuntimeMax =
    EXECUTION_REQUESTS_PER_RUNTIME_MAX[item.category];
  const scorerRequestsPerRuntimeMax = SCORER_REQUESTS_PER_RUNTIME_MAX;
  return Object.freeze({
    caseId: item.caseId,
    category: item.category,
    executionRequestsPerRuntimeMax,
    scorerRequestsPerRuntimeMax,
    pairedRequestsMax:
      2 * (executionRequestsPerRuntimeMax + scorerRequestsPerRuntimeMax),
  });
}

export function planOriginAnswerQualityBenchmarkQuotaShards(
  corpus: OriginAnswerQualityBenchmarkFrozenCorpus,
  maxProviderRequestsPerShard: number,
): OriginAnswerQualityBenchmarkQuotaPlanResult {
  if (
    !Number.isInteger(maxProviderRequestsPerShard)
    || maxProviderRequestsPerShard < MIN_SHARD_LIMIT
    || maxProviderRequestsPerShard > MAX_SHARD_LIMIT
  ) {
    return { ok: false, code: "AQ_BENCHMARK_QUOTA_LIMIT_INVALID" };
  }

  if (
    corpus.schemaVersion !== "origin.aq-benchmark-corpus.v1"
    || corpus.cases.length === 0
    || corpus.manifest.cases.length !== corpus.cases.length
    || new Set(corpus.cases.map((item) => item.caseId)).size !== corpus.cases.length
  ) {
    return { ok: false, code: "AQ_BENCHMARK_QUOTA_CORPUS_INVALID" };
  }

  const reconstructedManifest = createOriginAnswerQualityBenchmarkManifest(
    corpus.benchmarkId,
    corpus.benchmarkVersion,
    corpus.cases.map(({ caseId, category, caseDigest }) => ({
      caseId,
      category,
      caseDigest,
    })),
  );
  if (
    reconstructedManifest.ok === false
    || corpus.manifest.benchmarkId !== corpus.benchmarkId
    || corpus.manifest.benchmarkVersion !== corpus.benchmarkVersion
    || reconstructedManifest.value.manifestDigest !== corpus.manifest.manifestDigest
  ) {
    return { ok: false, code: "AQ_BENCHMARK_QUOTA_CORPUS_INVALID" };
  }

  const caseBudgets = corpus.cases.map(
    getOriginAnswerQualityBenchmarkQuotaCaseBudget,
  );
  const oversized = caseBudgets.find(
    (item) => item.pairedRequestsMax > maxProviderRequestsPerShard,
  );
  if (oversized) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_QUOTA_CASE_TOO_LARGE",
      caseId: oversized.caseId,
    };
  }

  // Deterministic first-fit-decreasing bin packing. The stable caseId
  // tie-breaker ensures the same frozen corpus and limit produce the same
  // shard plan on every machine.
  const ordered = [...caseBudgets].sort(
    (a, b) =>
      b.pairedRequestsMax - a.pairedRequestsMax
      || a.caseId.localeCompare(b.caseId),
  );

  const mutableShards: Array<{
    caseIds: string[];
    pairedRequestsMax: number;
  }> = [];

  for (const item of ordered) {
    let placed = false;
    for (const shard of mutableShards) {
      if (
        shard.pairedRequestsMax + item.pairedRequestsMax
        <= maxProviderRequestsPerShard
      ) {
        shard.caseIds.push(item.caseId);
        shard.pairedRequestsMax += item.pairedRequestsMax;
        placed = true;
        break;
      }
    }
    if (!placed) {
      mutableShards.push({
        caseIds: [item.caseId],
        pairedRequestsMax: item.pairedRequestsMax,
      });
    }
  }

  const shards = mutableShards.map((shard, index) => Object.freeze({
    shardIndex: index,
    caseIds: Object.freeze([...shard.caseIds].sort()),
    pairedRequestsMax: shard.pairedRequestsMax,
  }));

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-quota-plan.v1",
      benchmarkId: corpus.benchmarkId,
      benchmarkVersion: corpus.benchmarkVersion,
      maxProviderRequestsPerShard,
      fullComparisonRequestsMax: caseBudgets.reduce(
        (sum, item) => sum + item.pairedRequestsMax,
        0,
      ),
      caseBudgets: Object.freeze(caseBudgets),
      shards: Object.freeze(shards),
    }),
  };
}
