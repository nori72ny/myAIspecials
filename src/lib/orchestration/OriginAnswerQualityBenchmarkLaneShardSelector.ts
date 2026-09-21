import type {
  OriginAnswerQualityBenchmarkExecutionLane,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import {
  resolveOriginAnswerQualityBenchmarkRequiredLanes,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import type {
  OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import type {
  OriginAnswerQualityBenchmarkQuotaPlan,
  OriginAnswerQualityBenchmarkQuotaShard,
} from "./OriginAnswerQualityBenchmarkQuotaPlan.js";

export type OriginAnswerQualityBenchmarkLaneShardSelectionResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkQuotaShard }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_LANE_SHARD_INVALID_INPUT"
        | "AQ_BENCHMARK_LANE_SHARD_NOT_FOUND";
    };

const LANE_ORDER: readonly OriginAnswerQualityBenchmarkExecutionLane[] = [
  "research",
  "chat",
  "coding",
  "artifact",
];

function normalizeLanes(
  lanes: readonly OriginAnswerQualityBenchmarkExecutionLane[],
): readonly OriginAnswerQualityBenchmarkExecutionLane[] | null {
  const seen = new Set<OriginAnswerQualityBenchmarkExecutionLane>();
  for (const lane of lanes) {
    if (!LANE_ORDER.includes(lane) || seen.has(lane)) return null;
    seen.add(lane);
  }
  if (seen.size === 0) return null;
  return Object.freeze(LANE_ORDER.filter((lane) => seen.has(lane)));
}

function sameLanes(
  left: readonly OriginAnswerQualityBenchmarkExecutionLane[],
  right: readonly OriginAnswerQualityBenchmarkExecutionLane[],
): boolean {
  return left.length === right.length
    && left.every((lane, index) => lane === right[index]);
}

export function selectOriginAnswerQualityBenchmarkQuotaShardForLanes(
  corpus: OriginAnswerQualityBenchmarkFrozenCorpus,
  plan: OriginAnswerQualityBenchmarkQuotaPlan,
  requiredLanes: readonly OriginAnswerQualityBenchmarkExecutionLane[],
): OriginAnswerQualityBenchmarkLaneShardSelectionResult {
  const normalized = normalizeLanes(requiredLanes);
  if (
    !normalized
    || plan.benchmarkId !== corpus.benchmarkId
    || plan.benchmarkVersion !== corpus.benchmarkVersion
    || plan.shards.length === 0
  ) {
    return { ok: false, code: "AQ_BENCHMARK_LANE_SHARD_INVALID_INPUT" };
  }

  const byId = new Map(corpus.cases.map((item) => [item.caseId, item] as const));

  for (const shard of plan.shards) {
    const cases = shard.caseIds.map((caseId) => byId.get(caseId));
    if (
      cases.some((item) => item === undefined)
      || new Set(shard.caseIds).size !== shard.caseIds.length
    ) {
      return { ok: false, code: "AQ_BENCHMARK_LANE_SHARD_INVALID_INPUT" };
    }

    const lanes = resolveOriginAnswerQualityBenchmarkRequiredLanes(
      cases as NonNullable<(typeof cases)[number]>[],
    );
    if (sameLanes(lanes, normalized)) {
      return { ok: true, value: shard };
    }
  }

  return { ok: false, code: "AQ_BENCHMARK_LANE_SHARD_NOT_FOUND" };
}
