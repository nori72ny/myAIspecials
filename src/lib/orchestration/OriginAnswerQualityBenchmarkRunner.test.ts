import { describe, expect, it } from "vitest";

import type { OriginAnswerQualityBenchmarkObservation } from "./OriginAnswerQualityBenchmark";
import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import {
  digestOriginAnswerQualityBenchmarkCase,
  runOriginAnswerQualityBenchmark,
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
    verificationIntegrityScore: 1,
    failClosedAccuracyScore: 1,
    userActionabilityScore: 3,
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
});
