import { describe, expect, it } from "vitest";

import type { OriginAnswerQualityBenchmarkObservation } from "./OriginAnswerQualityBenchmark";
import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import {
  digestOriginAnswerQualityBenchmarkCase,
  runOriginAnswerQualityBenchmark,
  runOriginAnswerQualityBenchmarkExecutionOnly,
  scoreOriginAnswerQualityBenchmarkExecution,
  type OriginAnswerQualityBenchmarkExecutableCase,
} from "./OriginAnswerQualityBenchmarkRunner";

function fixture() {
  const items: OriginAnswerQualityBenchmarkExecutableCase[] = Array.from({ length: 4 }, (_, index) => {
    const caseId = `case-${index + 1}`;
    const category = "current-factual" as const;
    const prompt = `prompt-${index + 1}`;
    return {
      caseId,
      category,
      prompt,
      caseDigest: digestOriginAnswerQualityBenchmarkCase(caseId, category, prompt),
    };
  });

  const manifest = createOriginAnswerQualityBenchmarkManifest(
    "aq-runner-test",
    "v1",
    items.map(({ caseId, category, caseDigest }) => ({ caseId, category, caseDigest })),
  );
  if (!manifest.ok) throw new Error("invalid manifest fixture");
  return { items, manifest: manifest.value };
}

function score(item: OriginAnswerQualityBenchmarkExecutableCase, providerRequests: number, latencyMs: number): OriginAnswerQualityBenchmarkObservation {
  return {
    caseId: item.caseId,
    category: item.category,
    factualSupportScore: 1,
    citationPrecisionScore: 1,
    taskCompletionScore: 1,
    contradictionDetectionScore: 1,
    verifierRejectedUnsupportedClaim: true,
    providerRequests,
    latencyMs,
    costUsd: 0,
    unsupportedMaterialClaimCount: 0,
  };
}

