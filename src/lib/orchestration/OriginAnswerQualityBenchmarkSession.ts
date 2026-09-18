import {
  createOriginAnswerQualityFrozenCorpus,
  type OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import {
  createOriginAnswerQualityBenchmarkLaneExecutor,
  type OriginAnswerQualityBenchmarkLaneExecutors,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import {
  bindOriginAnswerQualityMeasuredObservations,
  type OriginAnswerQualityBenchmarkMeasuredBoundRun,
} from "./OriginAnswerQualityBenchmarkMeasuredRunBinding.js";
import {
  bindOriginAnswerQualityBenchmarkRun,
} from "./OriginAnswerQualityBenchmarkRunBinding.js";
import {
  createOriginAnswerQualityBenchmarkRunProvenance,
} from "./OriginAnswerQualityBenchmarkRunProvenance.js";
import {
  assertOriginAnswerQualityBenchmarkRuntimeReady,
} from "./OriginAnswerQualityBenchmarkRuntimeReadiness.js";
import {
  runOriginAnswerQualityBenchmark,
  type OriginAnswerQualityBenchmarkExecutableCase,
  type OriginAnswerQualityBenchmarkExecutionEvidence,
} from "./OriginAnswerQualityBenchmarkRunner.js";
import {
  scoreOriginAnswerQualityBenchmarkEvidence,
  type OriginAnswerQualityBenchmarkScoringEvidence,
} from "./OriginAnswerQualityBenchmarkScoring.js";
import {
  buildOriginAnswerQualityBenchmarkScorecard,
  type OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard.js";

export type OriginAnswerQualityBenchmarkScoringEvidenceCollector = (
  item: OriginAnswerQualityBenchmarkExecutableCase,
  execution: OriginAnswerQualityBenchmarkExecutionEvidence,
) => Promise<OriginAnswerQualityBenchmarkScoringEvidence>;

export interface OriginAnswerQualityBenchmarkSessionInput {
  readonly runId: string;
  readonly gitSha: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly executors: OriginAnswerQualityBenchmarkLaneExecutors;
  readonly collectScoringEvidence: OriginAnswerQualityBenchmarkScoringEvidenceCollector;
  readonly nowMs?: () => number;
  readonly corpus?: OriginAnswerQualityBenchmarkFrozenCorpus;
}

export interface OriginAnswerQualityBenchmarkSessionSuccess {
  readonly schemaVersion: "origin.aq-benchmark-session.v1";
  readonly corpus: OriginAnswerQualityBenchmarkFrozenCorpus;
  readonly measuredRun: OriginAnswerQualityBenchmarkMeasuredBoundRun;
}

export type OriginAnswerQualityBenchmarkSessionResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkSessionSuccess }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_SESSION_RUNTIME_NOT_READY"
        | "AQ_BENCHMARK_SESSION_EXECUTION_FAILED"
        | "AQ_BENCHMARK_SESSION_PROVENANCE_INVALID"
        | "AQ_BENCHMARK_SESSION_RUN_BINDING_FAILED"
        | "AQ_BENCHMARK_SESSION_SCORECARD_INVALID"
        | "AQ_BENCHMARK_SESSION_MEASURED_BINDING_FAILED";
      detail?: string;
    };

export async function runOriginAnswerQualityBenchmarkSession(
  input: OriginAnswerQualityBenchmarkSessionInput,
): Promise<OriginAnswerQualityBenchmarkSessionResult> {
  try {
    assertOriginAnswerQualityBenchmarkRuntimeReady(input.executors);
  } catch (error) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_RUNTIME_NOT_READY",
      detail: error instanceof Error ? error.message : undefined,
    };
  }

  const corpus = input.corpus ?? createOriginAnswerQualityFrozenCorpus();
  const nowMs = input.nowMs ?? Date.now;
  const startedAtMs = nowMs();
  const measuredById = new Map<string, OriginAnswerQualityBenchmarkMeasuredObservation>();

  const execution = await runOriginAnswerQualityBenchmark({
    manifest: corpus.manifest,
    cases: corpus.cases,
    execute: createOriginAnswerQualityBenchmarkLaneExecutor(input.executors),
    score: async (item, evidence) => {
      const rawEvidence = await input.collectScoringEvidence(item, evidence);
      const measured = scoreOriginAnswerQualityBenchmarkEvidence(evidence, rawEvidence);
      if (measured.ok === false) throw new Error(measured.code);
      measuredById.set(item.caseId, measured.value);
      return measured.value;
    },
  });

  if (execution.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_EXECUTION_FAILED",
      detail: execution.failedCaseId
        ? `${execution.code}:${execution.failedCaseId}`
        : execution.code,
    };
  }

  const completedAtMs = nowMs();
  const provenance = createOriginAnswerQualityBenchmarkRunProvenance({
    runId: input.runId,
    gitSha: input.gitSha,
    manifestDigest: corpus.manifest.manifestDigest,
    providerId: input.providerId,
    modelId: input.modelId,
    freeOnly: true,
    totalCostUsd: 0,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
  }, corpus.manifest);

  if (provenance.ok === false) {
    return { ok: false, code: "AQ_BENCHMARK_SESSION_PROVENANCE_INVALID" };
  }

  const boundRun = bindOriginAnswerQualityBenchmarkRun(provenance.value, execution.value);
  if (boundRun.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_RUN_BINDING_FAILED",
      detail: boundRun.code,
    };
  }

  const measuredObservations = corpus.cases.map((item) => measuredById.get(item.caseId))
    .filter((item): item is OriginAnswerQualityBenchmarkMeasuredObservation => item !== undefined);

  const scorecard = buildOriginAnswerQualityBenchmarkScorecard(
    corpus.manifest,
    measuredObservations,
  );
  if (scorecard.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_SCORECARD_INVALID",
      detail: scorecard.code,
    };
  }

  const measuredRun = bindOriginAnswerQualityMeasuredObservations(
    boundRun.value,
    measuredObservations,
  );
  if (measuredRun.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_SESSION_MEASURED_BINDING_FAILED",
      detail: measuredRun.code,
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-session.v1",
      corpus,
      measuredRun: measuredRun.value,
    }),
  };
}
