import type {
  OriginAnswerQualityBenchmarkExecutionLane,
  OriginAnswerQualityBenchmarkLaneExecutors,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import {
  readOriginAnswerQualityBenchmarkRuntimeAdapterMetadata,
  type OriginAnswerQualityBenchmarkRuntimeId,
} from "./OriginAnswerQualityBenchmarkRuntimeAdapter.js";

export const ORIGIN_AQ_BENCHMARK_REQUIRED_LANES = Object.freeze([
  "research",
  "chat",
  "coding",
  "artifact",
] as const satisfies readonly OriginAnswerQualityBenchmarkExecutionLane[]);

export interface OriginAnswerQualityBenchmarkRuntimeReadiness {
  readonly schemaVersion: "origin.aq-benchmark-runtime-readiness.v1";
  readonly ready: boolean;
  readonly configuredLanes: readonly OriginAnswerQualityBenchmarkExecutionLane[];
  readonly missingLanes: readonly OriginAnswerQualityBenchmarkExecutionLane[];
  readonly runtimeIds: Readonly<Partial<Record<OriginAnswerQualityBenchmarkExecutionLane, OriginAnswerQualityBenchmarkRuntimeId>>>;
  readonly zeroCostRequired: true;
  readonly productionPathRequired: true;
}

export function evaluateOriginAnswerQualityBenchmarkRuntimeReadiness(
  executors: OriginAnswerQualityBenchmarkLaneExecutors,
): OriginAnswerQualityBenchmarkRuntimeReadiness {
  const metadataByLane = Object.fromEntries(
    ORIGIN_AQ_BENCHMARK_REQUIRED_LANES.map((lane) => [
      lane,
      readOriginAnswerQualityBenchmarkRuntimeAdapterMetadata(executors[lane]),
    ]),
  ) as Record<OriginAnswerQualityBenchmarkExecutionLane, ReturnType<typeof readOriginAnswerQualityBenchmarkRuntimeAdapterMetadata>>;

  const configuredLanes = ORIGIN_AQ_BENCHMARK_REQUIRED_LANES.filter(
    (lane) => metadataByLane[lane]?.lane === lane,
  );
  const missingLanes = ORIGIN_AQ_BENCHMARK_REQUIRED_LANES.filter(
    (lane) => metadataByLane[lane]?.lane !== lane,
  );
  const runtimeIds = Object.fromEntries(
    configuredLanes.map((lane) => [lane, metadataByLane[lane]!.runtimeId]),
  ) as Partial<Record<OriginAnswerQualityBenchmarkExecutionLane, OriginAnswerQualityBenchmarkRuntimeId>>;

  return Object.freeze({
    schemaVersion: "origin.aq-benchmark-runtime-readiness.v1",
    ready: missingLanes.length === 0,
    configuredLanes: Object.freeze([...configuredLanes]),
    missingLanes: Object.freeze([...missingLanes]),
    runtimeIds: Object.freeze(runtimeIds),
    zeroCostRequired: true,
    productionPathRequired: true,
  });
}

export function assertOriginAnswerQualityBenchmarkRuntimeReady(
  executors: OriginAnswerQualityBenchmarkLaneExecutors,
): void {
  const readiness = evaluateOriginAnswerQualityBenchmarkRuntimeReadiness(executors);
  if (!readiness.ready) {
    throw new Error(
      `AQ_BENCHMARK_RUNTIME_NOT_READY:${readiness.missingLanes.join(",")}`,
    );
  }
}
