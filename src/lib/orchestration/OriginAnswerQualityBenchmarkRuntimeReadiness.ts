import type {
  OriginAnswerQualityBenchmarkExecutionLane,
  OriginAnswerQualityBenchmarkLaneExecutors,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";

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
  readonly zeroCostRequired: true;
}

export function evaluateOriginAnswerQualityBenchmarkRuntimeReadiness(
  executors: OriginAnswerQualityBenchmarkLaneExecutors,
): OriginAnswerQualityBenchmarkRuntimeReadiness {
  const configuredLanes = ORIGIN_AQ_BENCHMARK_REQUIRED_LANES.filter(
    (lane) => typeof executors[lane] === "function",
  );
  const missingLanes = ORIGIN_AQ_BENCHMARK_REQUIRED_LANES.filter(
    (lane) => typeof executors[lane] !== "function",
  );

  return Object.freeze({
    schemaVersion: "origin.aq-benchmark-runtime-readiness.v1",
    ready: missingLanes.length === 0,
    configuredLanes: Object.freeze([...configuredLanes]),
    missingLanes: Object.freeze([...missingLanes]),
    zeroCostRequired: true,
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