describe("OriginAnswerQualityBenchmarkRunner", () => {
  it("executes and scores the exact manifest-bound case set", async () => {
    const { items, manifest } = fixture();
    const result = await runOriginAnswerQualityBenchmark({
      manifest,
      cases: items,
      execute: async (item) => ({
        caseId: item.caseId,
        finalAnswerRef: `answer:${item.caseId}`,
        evidenceLedgerRef: `ledger:${item.caseId}`,
        verifierResult: "PASS",
        providerRequests: 1,
        toolCalls: 2,
        latencyMs: 100,
        costUsd: 0,
        failureCode: null,
      }),
      score: async (item, execution) => score(item, execution.providerRequests, execution.latencyMs),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.caseCount).toBe(4);
    expect(result.value.totalProviderRequests).toBe(4);
    expect(result.value.totalToolCalls).toBe(8);
    expect(result.value.totalLatencyMs).toBe(400);
    expect(result.value.totalCostUsd).toBe(0);
  });

  it("rejects prompt tampering even when case ID/category still match", async () => {
    const { items, manifest } = fixture();
    const tampered = items.map((item, index) => index === 0 ? { ...item, prompt: "changed" } : item);

    const result = await runOriginAnswerQualityBenchmark({
      manifest,
      cases: tampered,
      execute: async () => { throw new Error("must not execute"); },
      score: async () => { throw new Error("must not score"); },
    });

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_EXECUTION_CASE_DIGEST_MISMATCH" });
  });

  it("fails closed on non-zero measured cost", async () => {
    const { items, manifest } = fixture();

    const result = await runOriginAnswerQualityBenchmark({
      manifest,
      cases: items,
      execute: async (item) => ({
        caseId: item.caseId,
        finalAnswerRef: null,
        evidenceLedgerRef: null,
        verifierResult: "BLOCKED_UNVERIFIED",
        providerRequests: 1,
        toolCalls: 0,
        latencyMs: 100,
        costUsd: item.caseId === "case-2" ? 0.01 : 0,
        failureCode: item.caseId === "case-2" ? "NON_ZERO_COST" : null,
      }),
      score: async (item, execution) => score(item, execution.providerRequests, execution.latencyMs),
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_EXECUTION_INVALID_EVIDENCE",
      failedCaseId: "case-2",
    });
  });

  it("rejects scorer output that does not match measured execution", async () => {
    const { items, manifest } = fixture();

    const result = await runOriginAnswerQualityBenchmark({
      manifest,
      cases: items,
      execute: async (item) => ({
        caseId: item.caseId,
        finalAnswerRef: null,
        evidenceLedgerRef: null,
        verifierResult: "PASS",
        providerRequests: 1,
        toolCalls: 1,
        latencyMs: 100,
        costUsd: 0,
        failureCode: null,
      }),
      score: async (item) => score(item, 2, 100),
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_EXECUTION_INVALID_SCORE",
      failedCaseId: "case-1",
    });
  });

  it("stops on executor failure and does not synthesize later observations", async () => {
    const { items, manifest } = fixture();
    let calls = 0;

    const result = await runOriginAnswerQualityBenchmark({
      manifest,
      cases: items,
      execute: async (item) => {
        calls += 1;
        if (item.caseId === "case-2") throw new Error("executor failed");
        return {
          caseId: item.caseId,
          finalAnswerRef: null,
          evidenceLedgerRef: null,
          verifierResult: "PASS",
          providerRequests: 1,
          toolCalls: 0,
          latencyMs: 100,
          costUsd: 0,
          failureCode: null,
        };
      },
      score: async (item, execution) => score(item, execution.providerRequests, execution.latencyMs),
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_EXECUTION_FAILED",
      failedCaseId: "case-2",
    });
    expect(calls).toBe(2);
  });

  it("can freeze all execution evidence before any scoring occurs", async () => {
    const { items, manifest } = fixture();
    const executed: string[] = [];

    const execution = await runOriginAnswerQualityBenchmarkExecutionOnly({
      manifest,
      cases: items,
      execute: async (item) => {
        executed.push(item.caseId);
        return {
          caseId: item.caseId,
          finalAnswerRef: `answer:${item.caseId}`,
          evidenceLedgerRef: `ledger:${item.caseId}`,
          verifierResult: "PASS",
          providerRequests: 1,
          toolCalls: 1,
          latencyMs: 100,
          costUsd: 0,
          failureCode: null,
        };
      },
    });

    expect(executed).toEqual(items.map((item) => item.caseId));
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    expect(execution.value.executionOnlyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    let scoreCalls = 0;
    const scored = await scoreOriginAnswerQualityBenchmarkExecution({
      manifest,
      cases: items,
      execution: execution.value,
      score: async (item, evidence) => {
        scoreCalls += 1;
        return score(item, evidence.providerRequests, evidence.latencyMs);
      },
    });

    expect(scored.ok).toBe(true);
    expect(scoreCalls).toBe(4);
  });

  it("rejects a tampered frozen execution before the scorer runs", async () => {
    const { items, manifest } = fixture();
    const execution = await runOriginAnswerQualityBenchmarkExecutionOnly({
      manifest,
      cases: items,
      execute: async (item) => ({
        caseId: item.caseId,
        finalAnswerRef: `answer:${item.caseId}`,
        evidenceLedgerRef: `ledger:${item.caseId}`,
        verifierResult: "PASS",
        providerRequests: 1,
        toolCalls: 1,
        latencyMs: 100,
        costUsd: 0,
        failureCode: null,
      }),
    });
    if (!execution.ok) throw new Error("execution fixture failed");

    const tampered = {
      ...execution.value,
      executedCases: execution.value.executedCases.map((item, index) =>
        index === 0
          ? {
              ...item,
              execution: { ...item.execution, finalAnswerRef: "answer:tampered" },
            }
          : item
      ),
    };
    let scoreCalls = 0;
    const result = await scoreOriginAnswerQualityBenchmarkExecution({
      manifest,
      cases: items,
      execution: tampered,
      score: async (item, evidence) => {
        scoreCalls += 1;
        return score(item, evidence.providerRequests, evidence.latencyMs);
      },
    });

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_EXECUTION_INVALID_EVIDENCE" });
    expect(scoreCalls).toBe(0);
  });

  it("keeps the legacy one-call runner behavior equivalent to two-phase execution", async () => {
    const { items, manifest } = fixture();
    const execute = async (item: OriginAnswerQualityBenchmarkExecutableCase) => ({
      caseId: item.caseId,
      finalAnswerRef: `answer:${item.caseId}`,
      evidenceLedgerRef: `ledger:${item.caseId}`,
      verifierResult: "PASS" as const,
      providerRequests: 1,
      toolCalls: 2,
      latencyMs: 100,
      costUsd: 0,
      failureCode: null,
    });

    const frozen = await runOriginAnswerQualityBenchmarkExecutionOnly({
      manifest,
      cases: items,
      execute,
    });
    if (!frozen.ok) throw new Error("execution fixture failed");

    const twoPhase = await scoreOriginAnswerQualityBenchmarkExecution({
      manifest,
      cases: items,
      execution: frozen.value,
      score: async (item, evidence) => score(item, evidence.providerRequests, evidence.latencyMs),
    });
    const legacy = await runOriginAnswerQualityBenchmark({
      manifest,
      cases: items,
      execute,
      score: async (item, evidence) => score(item, evidence.providerRequests, evidence.latencyMs),
    });

    expect(twoPhase).toEqual(legacy);
  });

  it("distinguishes scorer failure from executor failure and preserves only safe AQ codes", async () => {
    const { items, manifest } = fixture();

    const safe = await runOriginAnswerQualityBenchmark({
      manifest,
      cases: items,
      execute: async (item) => ({
        caseId: item.caseId,
        finalAnswerRef: null,
        evidenceLedgerRef: null,
        verifierResult: "BLOCKED_UNVERIFIED",
        providerRequests: 0,
        toolCalls: 1,
        latencyMs: 10,
        costUsd: 0,
        failureCode: "AQ_BENCHMARK_RESEARCH_HTTP_503",
      }),
      score: async () => {
        throw new Error("AQ_BENCHMARK_OFFICIAL_SCORER_EPHEMERAL_EVIDENCE_MISSING");
      },
    });

    expect(safe).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SCORING_FAILED",
      failedCaseId: "case-1",
      failureDetail: "AQ_BENCHMARK_OFFICIAL_SCORER_EPHEMERAL_EVIDENCE_MISSING",
    });

    const unsafe = await runOriginAnswerQualityBenchmark({
      manifest,
      cases: items,
      execute: async (item) => ({
        caseId: item.caseId,
        finalAnswerRef: null,
        evidenceLedgerRef: null,
        verifierResult: "BLOCKED_UNVERIFIED",
        providerRequests: 0,
        toolCalls: 1,
        latencyMs: 10,
        costUsd: 0,
        failureCode: "AQ_BENCHMARK_RESEARCH_HTTP_503",
      }),
      score: async () => {
        throw new Error("provider said secret=should-not-escape");
      },
    });

    expect(unsafe).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_SCORING_FAILED",
      failedCaseId: "case-1",
    });
  });

  it("preserves a safe AQ executor failure code without exposing arbitrary details", async () => {
    const { items, manifest } = fixture();
    const result = await runOriginAnswerQualityBenchmarkExecutionOnly({
      manifest,
      cases: items,
      execute: async () => {
        throw new Error("AQ_BENCHMARK_RESEARCH_ZERO_COST_INVALID");
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_EXECUTION_FAILED",
      failedCaseId: "case-1",
      failureDetail: "AQ_BENCHMARK_RESEARCH_ZERO_COST_INVALID",
    });
  });
});
