import {
  probeOriginAnswerQualityBenchmarkEnvironment,
  type OriginAnswerQualityBenchmarkEnvironmentProof,
} from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";
import {
  buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle,
  type OriginAnswerQualityOfficialBenchmarkEvaluationBundle,
} from "./OriginAnswerQualityOfficialBenchmarkEvaluationBundle.js";
import {
  runOriginAnswerQualityOfficialProviderScoredSession,
  type OriginAnswerQualityOfficialBenchmarkSessionResult,
  type OriginAnswerQualityOfficialBenchmarkSessionSuccess,
  type OriginAnswerQualityOfficialProviderScoredSessionInput,
} from "./OriginAnswerQualityOfficialBenchmarkSession.js";

export interface OriginAnswerQualityOfficialComparisonTarget {
  readonly runId: string;
  readonly gitSha: string;
  readonly baseUrl: string;
  readonly sourceRoot: string;
}

export interface OriginAnswerQualityOfficialComparisonInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly baseline: OriginAnswerQualityOfficialComparisonTarget;
  readonly candidate: OriginAnswerQualityOfficialComparisonTarget;
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
  readonly nowMs?: () => number;
  readonly evaluatorPlanningOptions?:
    OriginAnswerQualityOfficialProviderScoredSessionInput["evaluatorPlanningOptions"];
}

export interface OriginAnswerQualityOfficialComparisonSuccess {
  readonly schemaVersion: "origin.aq-official-comparison.v1";
  readonly baselineEnvironment: OriginAnswerQualityBenchmarkEnvironmentProof;
  readonly candidateEnvironment: OriginAnswerQualityBenchmarkEnvironmentProof;
  readonly baselineSession: OriginAnswerQualityOfficialBenchmarkSessionSuccess;
  readonly candidateSession: OriginAnswerQualityOfficialBenchmarkSessionSuccess;
  readonly evaluation: OriginAnswerQualityOfficialBenchmarkEvaluationBundle;
}

export type OriginAnswerQualityOfficialComparisonResult =
  | { ok: true; value: OriginAnswerQualityOfficialComparisonSuccess }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_OFFICIAL_COMPARISON_INVALID_INPUT"
        | "AQ_BENCHMARK_OFFICIAL_BASELINE_ENVIRONMENT_INVALID"
        | "AQ_BENCHMARK_OFFICIAL_CANDIDATE_ENVIRONMENT_INVALID"
        | "AQ_BENCHMARK_OFFICIAL_BASELINE_SESSION_FAILED"
        | "AQ_BENCHMARK_OFFICIAL_CANDIDATE_SESSION_FAILED"
        | "AQ_BENCHMARK_OFFICIAL_COMPARISON_EVALUATION_FAILED";
      detail?: string;
    };

export interface OriginAnswerQualityOfficialComparisonDependencies {
  readonly probeEnvironment?: typeof probeOriginAnswerQualityBenchmarkEnvironment;
  readonly runSession?: (
    input: OriginAnswerQualityOfficialProviderScoredSessionInput,
  ) => Promise<OriginAnswerQualityOfficialBenchmarkSessionResult>;
}

const SHA40 = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;

function validTarget(target: OriginAnswerQualityOfficialComparisonTarget): boolean {
  return SHA40.test(target.gitSha)
    && SAFE_ID.test(target.runId)
    && target.baseUrl.trim().length > 0
    && target.sourceRoot.trim().length > 0;
}

function sessionDetail(result: Exclude<OriginAnswerQualityOfficialBenchmarkSessionResult, { ok: true }>): string {
  const detail = "detail" in result && typeof result.detail === "string"
    ? result.detail
    : undefined;
  return detail ? `${result.code}:${detail}` : result.code;
}

export async function runOriginAnswerQualityOfficialComparisonHarness(
  input: OriginAnswerQualityOfficialComparisonInput,
  dependencies: OriginAnswerQualityOfficialComparisonDependencies = {},
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

  const probe = dependencies.probeEnvironment
    ?? probeOriginAnswerQualityBenchmarkEnvironment;
  const runSession = dependencies.runSession
    ?? runOriginAnswerQualityOfficialProviderScoredSession;

  const baselineEnvironment = await probe(
    input.baseline.baseUrl,
    input.baseline.gitSha,
    input.fetchImpl,
  );
  if (baselineEnvironment.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_BASELINE_ENVIRONMENT_INVALID",
      detail: baselineEnvironment.code,
    };
  }

  const candidateEnvironment = await probe(
    input.candidate.baseUrl,
    input.candidate.gitSha,
    input.fetchImpl,
  );
  if (candidateEnvironment.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_CANDIDATE_ENVIRONMENT_INVALID",
      detail: candidateEnvironment.code,
    };
  }

  const shared = {
    env: input.env,
    nowMs: input.nowMs,
    evaluatorPlanningOptions: input.evaluatorPlanningOptions,
    fetchImpl: input.fetchImpl,
  };

  const baseline = await runSession({
    runId: input.baseline.runId,
    gitSha: input.baseline.gitSha,
    providerId: input.providerId,
    modelId: input.modelId,
    environmentProof: baselineEnvironment.value,
    sourceRoot: input.baseline.sourceRoot,
    ...shared,
  });
  if (baseline.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_BASELINE_SESSION_FAILED",
      detail: sessionDetail(baseline),
    };
  }

  const candidate = await runSession({
    runId: input.candidate.runId,
    gitSha: input.candidate.gitSha,
    providerId: input.providerId,
    modelId: input.modelId,
    environmentProof: candidateEnvironment.value,
    sourceRoot: input.candidate.sourceRoot,
    ...shared,
  });
  if (candidate.ok === false) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_OFFICIAL_CANDIDATE_SESSION_FAILED",
      detail: sessionDetail(candidate),
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
      baselineEnvironment: baselineEnvironment.value,
      candidateEnvironment: candidateEnvironment.value,
      baselineSession: baseline.value,
      candidateSession: candidate.value,
      evaluation: evaluation.value,
    }),
  };
}

export async function runOriginAnswerQualityOfficialComparison(
  input: OriginAnswerQualityOfficialComparisonInput,
): Promise<OriginAnswerQualityOfficialComparisonResult> {
  return runOriginAnswerQualityOfficialComparisonHarness(input);
}
