import { describe, expect, it, vi } from "vitest";

import {
  createOriginAnswerQualityBenchmarkLaneExecutor,
  resolveOriginAnswerQualityBenchmarkExecutionLane,
} from "./OriginAnswerQualityBenchmarkExecutionRouter";
import { createOriginAnswerQualityBenchmarkRuntimeAdapter } from "./OriginAnswerQualityBenchmarkRuntimeAdapter";
import type { OriginAnswerQualityBenchmarkExecutableCase } from "./OriginAnswerQualityBenchmarkRunner";

function item(
  category: OriginAnswerQualityBenchmarkExecutableCase["category"],
): OriginAnswerQualityBenchmarkExecutableCase {
  return {
    caseId: `case-${category}`,
    category,
    prompt: "prompt",
    caseDigest: `sha256:${"a".repeat(64)}`,
  };
}

describe("OriginAnswerQualityBenchmarkExecutionRouter", () => {
  it("routes the ten frozen benchmark families to the intended product lanes", () => {
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("current-factual")).toBe("research");
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("multi-source-comparison")).toBe("research");
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("contradiction-detection")).toBe("research");
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("user-document-reasoning")).toBe("chat");
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("professional-advice")).toBe("chat");
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("coding-generation")).toBe("coding");
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("coding-repair")).toBe("coding");
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("artifact-generation")).toBe("artifact");
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("ambiguity-handling")).toBe("chat");
    expect(resolveOriginAnswerQualityBenchmarkExecutionLane("fail-closed")).toBe("chat");
  });

  it("fails closed when a required execution lane is unavailable", async () => {
    const execute = createOriginAnswerQualityBenchmarkLaneExecutor({});
    const result = await execute(item("current-factual"));

    expect(result).toEqual({
      caseId: "case-current-factual",
      finalAnswerRef: null,
      evidenceLedgerRef: null,
      verifierResult: "BLOCKED_UNVERIFIED",
      providerRequests: 0,
      toolCalls: 0,
      latencyMs: 0,
      costUsd: 0,
      failureCode: "AQ_BENCHMARK_LANE_UNAVAILABLE:research",
    });
  });

  it("dispatches to the configured lane executor", async () => {
    const research = vi.fn(async (caseItem: OriginAnswerQualityBenchmarkExecutableCase) => ({
      caseId: caseItem.caseId,
      finalAnswerRef: "answer:1",
      evidenceLedgerRef: "ledger:1",
      verifierResult: "PASS" as const,
      providerRequests: 1,
      toolCalls: 2,
      latencyMs: 100,
      costUsd: 0,
      failureCode: null,
    }));
    const execute = createOriginAnswerQualityBenchmarkLaneExecutor({
      research: createOriginAnswerQualityBenchmarkRuntimeAdapter(
        "research",
        "grounded-research-v1.1",
        research,
      ),
    });

    const result = await execute(item("multi-source-comparison"));

    expect(research).toHaveBeenCalledTimes(1);
    expect(result.verifierResult).toBe("PASS");
    expect(result.costUsd).toBe(0);
  });

  it("rejects a lane executor that returns the wrong case identity", async () => {
    const chat = async () => ({
      caseId: "other-case",
      finalAnswerRef: "answer:other",
      evidenceLedgerRef: null,
      verifierResult: "PASS" as const,
      providerRequests: 1,
      toolCalls: 0,
      latencyMs: 100,
      costUsd: 0,
      failureCode: null,
    });
    const execute = createOriginAnswerQualityBenchmarkLaneExecutor({
      chat: createOriginAnswerQualityBenchmarkRuntimeAdapter("chat", "origin-chat", chat),
    });

    const result = await execute(item("professional-advice"));

    expect(result.verifierResult).toBe("BLOCKED_UNVERIFIED");
    expect(result.failureCode).toBe("AQ_BENCHMARK_LANE_CASE_MISMATCH:chat");
  });

  it("fails closed if a lane reports non-zero cost", async () => {
    const coding = async (caseItem: OriginAnswerQualityBenchmarkExecutableCase) => ({
      caseId: caseItem.caseId,
      finalAnswerRef: "answer:1",
      evidenceLedgerRef: null,
      verifierResult: "PASS" as const,
      providerRequests: 1,
      toolCalls: 1,
      latencyMs: 100,
      costUsd: 0.01,
      failureCode: null,
    });
    const execute = createOriginAnswerQualityBenchmarkLaneExecutor({
      coding: createOriginAnswerQualityBenchmarkRuntimeAdapter("coding", "coding-v1.4", coding),
    });

    const result = await execute(item("coding-generation"));

    expect(result.verifierResult).toBe("BLOCKED_UNVERIFIED");
    expect(result.costUsd).toBe(0);
    expect(result.failureCode).toBe("AQ_BENCHMARK_LANE_NON_ZERO_COST:coding");
  });
});
