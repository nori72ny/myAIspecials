import { describe, expect, it } from "vitest";

import {
  buildOriginAnswerQualityBenchmarkEvaluationBundle,
} from "./OriginAnswerQualityBenchmarkEvaluationBundle";
import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import {
  bindOriginAnswerQualityMeasuredObservations,
} from "./OriginAnswerQualityBenchmarkMeasuredRunBinding";
import {
  bindOriginAnswerQualityBenchmarkRun,
} from "./OriginAnswerQualityBenchmarkRunBinding";
import { createOriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance";
import {
  digestOriginAnswerQualityBenchmarkCase,
  runOriginAnswerQualityBenchmark,
  type OriginAnswerQualityBenchmarkExecutableCase,
} from "./OriginAnswerQualityBenchmarkRunner";
import {
  ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES,
} from "./OriginAnswerQualityBenchmarkQualification";

async function makeMeasuredRun(
  gitSha: string,
  runId: string,
  improveCurrentFactual: boolean,
) {
  const cases: OriginAnswerQualityBenchmarkExecutableCase[] =
    ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES.flatMap((category) =>
      Array.from({ length: 4 }, (_, index) => {
        const caseId = `${category}-${index + 1}`;
        const prompt = `prompt:${caseId}`;
        return {
          caseId,
          category,
          prompt,
          caseDigest: digestOriginAnswerQualityBenchmarkCase(caseId, category, prompt),
        };
      }),
    );

  const manifestResult = createOriginAnswerQualityBenchmarkManifest(
    "aq-post-heldout",
    "v1",
    cases.map(({ caseId, category, caseDigest }) => ({ caseId, category, caseDigest })),
  );
  if (!manifestResult.ok) throw new Error("invalid manifest");
  const manifest = manifestResult.value;

  const execution = await runOriginAnswerQualityBenchmark({
    manifest,
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
      factualSupportScore:
        improveCurrentFactual && item.category === "current-factual" ? 0.9 : 0.8,
      citationPrecisionScore: 0.8,
      taskCompletionScore: 0.8,
      contradictionDetectionScore: 0.8,
      verifierRejectedUnsupportedClaim: true,
      repairSucceeded: item.category === "coding-repair" ? true : undefined,
      providerRequests: evidence.providerRequests,
      latencyMs: evidence.latencyMs,
      costUsd: evidence.costUsd,
      unsupportedMaterialClaimCount: 0,
    }),
  });
  if (!execution.ok) throw new Error("invalid execution");

  const provenance = createOriginAnswerQualityBenchmarkRunProvenance({
    runId,
    gitSha,
    manifestDigest: manifest.manifestDigest,
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: "2026-09-19T00:00:00.000Z",
    completedAt: "2026-09-19T00:10:00.000Z",
  }, manifest);
  if (!provenance.ok) throw new Error("invalid provenance");

  const bound = bindOriginAnswerQualityBenchmarkRun(provenance.value, execution.value);
  if (!bound.ok) throw new Error("invalid bound run");

  const measured = bindOriginAnswerQualityMeasuredObservations(
    bound.value,
    bound.value.scoredCases.map((item) => ({
      ...item.observation,
      verificationIntegrityAccurate: true,
      failClosedCorrect: item.observation.category === "fail-closed" ? true : undefined,
      userActionabilityScore: 2 as const,
    })),
  );
  if (!measured.ok) throw new Error("invalid measured run");

  return { manifest, measured: measured.value };
}

describe("OriginAnswerQualityBenchmarkEvaluationBundle", () => {
  it("seals baseline/candidate execution and measured digests into one bundle", async () => {
    const baseline = await makeMeasuredRun("a".repeat(40), "baseline", false);
    const candidate = await makeMeasuredRun("b".repeat(40), "candidate", true);

    const result = buildOriginAnswerQualityBenchmarkEvaluationBundle(
      baseline.manifest,
      candidate.manifest,
      baseline.measured,
      candidate.measured,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.promotionEligible).toBe(true);
    expect(result.value.bundleDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.value.baselineExecutionDigest).toBe(baseline.measured.boundRun.executionDigest);
    expect(result.value.candidateMeasuredDigest).toBe(candidate.measured.measuredDigest);
  });

  it("rejects a baseline manifest that does not match the bound run", async () => {
    const baseline = await makeMeasuredRun("a".repeat(40), "baseline", false);
    const candidate = await makeMeasuredRun("b".repeat(40), "candidate", true);
    const wrong = {
      ...baseline.manifest,
      manifestDigest: `sha256:${"f".repeat(64)}`,
    };

    expect(buildOriginAnswerQualityBenchmarkEvaluationBundle(
      wrong,
      candidate.manifest,
      baseline.measured,
      candidate.measured,
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_BUNDLE_BASELINE_MANIFEST_MISMATCH",
    });
  });

  it("keeps a blocked promotion inside the sealed evidence bundle", async () => {
    const baseline = await makeMeasuredRun("a".repeat(40), "baseline", false);
    const candidate = await makeMeasuredRun("b".repeat(40), "candidate", false);

    const result = buildOriginAnswerQualityBenchmarkEvaluationBundle(
      baseline.manifest,
      candidate.manifest,
      baseline.measured,
      candidate.measured,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.promotionEligible).toBe(false);
    expect(result.value.decision.blockers).toContain("BASE_RELEASE_REPORT_BLOCKED");
  });
});
