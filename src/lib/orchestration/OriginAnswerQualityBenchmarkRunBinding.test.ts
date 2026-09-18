import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import {
  bindOriginAnswerQualityBenchmarkRun,
  digestOriginAnswerQualityBenchmarkExecution,
} from "./OriginAnswerQualityBenchmarkRunBinding";
import { createOriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance";
import {
  digestOriginAnswerQualityBenchmarkCase,
  runOriginAnswerQualityBenchmark,
  type OriginAnswerQualityBenchmarkExecutableCase,
} from "./OriginAnswerQualityBenchmarkRunner";

async function fixture() {
  const cases: OriginAnswerQualityBenchmarkExecutableCase[] = Array.from({ length: 2 }, (_, index) => {
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
    "aq-bind-test",
    "v1",
    cases.map(({ caseId, category, caseDigest }) => ({ caseId, category, caseDigest })),
  );
  if (!manifest.ok) throw new Error("invalid manifest");

  const execution = await runOriginAnswerQualityBenchmark({
    manifest: manifest.value,
    cases,
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
    score: async (item, evidence) => ({
      caseId: item.caseId,
      category: item.category,
      factualSupportScore: 1,
      citationPrecisionScore: 1,
      taskCompletionScore: 1,
      contradictionDetectionScore: 1,
      verifierRejectedUnsupportedClaim: true,
      providerRequests: evidence.providerRequests,
      latencyMs: evidence.latencyMs,
      costUsd: evidence.costUsd,
      unsupportedMaterialClaimCount: 0,
    }),
  });
  if (!execution.ok) throw new Error("invalid execution");

  const provenance = createOriginAnswerQualityBenchmarkRunProvenance({
    runId: "aq-run-1",
    gitSha: "a".repeat(40),
    manifestDigest: manifest.value.manifestDigest,
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: "2026-09-19T00:00:00.000Z",
    completedAt: "2026-09-19T00:10:00.000Z",
  }, manifest.value);
  if (!provenance.ok) throw new Error("invalid provenance");

  return { manifest: manifest.value, execution: execution.value, provenance: provenance.value };
}

describe("OriginAnswerQualityBenchmarkRunBinding", () => {
  it("binds exact provenance to the measured execution digest", async () => {
    const { execution, provenance } = await fixture();
    const result = bindOriginAnswerQualityBenchmarkRun(provenance, execution);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executionDigest).toBe(digestOriginAnswerQualityBenchmarkExecution(execution));
    expect(result.value.caseCount).toBe(2);
    expect(result.value.totalProviderRequests).toBe(2);
    expect(result.value.totalToolCalls).toBe(4);
    expect(result.value.totalCostUsd).toBe(0);
  });

  it("rejects provenance for a different manifest", async () => {
    const { execution, provenance } = await fixture();
    const result = bindOriginAnswerQualityBenchmarkRun(
      { ...provenance, manifestDigest: `sha256:${"b".repeat(64)}` },
      execution,
    );

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_RUN_BINDING_MANIFEST_MISMATCH" });
  });

  it("rejects tampered aggregate totals", async () => {
    const { execution, provenance } = await fixture();
    const result = bindOriginAnswerQualityBenchmarkRun(
      provenance,
      { ...execution, totalProviderRequests: execution.totalProviderRequests + 1 },
    );

    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_RUN_BINDING_TOTALS_MISMATCH" });
  });

  it("changes the digest if any scored observation changes", async () => {
    const { execution } = await fixture();
    const first = digestOriginAnswerQualityBenchmarkExecution(execution);
    const tampered = {
      ...execution,
      scoredCases: execution.scoredCases.map((item, index) =>
        index === 0
          ? {
              ...item,
              observation: {
                ...item.observation,
                factualSupportScore: 0.5,
              },
            }
          : item
      ),
    };

    expect(digestOriginAnswerQualityBenchmarkExecution(tampered)).not.toBe(first);
  });
});
