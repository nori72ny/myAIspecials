import { describe, expect, it } from "vitest";

import {
  assertOriginAnswerQualityBenchmarkRuntimeReady,
  evaluateOriginAnswerQualityBenchmarkRuntimeReadiness,
} from "./OriginAnswerQualityBenchmarkRuntimeReadiness";
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

describe("OriginAnswerQualityBenchmarkRuntimeReadiness", () => {
  it("requires all four real execution lanes before an official benchmark may start", () => {
    const readiness = evaluateOriginAnswerQualityBenchmarkRuntimeReadiness({
      research: executor,
      chat: executor,
      coding: executor,
      artifact: executor,
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.configuredLanes).toEqual(["research", "chat", "coding", "artifact"]);
    expect(readiness.missingLanes).toEqual([]);
    expect(readiness.zeroCostRequired).toBe(true);
    expect(() => assertOriginAnswerQualityBenchmarkRuntimeReady({
      research: executor,
      chat: executor,
      coding: executor,
      artifact: executor,
    })).not.toThrow();
  });

  it("fails closed and lists missing lanes", () => {
    const readiness = evaluateOriginAnswerQualityBenchmarkRuntimeReadiness({
      research: executor,
      chat: executor,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.configuredLanes).toEqual(["research", "chat"]);
    expect(readiness.missingLanes).toEqual(["coding", "artifact"]);
    expect(() => assertOriginAnswerQualityBenchmarkRuntimeReady({
      research: executor,
      chat: executor,
    })).toThrow("AQ_BENCHMARK_RUNTIME_NOT_READY:coding,artifact");
  });
});
