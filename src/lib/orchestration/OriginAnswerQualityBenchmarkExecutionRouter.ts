import type {
  OriginAnswerQualityBenchmarkCategory,
} from "./OriginAnswerQualityBenchmark.js";
import type {
  OriginAnswerQualityBenchmarkCaseExecutor,
  OriginAnswerQualityBenchmarkExecutableCase,
  OriginAnswerQualityBenchmarkExecutionEvidence,
} from "./OriginAnswerQualityBenchmarkRunner.js";
import type {
  OriginAnswerQualityBenchmarkRuntimeAdapter,
} from "./OriginAnswerQualityBenchmarkRuntimeAdapter.js";

export type OriginAnswerQualityBenchmarkExecutionLane =
  | "research"
  | "chat"
  | "coding"
  | "artifact";

export function resolveOriginAnswerQualityBenchmarkExecutionLane(
  category: OriginAnswerQualityBenchmarkCategory,
): OriginAnswerQualityBenchmarkExecutionLane {
  switch (category) {
    case "current-factual":
    case "multi-source-comparison":
    case "contradiction-detection":
      return "research";
    case "user-document-reasoning":
    case "professional-advice":
    case "ambiguity-handling":
    case "fail-closed":
    case "citation-precision":
      return "chat";
    case "coding-generation":
    case "coding-repair":
      return "coding";
    case "artifact-generation":
      return "artifact";
  }
}

export function resolveOriginAnswerQualityBenchmarkRequiredLanes(
  items: readonly Pick<OriginAnswerQualityBenchmarkExecutableCase, "category">[],
): readonly OriginAnswerQualityBenchmarkExecutionLane[] {
  const lanes = new Set<OriginAnswerQualityBenchmarkExecutionLane>();
  for (const item of items) {
    lanes.add(resolveOriginAnswerQualityBenchmarkExecutionLane(item.category));
  }
  return Object.freeze(
    (["research", "chat", "coding", "artifact"] as const)
      .filter((lane) => lanes.has(lane)),
  );
}

export interface OriginAnswerQualityBenchmarkLaneExecutors {
  readonly research?: OriginAnswerQualityBenchmarkRuntimeAdapter;
  readonly chat?: OriginAnswerQualityBenchmarkRuntimeAdapter;
  readonly coding?: OriginAnswerQualityBenchmarkRuntimeAdapter;
  readonly artifact?: OriginAnswerQualityBenchmarkRuntimeAdapter;
}

function unavailableEvidence(
  item: OriginAnswerQualityBenchmarkExecutableCase,
  lane: OriginAnswerQualityBenchmarkExecutionLane,
): OriginAnswerQualityBenchmarkExecutionEvidence {
  return Object.freeze({
    caseId: item.caseId,
    finalAnswerRef: null,
    evidenceLedgerRef: null,
    verifierResult: "BLOCKED_UNVERIFIED",
    providerRequests: 0,
    toolCalls: 0,
    latencyMs: 0,
    costUsd: 0,
    failureCode: `AQ_BENCHMARK_LANE_UNAVAILABLE:${lane}`,
  });
}

export function createOriginAnswerQualityBenchmarkLaneExecutor(
  executors: OriginAnswerQualityBenchmarkLaneExecutors,
): OriginAnswerQualityBenchmarkCaseExecutor {
  return async (item) => {
    const lane = resolveOriginAnswerQualityBenchmarkExecutionLane(item.category);
    const executor = executors[lane];
    if (!executor) return unavailableEvidence(item, lane);

    const result = await executor(item);
    if (result.caseId !== item.caseId) {
      throw new Error(`AQ_BENCHMARK_LANE_CASE_MISMATCH:${lane}`);
    }
    if (result.costUsd !== 0) {
      throw new Error(`AQ_BENCHMARK_LANE_NON_ZERO_COST:${lane}`);
    }
    return result;
  };
}
