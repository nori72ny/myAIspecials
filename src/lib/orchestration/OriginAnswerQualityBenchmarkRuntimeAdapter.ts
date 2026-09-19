import type {
  OriginAnswerQualityBenchmarkExecutionLane,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import type {
  OriginAnswerQualityBenchmarkCaseExecutor,
} from "./OriginAnswerQualityBenchmarkRunner.js";

export type OriginAnswerQualityBenchmarkRuntimeId =
  | "grounded-research-v1.1"
  | "origin-chat"
  | "coding-v1.4"
  | "artifact-v1.2";

export interface OriginAnswerQualityBenchmarkRuntimeAdapterMetadata {
  readonly lane: OriginAnswerQualityBenchmarkExecutionLane;
  readonly runtimeId: OriginAnswerQualityBenchmarkRuntimeId;
  readonly freeOnly: true;
  readonly productionPath: true;
}

const EXPECTED_RUNTIME: Readonly<Record<
  OriginAnswerQualityBenchmarkExecutionLane,
  OriginAnswerQualityBenchmarkRuntimeId
>> = Object.freeze({
  research: "grounded-research-v1.1",
  chat: "origin-chat",
  coding: "coding-v1.4",
  artifact: "artifact-v1.2",
});

const RUNTIME_METADATA = Symbol("origin.aq-benchmark-runtime-adapter");

export type OriginAnswerQualityBenchmarkRuntimeAdapter =
  OriginAnswerQualityBenchmarkCaseExecutor & {
    readonly [RUNTIME_METADATA]: OriginAnswerQualityBenchmarkRuntimeAdapterMetadata;
  };

export function createOriginAnswerQualityBenchmarkRuntimeAdapter(
  lane: OriginAnswerQualityBenchmarkExecutionLane,
  runtimeId: OriginAnswerQualityBenchmarkRuntimeId,
  execute: OriginAnswerQualityBenchmarkCaseExecutor,
): OriginAnswerQualityBenchmarkRuntimeAdapter {
  if (runtimeId !== EXPECTED_RUNTIME[lane]) {
    throw new Error(`AQ_BENCHMARK_RUNTIME_ID_MISMATCH:${lane}`);
  }

  const adapter = (async (item) => execute(item)) as OriginAnswerQualityBenchmarkRuntimeAdapter;
  Object.defineProperty(adapter, RUNTIME_METADATA, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      lane,
      runtimeId,
      freeOnly: true,
      productionPath: true,
    }),
  });
  return Object.freeze(adapter);
}

export function readOriginAnswerQualityBenchmarkRuntimeAdapterMetadata(
  value: unknown,
): OriginAnswerQualityBenchmarkRuntimeAdapterMetadata | null {
  if (typeof value !== "function") return null;
  const metadata = (value as Partial<OriginAnswerQualityBenchmarkRuntimeAdapter>)[RUNTIME_METADATA];
  if (
    !metadata
    || metadata.freeOnly !== true
    || metadata.productionPath !== true
    || EXPECTED_RUNTIME[metadata.lane] !== metadata.runtimeId
  ) {
    return null;
  }
  return metadata;
}
