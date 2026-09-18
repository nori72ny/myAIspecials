import {
  buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle,
  type OriginAnswerQualityOfficialBenchmarkEvaluationBundle,
} from "./OriginAnswerQualityOfficialBenchmarkEvaluationBundle.js";
import type {
  OriginAnswerQualityOfficialBenchmarkSessionResult,
  OriginAnswerQualityOfficialProviderScoredSessionInput,
} from "./OriginAnswerQualityOfficialBenchmarkSession.js";
import {
  runOriginAnswerQualityOfficialProviderScoredSession,
} from "./OriginAnswerQualityOfficialBenchmarkSession.js";
import type {
  OriginAnswerQualityBenchmarkEnvironmentProof,
} from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";

export interface OriginAnswerQualityOfficialComparisonTarget {
  readonly runId: string;
  readonly gitSha: string;
  readonly environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof;
  readonly sourceRoot: string;
}

export interface OriginAnswerQualityOfficialProviderComparisonInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly nowMs?: () => number;
  readonly evaluatorPlanningOptions?:
    OriginAnswerQualityOfficialProviderScoredSessionInput["evaluatorPlanningOptions"];
  readonly baseline: OriginAnswerQualityOfficialComparisonTarget;
  readonly candidate: OriginAnswerQualityOfficialComparisonTarget;
}

export interface OriginAnswerQualityOfficialProviderComparisonSuccess {
  readonly schemaVersion: "origin.aq-official-provider-comparison.v1";
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly baselineGitSha: string;
  readonly candidateGitSha: string;
  readonly officialEvaluation: OriginAnswerQualityOfficialBenchmarkEvaluationBundle;
}

export type OriginAnswerQualityOfficialProviderComparisonResult =
  | { ok: true; value: OriginAnswerQualityOfficialProviderComparisonSuccess }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_OFFICIAL_COMPARISON_INVALID_INPUT"
        | "AQ_BENCHMARK_OFFICIAL_BASELINE_FAILED"
        | "AQ_BENCHMARK_OFFICIAL_CANDIDATE_FAILED"
        | "AQ_BENCHMARK_OFFICIAL_COMPARISON_EVALUATION_FAILED";
      detail?: string;
    };

export interface OriginAnswerQualityOfficialProviderComparisonSessionRunner {
  (input: OriginAnswerQualityOfficialProviderScoredSessionInput):
    Promise<OriginAnswerQualityOfficialBenchmarkSessionResult>;
}

const SHA40 = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;

function validTarget(target: OriginAnswerQualityOfficialComparisonTarget): boolean {
  return SAFE_ID.test(target.runId)
    && SHA40.test(target.gitSha)
    && target.sourceRoot.trim().length > 0
    && target.environmentProof.expectedGitSha === target.gitSha
    && target.environmentProof.observedReleaseSha === target.gitSha
    && target.environmentProof.freeOnly === true
    && target.environmentProof.costUsd === 0
    && target.environmentProof.paidFallbackEnabled === false;
}

function toSessionInput(
  input: OriginAnswerQualityOfficialProviderComparisonInput,
  target: OriginAnswerQualityOfficialComparisonTarget,
): OriginAnswerQualityOfficialProviderScoredSessionInput {
  return {
    runId: target.runId,
    gitSha: target.gitSha,
    providerId: input.providerId,
    modelId: input.modelId,
    environmentProof: target.environmentProof,
    sourceRoot: target.sourceRoot,
    env: input.env,
    fetchImpl: input.fetchImpl,
    nowMs: input.nowMs,
    evaluatorPlanningOptions: input.evaluatorPlanningOptions,
  };
}

function failureDetail(
  result: Exclude<OriginAnswerQualityOfficialBenchmarkSessionResult, { ok: true }>,
): string {
  const detail = "detail" in result && typeof result.detail === "string"
    ? result.detail
    : "";
  return detail ? `${result.code}:${detail}` : result.code;
}

export async function runOriginAnswerQualityOfficialProviderComparisonHarness(
  input: OriginAnswerQualityOfficialProviderComparisonInput,
  runSession: OriginAnswerQualityOfficialProviderComparisonSessionRunner,
): Promise<OriginAnswerQualityOfficialProviderComparisonResult> {
  if (
    !SAFE_ID.test(input.providerId)
    || !SAFE_ID.test(input.modelId)
    || !validTarget(input.baseline)
    || !validTarget(input.candidate)
    || input.baseline.runId === input.candidate.runId
    || input.baseline.gitSha === input.candidate.gitSha
  ) {
    return { ok: false, code: "AQ_BENCHMARK_OFFICIAL_COMPARISON_INVALID_INPUT" };
  }

  const baseline = await runSession(toSessionInput(input, input.baseline));
  if (baseline.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_BASELINE_FAILED",
      detail: failureDetail(baseline),
    };
  }

  const candidate = await runSession(toSessionInput(input, input.candidate));
  if (candidate.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_CANDIDATE_FAILED",
      detail: failureDetail(candidate),
    };
  }

  const evaluation = buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle(
    baseline.value,
    candidate.value,
  );
  if (evaluation.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_COMPARISON_EVALUATION_FAILED",
      detail: evaluation.code,
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-official-provider-comparison.v1",
      baselineRunId: input.baseline.runId,
      candidateRunId: input.candidate.runId,
      baselineGitSha: input.baseline.gitSha,
      candidateGitSha: input.candidate.gitSha,
      officialEvaluation: evaluation.value,
    }),
  };
}

/**
 * Highest-level public AQ before/after runner.
 *
 * Evaluator selection, evaluator model routing, scorer revision, claim extraction,
 * prompt entailment, semantic judging and source claim assessment are all
 * constructed internally by the provider-scored session entrypoint.
 */
export async function runOriginAnswerQualityOfficialProviderComparison(
  input: OriginAnswerQualityOfficialProviderComparisonInput,
): Promise<OriginAnswerQualityOfficialProviderComparisonResult> {
  return runOriginAnswerQualityOfficialProviderComparisonHarness(
    input,
    runOriginAnswerQualityOfficialProviderScoredSession,
  );
}
