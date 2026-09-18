import {
  buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle,
  type OriginAnswerQualityOfficialBenchmarkEvaluationBundle,
} from "./OriginAnswerQualityOfficialBenchmarkEvaluationBundle.js";
import type {
  OriginAnswerQualityOfficialBenchmarkSessionInput,
  OriginAnswerQualityOfficialBenchmarkSessionResult,
  OriginAnswerQualityOfficialBenchmarkScorerProvenance,
} from "./OriginAnswerQualityOfficialBenchmarkSession.js";
import {
  runOriginAnswerQualityOfficialBenchmarkSession,
} from "./OriginAnswerQualityOfficialBenchmarkSession.js";
import type { OriginClaimAssessor } from "./OriginClaimAssessor.js";
import type { OriginMaterialClaimExtractor } from "./OriginMaterialClaimExtractor.js";
import type {
  OriginAnswerQualityBenchmarkPromptClaimJudge,
} from "./OriginAnswerQualityBenchmarkPromptClaimJudge.js";
import type {
  OriginAnswerQualityBenchmarkSemanticJudge,
} from "./OriginAnswerQualityBenchmarkSemanticJudge.js";
import type {
  OriginAnswerQualityBenchmarkEnvironmentProof,
} from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";

export interface OriginAnswerQualityOfficialComparisonTarget {
  readonly runId: string;
  readonly gitSha: string;
  readonly environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof;
  readonly sourceRoot: string;
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
  readonly nowMs?: () => number;
}

export interface OriginAnswerQualityOfficialComparisonInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly scorerProvenance: OriginAnswerQualityOfficialBenchmarkScorerProvenance;
  readonly materialClaimExtractor: OriginMaterialClaimExtractor;
  readonly promptClaimJudge: OriginAnswerQualityBenchmarkPromptClaimJudge;
  readonly semanticJudge: OriginAnswerQualityBenchmarkSemanticJudge;
  readonly claimAssessor: OriginClaimAssessor;
  readonly baseline: OriginAnswerQualityOfficialComparisonTarget;
  readonly candidate: OriginAnswerQualityOfficialComparisonTarget;
}

export interface OriginAnswerQualityOfficialComparisonSuccess {
  readonly schemaVersion: "origin.aq-official-comparison.v1";
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly baselineGitSha: string;
  readonly candidateGitSha: string;
  readonly officialEvaluation: OriginAnswerQualityOfficialBenchmarkEvaluationBundle;
}

export type OriginAnswerQualityOfficialComparisonResult =
  | { ok: true; value: OriginAnswerQualityOfficialComparisonSuccess }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_OFFICIAL_COMPARISON_INVALID_INPUT"
        | "AQ_BENCHMARK_OFFICIAL_BASELINE_FAILED"
        | "AQ_BENCHMARK_OFFICIAL_CANDIDATE_FAILED"
        | "AQ_BENCHMARK_OFFICIAL_COMPARISON_EVALUATION_FAILED";
      detail?: string;
    };

const SHA40 = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;

export interface OriginAnswerQualityOfficialComparisonSessionRunner {
  (input: OriginAnswerQualityOfficialBenchmarkSessionInput):
    Promise<OriginAnswerQualityOfficialBenchmarkSessionResult>;
}

function validTarget(target: OriginAnswerQualityOfficialComparisonTarget): boolean {
  return SAFE_ID.test(target.runId)
    && SHA40.test(target.gitSha)
    && target.environmentProof.expectedGitSha === target.gitSha
    && target.environmentProof.observedReleaseSha === target.gitSha
    && target.environmentProof.freeOnly === true
    && target.environmentProof.costUsd === 0
    && target.environmentProof.paidFallbackEnabled === false
    && target.sourceRoot.trim().length > 0;
}

function sessionInput(
  input: OriginAnswerQualityOfficialComparisonInput,
  target: OriginAnswerQualityOfficialComparisonTarget,
): OriginAnswerQualityOfficialBenchmarkSessionInput {
  return {
    runId: target.runId,
    gitSha: target.gitSha,
    providerId: input.providerId,
    modelId: input.modelId,
    environmentProof: target.environmentProof,
    sourceRoot: target.sourceRoot,
    scorerProvenance: input.scorerProvenance,
    materialClaimExtractor: input.materialClaimExtractor,
    promptClaimJudge: input.promptClaimJudge,
    semanticJudge: input.semanticJudge,
    claimAssessor: input.claimAssessor,
    fetchImpl: target.fetchImpl,
    env: target.env,
    nowMs: target.nowMs,
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

export async function runOriginAnswerQualityOfficialComparisonHarness(
  input: OriginAnswerQualityOfficialComparisonInput,
  runSession: OriginAnswerQualityOfficialComparisonSessionRunner,
): Promise<OriginAnswerQualityOfficialComparisonResult> {
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

  const baseline = await runSession(sessionInput(input, input.baseline));
  if (baseline.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_BASELINE_FAILED",
      detail: failureDetail(baseline),
    };
  }

  const candidate = await runSession(sessionInput(input, input.candidate));
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
      schemaVersion: "origin.aq-official-comparison.v1",
      baselineRunId: input.baseline.runId,
      candidateRunId: input.candidate.runId,
      baselineGitSha: input.baseline.gitSha,
      candidateGitSha: input.candidate.gitSha,
      officialEvaluation: evaluation.value,
    }),
  };
}

/**
 * Canonical before/after public AQ benchmark runner.
 *
 * Both sides share the exact provider/model and scorer dependencies supplied
 * in the common input. Targets may differ only in revision, environment proof,
 * checkout root, run ID, and transport/runtime wiring.
 */
export async function runOriginAnswerQualityOfficialComparison(
  input: OriginAnswerQualityOfficialComparisonInput,
): Promise<OriginAnswerQualityOfficialComparisonResult> {
  return runOriginAnswerQualityOfficialComparisonHarness(
    input,
    runOriginAnswerQualityOfficialBenchmarkSession,
  );
}
