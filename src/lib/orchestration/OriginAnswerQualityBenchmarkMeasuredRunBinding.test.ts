import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import {
  bindOriginAnswerQualityMeasuredObservations,
} from "./OriginAnswerQualityBenchmarkMeasuredRunBinding";
import { bindOriginAnswerQualityBenchmarkRun } from "./OriginAnswerQualityBenchmarkRunBinding";
import { createOriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance";
import {
  digestOriginAnswerQualityBenchmarkCase,
  runOriginAnswerQualityBenchmark,
  type OriginAnswerQualityBenchmarkExecutableCase,
} from "./OriginAnswerQualityBenchmarkRunner";
import type { OriginAnswerQualityBenchmarkMeasuredObservation } from "./OriginAnswerQualityBenchmarkScorecard";

async function fixture() {
  const cases: OriginAnswerQualityBenchmarkExecutableCase[] = Array.from({ length: 2 }, (_, index) => {
    const caseId = `case-${index + 1}`;
    const category = "fail-closed" as const;
    const prompt = `prompt-${index + 1}`;
    return {
      caseId,
      category,
      prompt,
      caseDigest: digestOriginAnswerQualityBenchmarkCase(caseId, category, prompt),
    };
  });

  const manifest = createOriginAnswerQualityBenchmarkManifest(
    "aq-measured-bind",
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
      toolCalls: 1,
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
    runId: "aq-measured-run",
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

  const bound = bindOriginAnswerQualityBenchmarkRun(provenance.value, execution.value);
  if (!bound.ok) throw new Error("invalid bound run");

  const measured: OriginAnswerQualityBenchmarkMeasuredObservation[] = bound.value.scoredCases.map((item) => ({
    ...item.observation,
    verificationIntegrityAccurate: true,
    failClosedCorrect: true,
    userActionabilityScore: 3,
  }));

  return { bound: bound.value, measured };
}

describe("OriginAnswerQualityBenchmarkMeasuredRunBinding", () => {
  it("binds VIR/FCA/UA to the exact scored execution", async () => {
    const { bound, measured } = await fixture();
    const result = bindOriginAnswerQualityMeasuredObservations(bound, measured);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.boundRun.executionDigest).toBe(bound.executionDigest);
    expect(result.value.measuredDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.value.measuredObservations).toHaveLength(2);
  });

  it("rejects a changed base quality score", async () => {
    const { bound, measured } = await fixture();
    const tampered = measured.map((item, index) =>
      index === 0 ? { ...item, factualSupportScore: 0.5 } : item
    );

    expect(bindOriginAnswerQualityMeasuredObservations(bound, tampered))
      .toEqual({ ok: false, code: "AQ_BENCHMARK_MEASURED_BINDING_BASE_MISMATCH" });
  });

  it("rejects duplicate or missing case measurements", async () => {
    const { bound, measured } = await fixture();
    const duplicate = [measured[0], measured[0]];

    expect(bindOriginAnswerQualityMeasuredObservations(bound, duplicate))
      .toEqual({ ok: false, code: "AQ_BENCHMARK_MEASURED_BINDING_CASESET_MISMATCH" });
  });

  it("changes measured digest when VIR/FCA/UA changes", async () => {
    const { bound, measured } = await fixture();
    const first = bindOriginAnswerQualityMeasuredObservations(bound, measured);
    const changed = bindOriginAnswerQualityMeasuredObservations(
      bound,
      measured.map((item, index) =>
        index === 0 ? { ...item, userActionabilityScore: 2 as const } : item
      ),
    );

    expect(first.ok).toBe(true);
    expect(changed.ok).toBe(true);
    if (!first.ok || !changed.ok) return;
    expect(changed.value.measuredDigest).not.toBe(first.value.measuredDigest);
  });
});
