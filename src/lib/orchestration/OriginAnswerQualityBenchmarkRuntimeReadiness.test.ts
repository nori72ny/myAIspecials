import { describe, expect, it } from "vitest";

import {
  assertOriginAnswerQualityBenchmarkRuntimeReady,
  evaluateOriginAnswerQualityBenchmarkRuntimeReadiness,
} from "./OriginAnswerQualityBenchmarkRuntimeReadiness";
import { createOriginAnswerQualityBenchmarkRuntimeAdapter } from "./OriginAnswerQualityBenchmarkRuntimeAdapter";
import type { OriginAnswerQualityBenchmarkCaseExecutor } from "./OriginAnswerQualityBenchmarkRunner";

const executor: OriginAnswerQualityBenchmarkCaseExecutor = async (item) => ({
  caseId: item.caseId,
  finalAnswerRef: null,
  evidenceLedgerRef: null,
  verifierResult: "BLOCKED_UNVERIFIED",
  providerRequests: 0,
  toolCalls: 0,
  latencyMs: 0,
  costUsd: 0,
  failureCode: "TEST",
});

const adapters = {
  research: createOriginAnswerQualityBenchmarkRuntimeAdapter("research", "grounded-research-v1.1", executor),
  chat: createOriginAnswerQualityBenchmarkRuntimeAdapter("chat", "origin-chat", executor),
  coding: createOriginAnswerQualityBenchmarkRuntimeAdapter("coding", "coding-v1.4", executor),
  artifact: createOriginAnswerQualityBenchmarkRuntimeAdapter("artifact", "artifact-v1.2", executor),
};

describe("OriginAnswerQualityBenchmarkRuntimeReadiness", () => {
  it("requires all four registered production runtime adapters before an official benchmark may start", () => {
    const readiness = evaluateOriginAnswerQualityBenchmarkRuntimeReadiness(adapters);

    expect(readiness.ready).toBe(true);
    expect(readiness.configuredLanes).toEqual(["research", "chat", "coding", "artifact"]);
    expect(readiness.missingLanes).toEqual([]);
    expect(readiness.zeroCostRequired).toBe(true);
    expect(readiness.productionPathRequired).toBe(true);
    expect(readiness.runtimeIds).toEqual({
      research: "grounded-research-v1.1",
      chat: "origin-chat",
      coding: "coding-v1.4",
      artifact: "artifact-v1.2",
    });
    expect(() => assertOriginAnswerQualityBenchmarkRuntimeReady(adapters)).not.toThrow();
  });

  it("fails closed and lists missing lanes", () => {
    const readiness = evaluateOriginAnswerQualityBenchmarkRuntimeReadiness({
      research: adapters.research,
      chat: adapters.chat,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.configuredLanes).toEqual(["research", "chat"]);
    expect(readiness.missingLanes).toEqual(["coding", "artifact"]);
    expect(() => assertOriginAnswerQualityBenchmarkRuntimeReady({
      research: adapters.research,
      chat: adapters.chat,
    })).toThrow("AQ_BENCHMARK_RUNTIME_NOT_READY:coding,artifact");
  });

  it("does not treat plain executor functions as official runtime readiness", () => {
    const readiness = evaluateOriginAnswerQualityBenchmarkRuntimeReadiness({
      research: executor as never,
      chat: executor as never,
      coding: executor as never,
      artifact: executor as never,
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.configuredLanes).toEqual([]);
  });

  it("accepts only the lanes required by a research-only shard", () => {
    const readiness = evaluateOriginAnswerQualityBenchmarkRuntimeReadiness(
      { research: adapters.research },
      ["research"],
    );

    expect(readiness.ready).toBe(true);
    expect(readiness.configuredLanes).toEqual(["research"]);
    expect(readiness.missingLanes).toEqual([]);
    expect(readiness.runtimeIds).toEqual({
      research: "grounded-research-v1.1",
    });
    expect(() => assertOriginAnswerQualityBenchmarkRuntimeReady(
      { research: adapters.research },
      ["research"],
    )).not.toThrow();
  });

  it("still fails closed if a required shard lane is missing", () => {
    expect(() => assertOriginAnswerQualityBenchmarkRuntimeReady(
      { research: adapters.research },
      ["research", "coding"],
    )).toThrow("AQ_BENCHMARK_RUNTIME_NOT_READY:coding");
  });
});
