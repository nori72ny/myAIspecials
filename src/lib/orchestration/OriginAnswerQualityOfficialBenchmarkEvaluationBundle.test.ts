import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import { bindOriginAnswerQualityMeasuredObservations } from "./OriginAnswerQualityBenchmarkMeasuredRunBinding";
import { bindOriginAnswerQualityBenchmarkRun } from "./OriginAnswerQualityBenchmarkRunBinding";
import { createOriginAnswerQualityBenchmarkRunProvenance } from "./OriginAnswerQualityBenchmarkRunProvenance";
import { runOriginAnswerQualityBenchmark } from "./OriginAnswerQualityBenchmarkRunner";
import {
  buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle,
} from "./OriginAnswerQualityOfficialBenchmarkEvaluationBundle";
import type {
  OriginAnswerQualityOfficialBenchmarkSessionSuccess,
  OriginAnswerQualityOfficialBenchmarkScorerProvenance,
} from "./OriginAnswerQualityOfficialBenchmarkSession";

const scorer: OriginAnswerQualityOfficialBenchmarkScorerProvenance = {
  schemaVersion: "origin.aq-benchmark-scorer.v1",
  scorerId: "origin-aq-public-deterministic-v1",
  scorerRevision: `sha256:${"c".repeat(64)}`,
  corpusId: "aq-post-heldout-public",
  corpusVersion: "v1",
};

async function session(
  gitSha: string,
  runId: string,
  improveCurrentFactual: boolean,
  scorerRevision = scorer.scorerRevision,
): Promise<OriginAnswerQualityOfficialBenchmarkSessionSuccess> {
  const corpus = createOriginAnswerQualityFrozenCorpus();
  const execution = await runOriginAnswerQualityBenchmark({
    manifest: corpus.manifest,
    cases: corpus.cases,
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
      costUsd: 0,
      unsupportedMaterialClaimCount: 0,
    }),
  });
  if (!execution.ok) throw new Error("execution fixture failed");

  const provenance = createOriginAnswerQualityBenchmarkRunProvenance({
    runId,
    gitSha,
    manifestDigest: corpus.manifest.manifestDigest,
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: "2026-09-19T00:00:00.000Z",
    completedAt: "2026-09-19T00:10:00.000Z",
  }, corpus.manifest);
  if (!provenance.ok) throw new Error("provenance fixture failed");

  const bound = bindOriginAnswerQualityBenchmarkRun(provenance.value, execution.value);
  if (!bound.ok) throw new Error("bound fixture failed");

  const measured = bindOriginAnswerQualityMeasuredObservations(
    bound.value,
    bound.value.scoredCases.map((item) => ({
      ...item.observation,
      verificationIntegrityAccurate: true,
      failClosedCorrect: item.observation.category === "fail-closed" ? true : undefined,
      userActionabilityScore: 2 as const,
    })),
  );
  if (!measured.ok) throw new Error("measured fixture failed");

  const scorerProvenance = { ...scorer, scorerRevision };
  const scorerProvenanceDigest = `sha256:${scorerRevision.slice("sha256:".length)}`;

  return {
    schemaVersion: "origin.aq-benchmark-session.v1",
    corpus,
    measuredRun: measured.value,
    scorerProvenance,
    scorerProvenanceDigest,
  };
}

describe("OriginAnswerQualityOfficialBenchmarkEvaluationBundle", () => {
  it("seals scorer identity together with baseline/candidate evaluation", async () => {
    const baseline = await session("a".repeat(40), "baseline", false);
    const candidate = await session("b".repeat(40), "candidate", true);

    const result = buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle(baseline, candidate);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluation.decision.promotionEligible).toBe(true);
    expect(result.value.scorerProvenance.scorerRevision).toBe(scorer.scorerRevision);
    expect(result.value.officialBundleDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed if baseline and candidate use different scorer revisions", async () => {
    const baseline = await session("a".repeat(40), "baseline", false);
    const candidate = await session(
      "b".repeat(40),
      "candidate",
      true,
      `sha256:${"d".repeat(64)}`,
    );

    expect(buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle(
      baseline,
      candidate,
    )).toEqual({ ok: false, code: "AQ_BENCHMARK_OFFICIAL_SCORER_MISMATCH" });
  });

  it("fails closed if scorer provenance digest is altered", async () => {
    const baseline = await session("a".repeat(40), "baseline", false);
    const candidate = await session("b".repeat(40), "candidate", true);
    const tampered = {
      ...candidate,
      scorerProvenanceDigest: `sha256:${"e".repeat(64)}`,
    };

    expect(buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle(
      baseline,
      tampered,
    )).toEqual({ ok: false, code: "AQ_BENCHMARK_OFFICIAL_SCORER_MISMATCH" });
  });

  it("fails closed if the frozen corpus identity changes", async () => {
    const baseline = await session("a".repeat(40), "baseline", false);
    const candidate = await session("b".repeat(40), "candidate", true);
    const changed = {
      ...candidate,
      corpus: {
        ...candidate.corpus,
        benchmarkVersion: "v2" as "v1",
      },
    };

    expect(buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle(
      baseline,
      changed,
    )).toEqual({ ok: false, code: "AQ_BENCHMARK_OFFICIAL_CORPUS_MISMATCH" });
  });
});
